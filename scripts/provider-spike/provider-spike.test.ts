import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ClaudeCliValidationAdapter,
  InMemoryTokenSource,
  runClaudeSetupTokenProbe,
} from "./claude-setup-token.ts";
import { main, parseCliOptions } from "./cli.ts";
import {
  type AccountReadResult,
  assertTemporaryCodexHome,
  type CodexProbeSession,
  type CodexProbeSessionFactory,
  runCodexDeviceCodeProbe,
  runCodexLogoutRestartProbe,
  summarizeAccount,
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
    return { authMode: "chatgpt", planType: "plus" };
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
});

describe("Codex app-server probes", () => {
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
      planType: "plus",
      emailPresent: true,
      requiresOpenaiAuth: true,
      credentialSource: null,
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
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("summarizes accounts without returning email values", () => {
    expect(JSON.stringify(summarizeAccount(CHATGPT_ACCOUNT))).not.toContain(
      "operator@example.com"
    );
  });
});

describe("Claude setup-token probe", () => {
  it("keeps the token out of argv, output, and inherited key fallbacks", async () => {
    const token = "claude-setup-token-secret";
    const runner = new FakeCommandRunner({
      code: 0,
      signal: null,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: token,
        duration_ms: 23,
        num_turns: 1,
        modelUsage: { "claude-test": {} },
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
      modelNames: ["claude-test"],
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(runner.spec?.args).not.toContain(token);
    expect(runner.spec?.args).toContain("");
    expect(runner.spec?.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
    expect(runner.spec?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(runner.spec?.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(runner.spec?.env.HOME).toContain("sprig-claude-probe-");
  });

  it("redacts the token if a provider error repeats it", async () => {
    const token = "claude-secret-in-error";
    const runner = new FakeCommandRunner({
      code: 1,
      signal: null,
      stdout: "",
      stderr: `authentication failed for ${token}`,
    });
    const adapter = new ClaudeCliValidationAdapter(runner);

    await expect(adapter.validate(token)).rejects.toThrow(
      "authentication failed for [REDACTED]"
    );
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
