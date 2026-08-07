import {
  type ChildProcessWithoutNullStreams,
  spawn as nodeSpawn,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  ClaudeCliValidationAdapter,
  InMemoryTokenSource,
  runClaudeSetupTokenProbe,
  StdinTokenSource,
} from "./claude-setup-token.ts";
import { main, parseCliOptions } from "./cli.ts";
import {
  type AccountReadResult,
  assertFileBackedCredentialStore,
  assertTemporaryCodexHome,
  CODEX_APP_SERVER_ARGS,
  CODEX_ISOLATION_ERROR,
  type CodexProbeSession,
  type CodexProbeSessionFactory,
  createCodexRequestError,
  runCodexDeviceCodeProbe,
  runCodexLogoutRestartProbe,
  StdioCodexProbeSession,
  summarizeAccount,
  summarizeAccountUpdate,
} from "./codex-app-server.ts";
import {
  type CommandRunner,
  NodeCommandRunner,
  type ProcessResult,
  type ProcessSpec,
  terminateProcessTree,
} from "./process.ts";
import { createIsolatedEnvironment, sanitizeForOutput } from "./security.ts";

const CHATGPT_ACCOUNT: AccountReadResult = {
  account: {
    type: "chatgpt",
    email: "operator@example.com",
    planType: "plus",
  },
  requiresOpenaiAuth: true,
};

/** Fake app-server session that records probe sequencing without credentials. */
class FakeCodexSession implements CodexProbeSession {
  readonly calls: string[] = [];

  constructor(
    private readonly accounts: AccountReadResult[],
    private readonly loginSuccess = true
  ) {}

  async initialize(): Promise<void> {
    this.calls.push("initialize");
  }

  async readAccount(): Promise<AccountReadResult> {
    this.calls.push("readAccount");
    const account = this.accounts.shift();
    if (!account) {
      throw new Error("Fake account queue exhausted");
    }
    return account;
  }

  async startDeviceCode() {
    this.calls.push("startDeviceCode");
    return {
      type: "chatgptDeviceCode" as const,
      loginId: "login-1",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    };
  }

  async waitForLoginCompleted(loginId: string) {
    this.calls.push(`waitForLoginCompleted:${loginId}`);
    return { success: this.loginSuccess, error: null };
  }

  async waitForAccountUpdated() {
    this.calls.push("waitForAccountUpdated");
    return { authModePresent: true, planTypePresent: true };
  }

  async logout(): Promise<void> {
    this.calls.push("logout");
  }

  async close(): Promise<void> {
    this.calls.push("close");
  }
}

/** Fake factory proves every restart uses the caller-selected home. */
class FakeCodexFactory implements CodexProbeSessionFactory {
  readonly homes: string[] = [];

  constructor(private readonly sessions: FakeCodexSession[]) {}

  create(codexHome: string): CodexProbeSession {
    this.homes.push(codexHome);
    const session = this.sessions.shift();
    if (!session) {
      throw new Error("Fake session queue exhausted");
    }
    return session;
  }
}

/** Fake command runner captures the full Claude child contract. */
class FakeCommandRunner implements CommandRunner {
  spec?: ProcessSpec;

  constructor(private readonly result: ProcessResult) {}

  async run(spec: ProcessSpec): Promise<ProcessResult> {
    this.spec = spec;
    return this.result;
  }
}

type FakeCodexChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number | undefined;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
};

/** Creates a no-process stdio transport that closes when the client ends stdin. */
function createFakeCodexChild(
  pid?: number,
  closeOnStdinEnd = true
): FakeCodexChild {
  const child = new EventEmitter() as FakeCodexChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  if (closeOnStdinEnd) {
    child.stdin.once("finish", () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.exitCode = 0;
        child.emit("close", 0, null);
      }
    });
  }
  return child;
}

