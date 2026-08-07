import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertSignalNotAborted,
  type CommandRunner,
  NodeCommandRunner,
  type ProcessResult,
} from "./process.ts";
import { createIsolatedEnvironment } from "./security.ts";

const MAX_TOKEN_BYTES = 4_096;
const CLAUDE_PROBE_PROMPT =
  "Authentication probe only. Reply with exactly the single word OK.";

type ClaudeProbeMetadata = {
  authenticated: boolean;
  durationMs: number | null;
  numTurns: number | null;
};

interface TokenSource {
  read(signal?: AbortSignal): Promise<string>;
}

interface ClaudeValidationAdapter {
  validate(token: string, signal?: AbortSignal): Promise<ClaudeProbeMetadata>;
}

/** Reads one bounded setup token from standard input, never argv or env. */
class StdinTokenSource implements TokenSource {
  private readonly input: NodeJS.ReadableStream;

  constructor(input: NodeJS.ReadableStream = process.stdin) {
    this.input = input;
  }

  async read(signal?: AbortSignal): Promise<string> {
    assertSignalNotAborted(signal);

    return new Promise((resolve, reject) => {
      let token = "";

      /** Removes every listener so cancellation settles without retaining stdin. */
      const cleanup = () => {
        this.input.removeListener("data", onData);
        this.input.removeListener("end", onEnd);
        this.input.removeListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onData = (chunk: string | Buffer) => {
        token += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
        if (Buffer.byteLength(token) > MAX_TOKEN_BYTES) {
          fail(new Error("Claude setup token input exceeded 4096 bytes"));
        }
      };
      const onEnd = () => {
        cleanup();
        try {
          resolve(validateToken(token));
        } catch (error) {
          reject(error);
        }
      };
      const onError = () =>
        fail(new Error("Could not read Claude setup token"));
      const onAbort = () => {
        cleanup();
        if ("pause" in this.input && typeof this.input.pause === "function") {
          this.input.pause();
        }
        reject(new Error("Provider probe cancelled"));
      };

      this.input.on("data", onData);
      this.input.once("end", onEnd);
      this.input.once("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });

      // Close the race where cancellation happens while listeners are attached.
      if (signal?.aborted) {
        onAbort();
      }
    });
  }
}

/** In-memory source used by embedding callers and credential-free unit tests. */
class InMemoryTokenSource implements TokenSource {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async read(signal?: AbortSignal): Promise<string> {
    assertSignalNotAborted(signal);
    return validateToken(this.token);
  }
}

/** Runs one no-tools Claude turn in a throwaway home with no key fallback. */
class ClaudeCliValidationAdapter implements ClaudeValidationAdapter {
  private readonly runner: CommandRunner;
  private readonly inheritedEnvironment: Readonly<
    Record<string, string | undefined>
  >;
  private readonly cwd: string;
  private readonly command: string;

  constructor(
    runner: CommandRunner = new NodeCommandRunner(),
    inheritedEnvironment: Readonly<
      Record<string, string | undefined>
    > = process.env,
    cwd = process.cwd(),
    command = "claude"
  ) {
    this.runner = runner;
    this.inheritedEnvironment = inheritedEnvironment;
    this.cwd = cwd;
    this.command = command;
  }

  async validate(
    token: string,
    signal?: AbortSignal
  ): Promise<ClaudeProbeMetadata> {
    assertSignalNotAborted(signal);
    const isolatedHome = await mkdtemp(join(tmpdir(), "sprig-claude-probe-"));

    try {
      let result: ProcessResult;
      try {
        result = await this.runner.run({
          command: this.command,
          args: [
            "--print",
            "--output-format",
            "json",
            "--tools",
            "",
            "--permission-mode",
            "dontAsk",
            "--no-session-persistence",
            "--setting-sources",
            "",
            CLAUDE_PROBE_PROMPT,
          ],
          cwd: this.cwd,
          env: createIsolatedEnvironment(this.inheritedEnvironment, {
            HOME: isolatedHome,
            CLAUDE_CONFIG_DIR: isolatedHome,
            CLAUDE_CODE_OAUTH_TOKEN: token,
            CLAUDE_AGENT_SDK_CLIENT_APP: "sprig-provider-spike/0.1.0",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          }),
          signal,
          timeoutMs: 60_000,
          maxOutputBytes: 64 * 1024,
        });
      } catch {
        if (signal?.aborted) {
          throw new Error("Provider probe cancelled");
        }
        throw new Error("Claude setup-token validation failed");
      }

      return parseClaudeResult(result);
    } finally {
      // The exact directory was created by this invocation and contains only
      // disposable probe state. Removing it blocks credential persistence.
      await rm(isolatedHome, { recursive: true, force: true });
    }
  }
}

/** Validates a token source only after the caller has crossed the CLI gate. */
async function runClaudeSetupTokenProbe(options: {
  tokenSource: TokenSource;
  adapter: ClaudeValidationAdapter;
  signal?: AbortSignal;
}): Promise<ClaudeProbeMetadata> {
  assertSignalNotAborted(options.signal);
  const token = await options.tokenSource.read(options.signal);
  assertSignalNotAborted(options.signal);
  return options.adapter.validate(token, options.signal);
}

/** Validates token size without asserting an undocumented token format. */
function validateToken(input: string): string {
  const token = input.trim();
  if (token.length === 0) {
    throw new Error("Claude setup token is required on stdin");
  }
  if (Buffer.byteLength(token) > MAX_TOKEN_BYTES) {
    throw new Error("Claude setup token input exceeded 4096 bytes");
  }
  return token;
}

/** Extracts an allowlisted result summary and discards all model content. */
function parseClaudeResult(result: ProcessResult): ClaudeProbeMetadata {
  if (result.code !== 0) {
    throw new Error("Claude setup-token validation failed");
  }

  let output: unknown;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    throw new Error("Claude setup-token validation returned invalid JSON");
  }

  if (!isRecord(output)) {
    throw new Error("Claude setup-token validation returned invalid metadata");
  }

  if (
    output.type !== "result" ||
    output.subtype !== "success" ||
    output.is_error !== false
  ) {
    throw new Error("Claude setup-token validation did not authenticate");
  }

  return {
    authenticated: true,
    durationMs:
      typeof output.duration_ms === "number" ? output.duration_ms : null,
    numTurns: typeof output.num_turns === "number" ? output.num_turns : null,
  };
}

/** Narrows unknown CLI JSON to a record before reading metadata fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {
  CLAUDE_PROBE_PROMPT,
  ClaudeCliValidationAdapter,
  type ClaudeProbeMetadata,
  type ClaudeValidationAdapter,
  InMemoryTokenSource,
  parseClaudeResult,
  runClaudeSetupTokenProbe,
  StdinTokenSource,
  type TokenSource,
  validateToken,
};
