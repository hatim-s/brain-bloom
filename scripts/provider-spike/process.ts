import {
  type ChildProcessWithoutNullStreams,
  spawn,
  spawnSync,
} from "node:child_process";

import { MAX_SAFE_TEXT_LENGTH } from "./security.ts";

type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type ProcessSpec = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
};

type ProcessResult = ProcessExit & {
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type KillProcess = (pid: number, signal: NodeJS.Signals) => void;
type SpawnProcess = (
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2]
) => ChildProcessWithoutNullStreams;
type WindowsTreeKiller = (pid: number, force: boolean) => void;
type ProcessTreeTerminator = (
  pid: number | undefined,
  signal: NodeJS.Signals
) => void;

interface CommandRunner {
  run(spec: ProcessSpec): Promise<ProcessResult>;
}

/** Rejects cancelled work before it can allocate files or spawn a child. */
function assertSignalNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Provider probe cancelled");
  }
}

/** Uses Windows' built-in taskkill tree mode without invoking a shell. */
function runWindowsTaskkill(pid: number, force: boolean): void {
  const result = spawnSync(
    "taskkill",
    ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])],
    { stdio: "ignore", windowsHide: true }
  );

  if (result.error) {
    throw new Error("Unable to terminate provider process tree on Windows");
  }

  if (result.status !== 0) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        return;
      }
    }
    throw new Error("Unable to terminate provider process tree on Windows");
  }
}

/** Terminates a spawned process group so descendants do not survive a probe. */
function terminateProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals,
  killProcess: KillProcess = process.kill,
  platform = process.platform,
  windowsTreeKiller: WindowsTreeKiller = runWindowsTaskkill
): void {
  if (pid === undefined) {
    return;
  }

  if (platform === "win32") {
    windowsTreeKiller(pid, signal === "SIGKILL");
    return;
  }

  try {
    // POSIX children are detached into their own group at spawn time. Killing
    // the negative pid reaches the provider CLI and every descendant it made.
    killProcess(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      throw error;
    }
  }
}

/** Runs a bounded provider CLI process with timeout, abort, and tree cleanup. */
class NodeCommandRunner implements CommandRunner {
  private readonly spawnProcess: SpawnProcess;
  private readonly terminateTree: ProcessTreeTerminator;

  constructor(
    spawnProcess: SpawnProcess = spawn as SpawnProcess,
    terminateTree: ProcessTreeTerminator = terminateProcessTree
  ) {
    this.spawnProcess = spawnProcess;
    this.terminateTree = terminateTree;
  }

  async run(spec: ProcessSpec): Promise<ProcessResult> {
    assertSignalNotAborted(spec.signal);

    let abortedDuringSpawn = false;
    const observeSpawnAbort = () => {
      abortedDuringSpawn = true;
    };
    // Install a sentinel before spawn and keep it until collection installs
    // its own handler, closing both sides of the check-to-listener race.
    spec.signal?.addEventListener("abort", observeSpawnAbort, { once: true });
    if (spec.signal?.aborted) {
      spec.signal.removeEventListener("abort", observeSpawnAbort);
      throw new Error("Provider probe cancelled");
    }

    try {
      const child = this.spawnProcess(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env as NodeJS.ProcessEnv,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      // collectProcessResult attaches its abort listener synchronously before
      // its first await. Its immediate recheck settles a child born during the
      // spawn callback even though AbortSignal does not replay past events.
      const collected = collectProcessResult(
        child,
        spec,
        abortedDuringSpawn,
        this.terminateTree
      );
      spec.signal?.removeEventListener("abort", observeSpawnAbort);
      const result = await collected;
      if (result.timedOut) {
        throw new Error("Provider probe timed out");
      }
      return result;
    } finally {
      spec.signal?.removeEventListener("abort", observeSpawnAbort);
    }
  }
}

/** Collects only a bounded amount of output and owns all cleanup paths. */
async function collectProcessResult(
  child: ChildProcessWithoutNullStreams,
  spec: ProcessSpec,
  abortedBeforeCollection = false,
  terminateTree: ProcessTreeTerminator = terminateProcessTree
): Promise<ProcessResult> {
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let terminated = false;
  let timedOut = false;
  let processFailure: Error | undefined;
  let forceKillTimeout: NodeJS.Timeout | undefined;

  /** Starts idempotent graceful termination for this process group. */
  const terminate = () => {
    if (terminated) {
      return;
    }
    terminated = true;
    try {
      terminateTree(child.pid, "SIGTERM");
    } catch {
      processFailure ??= new Error("Provider process cleanup failed");
    }
    forceKillTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          terminateTree(child.pid, "SIGKILL");
        } catch {
          processFailure ??= new Error("Provider process cleanup failed");
        }
      }
    }, 1_000);
    forceKillTimeout.unref();
  };

  /** Records a stable failure and keeps cleanup active until child close. */
  const failProcess = (message: string) => {
    processFailure ??= new Error(message);
    terminate();
  };
  const failStdio = () => failProcess("Provider process I/O failed");
  const failChild = () => failProcess("Provider process could not start");

  // Stream errors are not forwarded through ChildProcess. Attach every error
  // handler before ending stdin or consuming output so none can crash the CLI.
  child.once("error", failChild);
  child.stdin.on("error", failStdio);
  child.stdout.on("error", failStdio);
  child.stderr.on("error", failStdio);
  const exited = new Promise<ProcessExit>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  const append = (target: "stdout" | "stderr", chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > spec.maxOutputBytes) {
      terminate();
      return;
    }

    if (target === "stdout") {
      stdout += chunk.toString();
    } else {
      stderr += chunk.toString();
    }
  };

  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
  // No credential is ever written to child stdin; close it only after its
  // error handler exists so a synchronous I/O failure is safely contained.
  try {
    child.stdin.end();
  } catch {
    failStdio();
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, spec.timeoutMs);
  const abort = () => terminate();
  spec.signal?.addEventListener("abort", abort, { once: true });
  if (abortedBeforeCollection || spec.signal?.aborted) {
    // Close the small race between the pre-spawn check and listener install.
    terminate();
  }

  try {
    const exit = await exited;

    if (processFailure !== undefined) {
      throw processFailure;
    }

    if (outputBytes > spec.maxOutputBytes) {
      throw new Error(
        `Provider output exceeded ${spec.maxOutputBytes} bytes and was terminated`
      );
    }

    if (spec.signal?.aborted) {
      throw new Error("Provider probe cancelled");
    }

    return {
      ...exit,
      stdout: stdout.slice(0, MAX_SAFE_TEXT_LENGTH * 8),
      stderr: stderr.slice(0, MAX_SAFE_TEXT_LENGTH * 8),
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
    if (forceKillTimeout !== undefined) {
      clearTimeout(forceKillTimeout);
    }
    spec.signal?.removeEventListener("abort", abort);
    child.removeListener("error", failChild);
    child.stdin.removeListener("error", failStdio);
    child.stdout.removeListener("error", failStdio);
    child.stderr.removeListener("error", failStdio);

    if (child.exitCode === null && child.signalCode === null) {
      terminate();
    }
  }
}

export {
  assertSignalNotAborted,
  type CommandRunner,
  NodeCommandRunner,
  type ProcessResult,
  type ProcessSpec,
  type ProcessTreeTerminator,
  runWindowsTaskkill,
  terminateProcessTree,
  type WindowsTreeKiller,
};
