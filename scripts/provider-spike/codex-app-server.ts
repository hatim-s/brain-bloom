import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { sep } from "node:path";
import { createInterface, type Interface } from "node:readline";

import { terminateProcessTree } from "./process.ts";
import { createIsolatedEnvironment, redactText } from "./security.ts";

const CODEX_CLIENT_INFO = {
  name: "sprig_provider_spike",
  title: "Sprig Provider Spike",
  version: "0.1.0",
};
const MAX_PROTOCOL_BYTES = 256 * 1024;

type AccountReadResult = {
  account:
    | { type: "apiKey" }
    | { type: "chatgpt"; email: string | null; planType: string }
    | {
        type: "amazonBedrock";
        usesCodexManagedCredentials?: boolean;
        credentialSource?: string;
      }
    | null;
  requiresOpenaiAuth: boolean;
};

type SafeAccountMetadata = {
  type: string | null;
  planType: string | null;
  emailPresent: boolean;
  requiresOpenaiAuth: boolean;
  credentialSource: string | null;
};

type DeviceCodeCeremony = {
  verificationUrl: string;
  userCode: string;
};

type LoginCompleted = {
  success: boolean;
  error: string | null;
};

type AccountUpdated = {
  authMode: string | null;
  planType: string | null;
};

type CodexDeviceProbeResult = {
  initialAccount: SafeAccountMetadata;
  completion: LoginCompleted;
  updatedAccount: AccountUpdated | null;
  finalAccount: SafeAccountMetadata;
};

type CodexLogoutRestartResult = {
  beforeLogout: SafeAccountMetadata;
  afterLogout: SafeAccountMetadata;
  afterRestart: SafeAccountMetadata;
};

interface CodexProbeSession {
  initialize(): Promise<void>;
  readAccount(): Promise<AccountReadResult>;
  startDeviceCode(): Promise<DeviceCodeCeremony & { loginId: string }>;
  waitForLoginCompleted(
    loginId: string,
    timeoutMs: number
  ): Promise<LoginCompleted>;
  waitForAccountUpdated(timeoutMs: number): Promise<AccountUpdated | null>;
  logout(): Promise<void>;
  close(): Promise<void>;
}

interface CodexProbeSessionFactory {
  create(codexHome: string, signal?: AbortSignal): CodexProbeSession;
}

type RpcMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type NotificationWaiter = {
  method: string;
  predicate: (params: unknown) => boolean;
  resolve: (params: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

/** Verifies a caller-supplied CODEX_HOME is a private child of the OS temp root. */
async function assertTemporaryCodexHome(codexHome: string): Promise<string> {
  const [resolvedHome, resolvedTemp] = await Promise.all([
    realpath(codexHome),
    realpath(tmpdir()),
  ]);
  const homeStat = await stat(resolvedHome);

  if (!homeStat.isDirectory()) {
    throw new Error("--codex-home must point to an existing directory");
  }

  if (!resolvedHome.startsWith(`${resolvedTemp}${sep}`)) {
    throw new Error(
      "--codex-home must be a child directory of the OS temp root"
    );
  }

  if ((homeStat.mode & 0o077) !== 0) {
    throw new Error(
      "--codex-home must not be accessible by group or other users"
    );
  }

  return resolvedHome;
}

/** Reduces an account response to non-identifying provider metadata. */
function summarizeAccount(account: AccountReadResult): SafeAccountMetadata {
  const details = account.account;

  return {
    type: details?.type ?? null,
    planType: details?.type === "chatgpt" ? details.planType : null,
    emailPresent: details?.type === "chatgpt" && details.email !== null,
    requiresOpenaiAuth: account.requiresOpenaiAuth,
    credentialSource:
      details?.type === "amazonBedrock"
        ? (details.credentialSource ??
          (details.usesCodexManagedCredentials === undefined
            ? null
            : details.usesCodexManagedCredentials
              ? "codexManaged"
              : "awsManaged"))
        : null,
  };
}

/** Real stdio JSON-RPC client for the documented Codex app-server auth API. */
class StdioCodexProbeSession implements CodexProbeSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private readonly notifications: RpcMessage[] = [];
  private readonly waiters = new Set<NotificationWaiter>();
  private readonly abortHandler: () => void;
  private readonly abortSignal?: AbortSignal;
  private readonly exited: Promise<void>;
  private nextId = 0;
  private protocolBytes = 0;
  private stderr = "";
  private closed = false;

  /** Starts one app-server whose credential storage is the supplied temp home. */
  constructor(
    codexHome: string,
    signal?: AbortSignal,
    inheritedEnvironment: Readonly<
      Record<string, string | undefined>
    > = process.env,
    command = "codex"
  ) {
    this.child = spawn(command, ["app-server", "--listen", "stdio://"], {
      cwd: codexHome,
      env: createIsolatedEnvironment(inheritedEnvironment, {
        CODEX_HOME: codexHome,
      }) as NodeJS.ProcessEnv,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.abortSignal = signal;
    this.abortHandler = () => void this.close();
    this.exited = new Promise((resolve) => this.child.once("close", resolve));

    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.protocolBytes += chunk.byteLength;
      this.stderr += chunk.toString();
      if (this.protocolBytes > MAX_PROTOCOL_BYTES) {
        void this.close();
      }
    });
    this.child.once("error", (error) => this.failAll(error));
    this.child.once("close", (code) => {
      if (!this.closed) {
        this.failAll(
          new Error(
            `Codex app-server exited with ${code}: ${redactText(this.stderr)}`
          )
        );
      }
    });
    signal?.addEventListener("abort", this.abortHandler, { once: true });
  }

  /** Performs the required initialize request then initialized notification. */
  async initialize(): Promise<void> {
    await this.request("initialize", { clientInfo: CODEX_CLIENT_INFO });
    this.notify("initialized", {});
  }

  /** Reads current account state without forcing a token refresh. */
  async readAccount(): Promise<AccountReadResult> {
    return (await this.request("account/read", {
      refreshToken: false,
    })) as AccountReadResult;
  }

  /** Starts exactly the documented ChatGPT device-code login mode. */
  async startDeviceCode(): Promise<DeviceCodeCeremony & { loginId: string }> {
    const result = (await this.request("account/login/start", {
      type: "chatgptDeviceCode",
    })) as Partial<DeviceCodeCeremony & { loginId: string; type: string }>;

    if (
      result.type !== "chatgptDeviceCode" ||
      typeof result.loginId !== "string" ||
      typeof result.verificationUrl !== "string" ||
      typeof result.userCode !== "string"
    ) {
      throw new Error("Codex returned an invalid device-code response");
    }

    return {
      loginId: result.loginId,
      verificationUrl: sanitizeVerificationUrl(result.verificationUrl),
      userCode: redactText(result.userCode),
    };
  }

  /** Waits for the completion notification belonging to this login attempt. */
  async waitForLoginCompleted(
    loginId: string,
    timeoutMs: number
  ): Promise<LoginCompleted> {
    const params = (await this.waitForNotification(
      "account/login/completed",
      (value) =>
        isRecord(value) &&
        value.loginId === loginId &&
        typeof value.success === "boolean",
      timeoutMs
    )) as { success: boolean; error?: unknown };

    return {
      success: params.success,
      error: typeof params.error === "string" ? redactText(params.error) : null,
    };
  }

  /** Waits briefly for the account change emitted after login or logout. */
  async waitForAccountUpdated(
    timeoutMs: number
  ): Promise<AccountUpdated | null> {
    try {
      const params = (await this.waitForNotification(
        "account/updated",
        isRecord,
        timeoutMs
      )) as Record<string, unknown>;

      return {
        authMode: typeof params.authMode === "string" ? params.authMode : null,
        planType: typeof params.planType === "string" ? params.planType : null,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("Timed out")) {
        return null;
      }
      throw error;
    }
  }

  /** Logs out only the account persisted beneath this session's CODEX_HOME. */
  async logout(): Promise<void> {
    await this.request("account/logout");
  }

  /** Closes the transport and terminates the complete app-server process tree. */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.abortSignal?.removeEventListener("abort", this.abortHandler);
    this.lines.close();
    this.child.stdin.end();
    terminateProcessTree(this.child.pid, "SIGTERM");
    this.failAll(new Error("Codex app-server session closed"));

    const exitedGracefully = await Promise.race([
      this.exited.then(() => true),
      delay(1_000).then(() => false),
    ]);
    if (!exitedGracefully) {
      terminateProcessTree(this.child.pid, "SIGKILL");
      await Promise.race([this.exited, delay(1_000)]);
    }
  }

  /** Sends one JSON-RPC request and resolves its matching response. */
  private async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;

    const response = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
    });
    this.write({ method, id, ...(params === undefined ? {} : { params }) });
    return response;
  }

  /** Sends a JSON-RPC notification without a response id. */
  private notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  /** Writes one bounded JSONL protocol message. */
  private write(message: RpcMessage): void {
    if (this.closed || !this.child.stdin.writable) {
      throw new Error("Codex app-server transport is closed");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Routes one response or notification without ever logging raw protocol. */
  private handleLine(line: string): void {
    this.protocolBytes += Buffer.byteLength(line);
    if (this.protocolBytes > MAX_PROTOCOL_BYTES) {
      this.failAll(
        new Error("Codex app-server protocol output exceeded limit")
      );
      void this.close();
      return;
    }

    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      this.failAll(new Error("Codex app-server emitted invalid JSON"));
      void this.close();
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(
          new Error(
            `Codex app-server request failed (${message.error.code ?? "unknown"}): ${redactText(message.error.message ?? "unknown error")}`
          )
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== "string") {
      return;
    }

    for (const waiter of Array.from(this.waiters)) {
      if (
        waiter.method === message.method &&
        waiter.predicate(message.params)
      ) {
        clearTimeout(waiter.timeout);
        this.waiters.delete(waiter);
        waiter.resolve(message.params);
        return;
      }
    }

    this.notifications.push(message);
    if (this.notifications.length > 32) {
      this.notifications.shift();
    }
  }

  /** Waits for a queued or future notification with a strict time bound. */
  private async waitForNotification(
    method: string,
    predicate: (params: unknown) => boolean,
    timeoutMs: number
  ): Promise<unknown> {
    const queuedIndex = this.notifications.findIndex(
      (message) => message.method === method && predicate(message.params)
    );
    if (queuedIndex >= 0) {
      return this.notifications.splice(queuedIndex, 1)[0]?.params;
    }

    return new Promise((resolve, reject) => {
      const waiter: NotificationWaiter = {
        method,
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for ${method}`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  /** Rejects all outstanding protocol operations with one bounded error. */
  private failAll(error: Error): void {
    for (const pending of Array.from(this.pending.values())) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of Array.from(this.waiters)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.waiters.clear();
  }
}

/** Creates real app-server sessions while retaining an injectable test seam. */
class StdioCodexProbeSessionFactory implements CodexProbeSessionFactory {
  create(codexHome: string, signal?: AbortSignal): CodexProbeSession {
    return new StdioCodexProbeSession(codexHome, signal);
  }
}

/** Runs the opt-in device-code ceremony and captures only safe metadata. */
async function runCodexDeviceCodeProbe(options: {
  codexHome: string;
  factory: CodexProbeSessionFactory;
  onCeremony: (ceremony: DeviceCodeCeremony) => void;
  signal?: AbortSignal;
  loginTimeoutMs?: number;
}): Promise<CodexDeviceProbeResult> {
  const session = options.factory.create(options.codexHome, options.signal);

  try {
    await session.initialize();
    const initialAccount = summarizeAccount(await session.readAccount());
    const login = await session.startDeviceCode();
    options.onCeremony({
      verificationUrl: login.verificationUrl,
      userCode: login.userCode,
    });
    const completion = await session.waitForLoginCompleted(
      login.loginId,
      options.loginTimeoutMs ?? 5 * 60_000
    );
    const updatedAccount = await session.waitForAccountUpdated(2_000);
    const finalAccount = summarizeAccount(await session.readAccount());

    return { initialAccount, completion, updatedAccount, finalAccount };
  } finally {
    await session.close();
  }
}

/** Proves logout persistence by reopening the same isolated CODEX_HOME. */
async function runCodexLogoutRestartProbe(options: {
  codexHome: string;
  factory: CodexProbeSessionFactory;
  signal?: AbortSignal;
}): Promise<CodexLogoutRestartResult> {
  const firstSession = options.factory.create(
    options.codexHome,
    options.signal
  );
  let beforeLogout: SafeAccountMetadata;
  let afterLogout: SafeAccountMetadata;

  try {
    await firstSession.initialize();
    beforeLogout = summarizeAccount(await firstSession.readAccount());
    await firstSession.logout();
    await firstSession.waitForAccountUpdated(2_000);
    afterLogout = summarizeAccount(await firstSession.readAccount());
  } finally {
    await firstSession.close();
  }

  const restartedSession = options.factory.create(
    options.codexHome,
    options.signal
  );
  try {
    await restartedSession.initialize();
    const afterRestart = summarizeAccount(await restartedSession.readAccount());
    return { beforeLogout, afterLogout, afterRestart };
  } finally {
    await restartedSession.close();
  }
}

/** Narrows unknown protocol payloads to ordinary records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Restricts device ceremony output to the documented secure OpenAI endpoint. */
function sanitizeVerificationUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "auth.openai.com") {
    throw new Error("Codex returned an unexpected device verification URL");
  }

  // Query strings and fragments are not required by the documented ceremony
  // and could contain future authorization material, so never print them.
  return `${url.origin}${url.pathname}`;
}

/** Creates a short cleanup grace period without blocking the event loop. */
async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export {
  type AccountReadResult,
  assertTemporaryCodexHome,
  type CodexDeviceProbeResult,
  type CodexLogoutRestartResult,
  type CodexProbeSession,
  type CodexProbeSessionFactory,
  type DeviceCodeCeremony,
  runCodexDeviceCodeProbe,
  runCodexLogoutRestartProbe,
  type SafeAccountMetadata,
  sanitizeVerificationUrl,
  StdioCodexProbeSession,
  StdioCodexProbeSessionFactory,
  summarizeAccount,
};