describe("provider spike security", () => {
  it("does not inherit API-key or cloud-provider fallbacks", () => {
    const environment = createIsolatedEnvironment(
      {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "openai-secret",
        CODEX_API_KEY: "codex-secret",
        ANTHROPIC_API_KEY: "anthropic-secret",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        GOOGLE_APPLICATION_CREDENTIALS: "/secret/file",
      },
      { CODEX_HOME: "/private/tmp/codex-home" }
    );

    expect(environment).toEqual({
      PATH: "/usr/bin",
      CODEX_HOME: "/private/tmp/codex-home",
    });
  });

  it("redacts secret fields, caller secrets, and bounds untrusted output", () => {
    const secret = "setup-token-value";
    const output = sanitizeForOutput(
      {
        token: secret,
        message: `${secret}:${"x".repeat(2_000)}`,
      },
      [secret]
    );
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized.length).toBeLessThan(1_000);
  });

  it("targets the entire POSIX process group during cleanup", () => {
    const kill = vi.fn();

    terminateProcessTree(4242, "SIGTERM", kill, "darwin");

    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
  });

  it("uses taskkill tree semantics rather than direct child kill on Windows", () => {
    const kill = vi.fn();
    const windowsTreeKiller = vi.fn();

    terminateProcessTree(4242, "SIGKILL", kill, "win32", windowsTreeKiller);

    expect(windowsTreeKiller).toHaveBeenCalledWith(4242, true);
    expect(kill).not.toHaveBeenCalled();
  });

  it("rejects a pre-aborted command before spawning any child", async () => {
    const controller = new AbortController();
    const spawnProcess = vi.fn();
    controller.abort();

    await expect(
      new NodeCommandRunner(spawnProcess as never).run({
        command: "provider",
        args: [],
        cwd: process.cwd(),
        env: {},
        signal: controller.signal,
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      })
    ).rejects.toThrow("Provider probe cancelled");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("cancels a running child instead of leaving its process tree alive", async () => {
    const controller = new AbortController();
    const run = new NodeCommandRunner().run({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      env: createIsolatedEnvironment(process.env, {}),
      signal: controller.signal,
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
    });

    controller.abort();

    await expect(run).rejects.toThrow("cancelled");
  });

  it("terminates a child when abort fires inside the spawn callback", async () => {
    const controller = new AbortController();
    const spawnDuringAbort = (
      command: string,
      args: string[],
      options: Parameters<typeof nodeSpawn>[2]
    ): ChildProcessWithoutNullStreams => {
      const child = nodeSpawn(
        command,
        args,
        options
      ) as ChildProcessWithoutNullStreams;
      controller.abort();
      return child;
    };

    const run = new NodeCommandRunner(spawnDuringAbort).run({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      env: createIsolatedEnvironment(process.env, {}),
      signal: controller.signal,
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
    });

    await expect(run).rejects.toThrow("Provider probe cancelled");
  });

  it("fails closed when a timed-out child handles SIGTERM and exits zero", async () => {
    const success = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
    });
    const script = `
      process.on("SIGTERM", () => {
        process.stdout.write(${JSON.stringify(success)});
        process.exit(0);
      });
      setInterval(() => {}, 1000);
    `;

    const run = new NodeCommandRunner().run({
      command: process.execPath,
      args: ["-e", script],
      cwd: process.cwd(),
      env: createIsolatedEnvironment(process.env, {}),
      timeoutMs: 100,
      maxOutputBytes: 4_096,
    });

    await expect(run).rejects.toThrow("Provider probe timed out");
  });

  it.each(["stdin", "stdout", "stderr"] as const)(
    "handles a child %s error with stable failure and tree cleanup",
    async (streamName) => {
      const canary = `operator@example.com ${streamName}-io-token-canary`;
      const child = createFakeCodexChild(4242, false);
      const terminateTree = vi.fn();
      const runner = new NodeCommandRunner(
        (() => child) as never,
        terminateTree
      );
      const run = runner.run({
        command: "provider",
        args: [],
        cwd: process.cwd(),
        env: {},
        timeoutMs: 5_000,
        maxOutputBytes: 1_024,
      });

      child[streamName].emit("error", new Error(canary));
      child.exitCode = 1;
      child.emit("close", 1, null);

      const failure = await run.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("Provider process I/O failed");
      expect((failure as Error).message).not.toContain(canary);
      expect(terminateTree).toHaveBeenCalledWith(4242, "SIGTERM");
    }
  );
});

