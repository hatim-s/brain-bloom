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
};

type KillProcess = (pid: number, signal: NodeJS.Signals) => void;
type SpawnProcess = (
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2]
) => ChildProcessWithoutNullStreams;
type WindowsTreeKiller = (pid: number, force: boolean) => void;

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

  constructor(spawnProcess: SpawnProcess = spawn as SpawnProcess) {
    this.spawnProcess = spawnProcess;
  }

  async run(spec: ProcessSpec): Promise<ProcessResult> {
    assertSignalNotAborted(spec.signal);

    const child = this.spawnProcess(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env as NodeJS.ProcessEnv,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // No credential is ever written to child stdin; close it immediately so a
    // CLI cannot wait for interactive input or inherit the caller's stream.
    child.stdin.end();

    return collectProcessResult(child, spec);
  }
}

/** Collects only a bounded amount of output and owns all cleanup paths. */
async function collectProcessResult(
  child: ChildProcessWithoutNullStreams,
  spec: ProcessSpec
): Promise<ProcessResult> {
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let terminated = false;
  let forceKillTimeout: NodeJS.Timeout | undefined;

  /** Starts idempotent graceful termination for this process group. */
  const terminate = () => {
    if (terminated) {
      return;
    }
    terminated = true;
    terminateProcessTree(child.pid, "SIGTERM");
    forceKillTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        terminateProcessTree(child.pid, "SIGKILL");
      }
    }, 1_000);
    forceKillTimeout.unref();
  };

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

  const timeout = setTimeout(terminate, spec.timeoutMs);
  const abort = () => terminate();
  spec.signal?.addEventListener("abort", abort, { once: true });
  if (spec.signal?.aborted) {
    // Close the small race between the pre-spawn check and listener install.
    terminate();
  }

  try {
    const exit = await new Promise<ProcessExit>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });

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
    };
  } finally {
    clearTimeout(timeout);
    if (forceKillTimeout !== undefined) {
      clearTimeout(forceKillTimeout);
    }
    spec.signal?.removeEventListener("abort", abort);

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
  runWindowsTaskkill,
  terminateProcessTree,
  type WindowsTreeKiller,
};