describe("Codex app-server probes", () => {
  it("pins and verifies the official file-backed credential store", () => {
    expect(CODEX_APP_SERVER_ARGS).toContain(
      'cli_auth_credentials_store="file"'
    );
    expect(() =>
      assertFileBackedCredentialStore({
        config: { cli_auth_credentials_store: "file" },
        origins: {
          cli_auth_credentials_store: {
            name: { type: "sessionFlags" },
          },
        },
      })
    ).not.toThrow();

    for (const unsafe of [
      {
        config: { cli_auth_credentials_store: "keyring" },
        origins: {
          cli_auth_credentials_store: {
            name: { type: "sessionFlags" },
          },
        },
      },
      {
        config: { cli_auth_credentials_store: "file" },
        origins: {
          cli_auth_credentials_store: { name: { type: "user" } },
        },
      },
      { config: {}, origins: {} },
    ]) {
      expect(() => assertFileBackedCredentialStore(unsafe)).toThrow(
        CODEX_ISOLATION_ERROR
      );
    }
  });

  it("rejects a pre-aborted app server before spawning", () => {
    const controller = new AbortController();
    const spawnProcess = vi.fn();
    controller.abort();

    expect(
      () =>
        new StdioCodexProbeSession(
          "/private/tmp/codex-aborted",
          controller.signal,
          {},
          "codex",
          spawnProcess as never
        )
    ).toThrow("Provider probe cancelled");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("settles a child when abort fires inside the app-server spawn callback", async () => {
    const controller = new AbortController();
    const child = createFakeCodexChild();
    const spawnProcess = vi.fn(() => {
      controller.abort();
      return child;
    });

    const session = new StdioCodexProbeSession(
      "/private/tmp/codex-spawn-abort",
      controller.signal,
      {},
      "codex",
      spawnProcess as never
    );

    await session.close();
    expect(controller.signal.aborted).toBe(true);
    expect(child.stdin.writableEnded).toBe(true);
  });

  it("clears a cancelled setup request timer without an unhandled rejection", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const captureUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", captureUnhandled);

    try {
      const controller = new AbortController();
      const child = createFakeCodexChild();
      const spawnProcess = vi.fn(() => {
        controller.abort();
        return child;
      });
      const session = new StdioCodexProbeSession(
        "/private/tmp/codex-cancelled-request",
        controller.signal,
        {},
        "codex",
        spawnProcess as never
      );

      const initialization = session.initialize();
      await expect(initialization).rejects.toThrow(
        "Codex app-server transport is closed"
      );
      await session.close();
      expect(
        (session as unknown as { pending: Map<number, unknown> }).pending.size
      ).toBe(0);

      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(unhandled).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      process.removeListener("unhandledRejection", captureUnhandled);
      vi.useRealTimers();
    }
  });

  it.each(["stdin", "stdout", "stderr"] as const)(
    "handles an app-server %s error with stable failure and tree cleanup",
    async (streamName) => {
      const canary = `operator@example.com codex-${streamName}-io-token`;
      const child = createFakeCodexChild(4343);
      const terminateTree = vi.fn();
      const session = new StdioCodexProbeSession(
        `/private/tmp/codex-${streamName}-error`,
        undefined,
        {},
        "codex",
        (() => child) as never,
        terminateTree
      );
      const initialization = session.initialize();

      child[streamName].emit("error", new Error(canary));

      const failure = await initialization.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("Codex app-server I/O failed");
      expect((failure as Error).message).not.toContain(canary);
      await session.close();
      expect(terminateTree).toHaveBeenCalledWith(4343, "SIGTERM");
    }
  );

  it("uses a stable error when spawning the app server fails", () => {
    const spawnProcess = vi.fn(() => {
      throw new Error(
        "operator@example.com spawn-credential-canary-4bd8c85325bf"
      );
    });

    let failure: unknown;
    try {
      new StdioCodexProbeSession(
        "/private/tmp/codex-spawn",
        undefined,
        {},
        "codex",
        spawnProcess as never
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Codex app-server could not start");
    expect((failure as Error).message).not.toContain("operator@example.com");
    expect((failure as Error).message).not.toContain(
      "spawn-credential-canary-4bd8c85325bf"
    );
  });

  it("uses one supplied home and captures non-identifying completion metadata", async () => {
    const session = new FakeCodexSession([
      { account: null, requiresOpenaiAuth: true },
      CHATGPT_ACCOUNT,
    ]);
    const factory = new FakeCodexFactory([session]);
    const ceremonies: unknown[] = [];

    const result = await runCodexDeviceCodeProbe({
      codexHome: "/private/tmp/codex-a",
      factory,
      onCeremony: (ceremony) => ceremonies.push(ceremony),
    });

    expect(factory.homes).toEqual(["/private/tmp/codex-a"]);
    expect(ceremonies).toEqual([
      {
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-1234",
      },
    ]);
    expect(result.finalAccount).toEqual({
      type: "chatgpt",
      planTypePresent: true,
      emailPresent: true,
      requiresOpenaiAuth: true,
    });
    expect(JSON.stringify(result)).not.toContain("operator@example.com");
    expect(session.calls.at(-1)).toBe("close");
  });

  it("logs out and restarts against the same isolated home", async () => {
    const first = new FakeCodexSession([
      CHATGPT_ACCOUNT,
      { account: null, requiresOpenaiAuth: true },
    ]);
    const restarted = new FakeCodexSession([
      { account: null, requiresOpenaiAuth: true },
    ]);
    const factory = new FakeCodexFactory([first, restarted]);

    const result = await runCodexLogoutRestartProbe({
      codexHome: "/private/tmp/codex-b",
      factory,
    });

    expect(factory.homes).toEqual([
      "/private/tmp/codex-b",
      "/private/tmp/codex-b",
    ]);
    expect(first.calls).toContain("logout");
    expect(first.calls.at(-1)).toBe("close");
    expect(restarted.calls.at(-1)).toBe("close");
    expect(result.afterRestart.type).toBeNull();
  });

  it("always closes the session when a probe fails", async () => {
    const session = new FakeCodexSession([]);
    const factory = new FakeCodexFactory([session]);

    await expect(
      runCodexDeviceCodeProbe({
        codexHome: "/private/tmp/codex-c",
        factory,
        onCeremony: vi.fn(),
      })
    ).rejects.toThrow("Fake account queue exhausted");
    expect(session.calls.at(-1)).toBe("close");
  });

  it("accepts only private directories nested beneath the temp root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sprig-codex-test-"));
    try {
      await expect(assertTemporaryCodexHome(directory)).resolves.toBe(
        await realpath(directory)
      );
      await expect(assertTemporaryCodexHome(tmpdir())).rejects.toThrow(
        "child directory"
      );
      await expect(
        assertTemporaryCodexHome(directory, "win32")
      ).rejects.toThrow("POSIX credential-home permission checks");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("summarizes accounts without returning email values", () => {
    expect(JSON.stringify(summarizeAccount(CHATGPT_ACCOUNT))).not.toContain(
      "operator@example.com"
    );
  });

  it("omits arbitrary strings from account and update metadata", () => {
    const canary = "operator@example.com opaque-account-token-5f8d0c61";
    const chatgptSummary = summarizeAccount({
      account: { type: "chatgpt", email: canary, planType: canary },
      requiresOpenaiAuth: true,
    });
    const malformedSummary = summarizeAccount({
      account: { type: canary, credentialSource: canary },
      requiresOpenaiAuth: canary,
    });
    const updateSummary = summarizeAccountUpdate({
      authMode: canary,
      planType: canary,
      error: canary,
    });
    const serialized = JSON.stringify({
      chatgptSummary,
      malformedSummary,
      updateSummary,
    });

    expect(chatgptSummary).toEqual({
      type: "chatgpt",
      planTypePresent: true,
      emailPresent: true,
      requiresOpenaiAuth: true,
    });
    expect(malformedSummary).toEqual({
      type: null,
      planTypePresent: false,
      emailPresent: false,
      requiresOpenaiAuth: false,
    });
    expect(updateSummary).toEqual({
      authModePresent: true,
      planTypePresent: true,
    });
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain("operator@example.com");
  });

  it("never reflects raw RPC messages containing emails or opaque credentials", () => {
    const failure = createCodexRequestError("account/read", {
      code: 401,
      message: "operator@example.com opaque-credential-canary-7f943c3f551d",
    });

    expect(failure.message).toBe(
      "Codex account/read request failed (code 401)"
    );
    expect(failure.message).not.toContain("operator@example.com");
    expect(failure.message).not.toContain(
      "opaque-credential-canary-7f943c3f551d"
    );
  });

  it("never surfaces raw stderr when the app server exits", async () => {
    const child = createFakeCodexChild();
    const session = new StdioCodexProbeSession(
      "/private/tmp/codex-stderr",
      undefined,
      {},
      "codex",
      (() => child) as never
    );
    const initialization = session.initialize();
    child.stderr.write("operator@example.com stderr-token-canary-bb704e2da2ef");
    child.exitCode = 1;
    child.emit("close", 1, null);

    const failure = await initialization.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "Codex app-server exited unexpectedly"
    );
    expect((failure as Error).message).not.toContain("operator@example.com");
    expect((failure as Error).message).not.toContain(
      "stderr-token-canary-bb704e2da2ef"
    );
    await session.close();
  });

  it("terminates cleanly when newline-free protocol output exceeds its cap", async () => {
    const child = createFakeCodexChild();
    const session = new StdioCodexProbeSession(
      "/private/tmp/codex-overflow",
      undefined,
      {},
      "codex",
      (() => child) as never
    );
    const initialization = session.initialize();

    child.stdout.write(Buffer.alloc(256 * 1024 + 1, "x"));

    await expect(initialization).rejects.toThrow(
      "Codex app-server protocol output exceeded limit"
    );
    await session.close();
    expect(child.stdin.writableEnded).toBe(true);
  });
});

describe("Claude setup-token probe", () => {
  it("keeps the token out of argv, output, and inherited key fallbacks", async () => {
    const token = "claude-setup-token-secret";
    const runner = new FakeCommandRunner({
      code: 0,
      signal: null,
      timedOut: false,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: token,
        duration_ms: 23,
        num_turns: 1,
        modelUsage: { [token]: { input_tokens: token } },
      }),
      stderr: "",
    });
    const adapter = new ClaudeCliValidationAdapter(
      runner,
      {
        PATH: "/usr/bin",
        ANTHROPIC_API_KEY: "api-fallback",
        AWS_SECRET_ACCESS_KEY: "cloud-fallback",
      },
      process.cwd(),
      "claude"
    );

    const result = await runClaudeSetupTokenProbe({
      tokenSource: new InMemoryTokenSource(token),
      adapter,
    });

    expect(result).toEqual({
      authenticated: true,
      durationMs: 23,
      numTurns: 1,
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(runner.spec?.args).not.toContain(token);
    expect(runner.spec?.args).toContain("");
    expect(runner.spec?.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
    expect(runner.spec?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(runner.spec?.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(runner.spec?.env.HOME).toContain("sprig-claude-probe-");
  });

  it("uses a stable error if a provider error repeats the token", async () => {
    const token = "claude-secret-in-error";
    const runner = new FakeCommandRunner({
      code: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: `authentication failed for ${token}`,
    });
    const adapter = new ClaudeCliValidationAdapter(runner);

    await expect(adapter.validate(token)).rejects.toThrow(
      "Claude setup-token validation failed"
    );
    await expect(adapter.validate(token)).rejects.not.toThrow(token);
  });

  it("does not surface raw Claude process errors", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async () => {
        throw new Error(
          "operator@example.com process-token-canary-3abf0245480a"
        );
      }),
    };
    const adapter = new ClaudeCliValidationAdapter(runner);

    const failure = await adapter
      .validate("valid-in-memory-token")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "Claude setup-token validation failed"
    );
    expect((failure as Error).message).not.toContain("operator@example.com");
    expect((failure as Error).message).not.toContain(
      "process-token-canary-3abf0245480a"
    );
  });

  it("rejects successful JSON when a runner marks the process timed out", async () => {
    const runner = new FakeCommandRunner({
      code: 0,
      signal: null,
      timedOut: true,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
      }),
      stderr: "",
    });
    const adapter = new ClaudeCliValidationAdapter(runner);

    await expect(adapter.validate("valid-in-memory-token")).rejects.toThrow(
      "Claude setup-token validation timed out"
    );
  });

  it("settles and detaches stdin listeners when cancelled mid-token", async () => {
    const input = new PassThrough();
    const controller = new AbortController();
    const read = new StdinTokenSource(input).read(controller.signal);
    input.write("partial-token-canary");

    controller.abort();

    await expect(read).rejects.toThrow("Provider probe cancelled");
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("error")).toBe(0);
  });
});

describe("provider spike CLI", () => {
  it("prints help with no arguments", () => {
    expect(parseCliOptions([])).toEqual({ command: "help", execute: false });
    expect(parseCliOptions(["--", "help"])).toEqual({
      command: "help",
      execute: false,
    });
  });

  it("requires an explicit execution gate and home for live Codex probes", () => {
    expect(
      parseCliOptions(["codex-device", "--codex-home", "/private/tmp/x"])
    ).toEqual({
      command: "codex-device",
      codexHome: "/private/tmp/x",
      execute: false,
    });
    expect(() => parseCliOptions(["codex-device", "--execute"])).toThrow(
      "--codex-home is required"
    );
  });

  it("does not read credentials or start adapters in dry-run mode", async () => {
    const writes: unknown[] = [];
    const tokenSource = { read: vi.fn() };
    const claudeAdapter = { validate: vi.fn() };
    const codexFactory = { create: vi.fn() };

    await main(["claude-token"], {
      tokenSource,
      claudeAdapter,
      codexFactory,
      write: (value: unknown) => writes.push(value),
    } as never);

    expect(tokenSource.read).not.toHaveBeenCalled();
    expect(claudeAdapter.validate).not.toHaveBeenCalled();
    expect(codexFactory.create).not.toHaveBeenCalled();
    expect(writes).toEqual([
      expect.objectContaining({
        mode: "dry-run",
        providerProcessStarted: false,
        stdinRead: false,
      }),
    ]);
  });
});

export { FakeCodexFactory, FakeCodexSession, FakeCommandRunner };
