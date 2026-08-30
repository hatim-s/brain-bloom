import {
  generateKeyPairSync,
  type KeyObject,
  sign as signBytes,
} from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { type ControlPlaneOperationContext } from "./control-plane.ts";
import {
  type CodexOperationDefinition,
  CodexOperationRegistry,
  createGatewayDispatcher,
  type GatewayDispatcher,
  type GatewayRequestEnvelope,
  type GatewayRoute,
  type RateBudget,
  type RateBudgetAttempt,
  RateBudgetError,
} from "./dispatcher.ts";
import {
  BoundedReplayCache,
  type Clock,
  type ExpectedAssertionContext,
  type GatewayOperation,
  issueInternalAssertion,
  type ReplayDefense,
  ReplayDefenseError,
  type SigningKey,
  type VerificationKeys,
} from "./internal-auth.ts";
import {
  GATEWAY_CHAT_STREAM_CONTENT_TYPE,
  GATEWAY_OPERATION_PROTOCOL_VERSION,
} from "./operation-protocol.ts";

const BASE_TIME = 1_800_000_000;
const SECRET_CANARY = "sk-secret-do-not-reflect";

/** Deterministic clock used by signed dispatcher fixtures. */
class TestClock implements Clock {
  constructor(private current = BASE_TIME) {}

  nowSeconds(): number {
    return this.current;
  }

  set(nowSeconds: number): void {
    this.current = nowSeconds;
  }
}

/** Observable async budget implementation with controllable failure behavior. */
class TestRateBudget implements RateBudget {
  readonly attempts: RateBudgetAttempt[] = [];
  failure?: Error;

  constructor(
    private readonly implementation?: (
      context: ControlPlaneOperationContext | undefined
    ) => void | Promise<void>
  ) {}

  async consume(
    attempt: RateBudgetAttempt,
    context?: ControlPlaneOperationContext
  ): Promise<void> {
    this.attempts.push(attempt);
    if (this.failure) throw this.failure;
    await this.implementation?.(context);
  }
}

type Fixture = ReturnType<typeof createFixture>;

/** Creates a complete dispatcher fixture with no ambient key or replay state. */
function createFixture(
  options: Partial<{
    execute: CodexOperationDefinition["execute"];
    operation: GatewayOperation;
    parseInput: CodexOperationDefinition["parseInput"];
    protocolVersion: typeof GATEWAY_OPERATION_PROTOCOL_VERSION;
    timeoutMs: number;
    maxBodyBytes: number;
    maxBodyChunks: number;
    bodyReadTimeoutMs: number;
    rateBudgetTimeoutMs: number;
    replayDefenseTimeoutMs: number;
    rateConsume: (
      context: ControlPlaneOperationContext | undefined
    ) => void | Promise<void>;
    replayDefense: ReplayDefense;
  }> = {}
) {
  const operation = options.operation ?? "chat";
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const clock = new TestClock();
  const signingKey: SigningKey = {
    keyId: "dispatcher-current",
    privateKey,
  };
  const verificationKeys: VerificationKeys = {
    current: { keyId: signingKey.keyId, publicKey },
  };
  const expected: ExpectedAssertionContext = {
    issuer: "sprig-nextjs",
    audience: "sprig-agent-gateway",
    subject: "owner_a",
    connectionId: "connection_a",
    provider: "codex",
    operation,
    requestId: "request_1",
  };
  const rateBudget = new TestRateBudget(options.rateConsume);
  const execute =
    options.execute ??
    (async (input: unknown) => ({ echoed: input, source: "server-registry" }));
  const registry = new CodexOperationRegistry([
    {
      operation,
      protocolVersion: options.protocolVersion,
      parseInput:
        options.parseInput ??
        ((input) => {
          if (typeof input !== "string" || input.length > 128) {
            throw new Error("invalid chat input");
          }
          return input;
        }),
      execute,
    },
  ]);
  const route: GatewayRoute = {
    method: "POST" as const,
    path: `/internal/v1/codex/${operation}` as const,
    operation,
    ...(options.protocolVersion === undefined
      ? {}
      : {
          resourceAuthority: {
            ...(operation === "mind-map-generation"
              ? {
                  type: "owner-bootstrap" as const,
                  intent: "create-first-mindmap" as const,
                }
              : {
                  type: "owned-mindmap" as const,
                  id: "canonical-map-1",
                }),
          },
        }),
    rateBudget: {
      endpoint: `codex.${operation}`,
      ownerLimit: 4,
      globalLimit: 40,
      windowSeconds: 60,
    },
  };
  const dispatch = createGatewayDispatcher({
    route,
    expected,
    clock,
    replayDefense: options.replayDefense ?? new BoundedReplayCache(32),
    verificationKeys,
    rateBudget,
    operationRegistry: registry,
    maxBodyBytes: options.maxBodyBytes ?? 64,
    maxBodyChunks: options.maxBodyChunks ?? 32,
    bodyReadTimeoutMs: options.bodyReadTimeoutMs ?? 1_000,
    rateBudgetTimeoutMs: options.rateBudgetTimeoutMs ?? 1_000,
    replayDefenseTimeoutMs: options.replayDefenseTimeoutMs ?? 1_000,
    executionTimeoutMs: options.timeoutMs ?? 1_000,
  });

  return {
    clock,
    dispatch,
    expected,
    privateKey,
    rateBudget,
    route,
    signingKey,
    verificationKeys,
  };
}

/** Issues one signed request token, optionally targeting a different context. */
function issueToken(
  fixture: Fixture,
  overrides: Partial<{
    connectionId: string;
    nonce: string;
    operation: GatewayOperation;
    requestId: string;
    subject: string;
  }> = {}
): string {
  return issueInternalAssertion(
    {
      issuer: fixture.expected.issuer,
      audience: fixture.expected.audience,
      subject: overrides.subject ?? fixture.expected.subject,
      connectionId: overrides.connectionId ?? fixture.expected.connectionId,
      operation: overrides.operation ?? fixture.expected.operation,
      requestId: overrides.requestId ?? fixture.expected.requestId,
      nonce: overrides.nonce ?? "nonce_1",
    },
    fixture.signingKey,
    fixture.clock
  );
}

/** Re-signs controlled raw JSON so authenticated-invalid cases reach validation. */
function rewriteSignedToken(
  token: string,
  privateKey: KeyObject,
  mutate: Readonly<{
    header?: (value: Record<string, unknown>) => void;
    claims?: (value: Record<string, unknown>) => void;
    prettyHeader?: boolean;
    prettyClaims?: boolean;
  }>
): string {
  const [encodedHeader, encodedClaims] = token.split(".");
  const header = JSON.parse(
    Buffer.from(encodedHeader, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  const claims = JSON.parse(
    Buffer.from(encodedClaims, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  mutate.header?.(header);
  mutate.claims?.(claims);
  const nextHeader = Buffer.from(
    JSON.stringify(header, null, mutate.prettyHeader ? 2 : undefined)
  ).toString("base64url");
  const nextClaims = Buffer.from(
    JSON.stringify(claims, null, mutate.prettyClaims ? 2 : undefined)
  ).toString("base64url");
  const signingInput = `${nextHeader}.${nextClaims}`;
  const signature = signBytes(
    null,
    Buffer.from(signingInput),
    privateKey
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

/** Produces a byte-stream request with strict defaults and overridable fields. */
function createRequest(
  fixture: Fixture,
  options: Partial<{
    body: AsyncIterable<Uint8Array>;
    contentLength: string;
    contentType: string;
    headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    method: string;
    path: string;
    signal: AbortSignal;
    token: string;
  }> = {}
): GatewayRequestEnvelope {
  const json = JSON.stringify({ input: "hello" });
  const token = options.token ?? issueToken(fixture);
  return {
    method: options.method ?? "POST",
    path: options.path ?? `/internal/v1/codex/${fixture.expected.operation}`,
    headers: options.headers ?? {
      authorization: `Bearer ${token}`,
      "content-type": options.contentType ?? "application/json",
      ...(options.contentLength === undefined
        ? {}
        : { "content-length": options.contentLength }),
    },
    body: options.body ?? chunks(json),
    signal: options.signal,
  };
}

/** Converts text chunks into a transport-neutral async byte stream. */
async function* chunks(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

/** Creates one valid versioned chat request for stream lifecycle tests. */
function createProtocolChatRequest(
  fixture: Fixture,
  signal?: AbortSignal
): GatewayRequestEnvelope {
  return createRequest(fixture, {
    body: chunks(
      JSON.stringify({
        input: {
          version: 1,
          operation: "chat",
          resource: { type: "owned-mindmap", id: "canonical-map-1" },
          input: {
            instructions: "Help",
            conversation: "user: hello",
            toolManifest: "[]",
          },
        },
      })
    ),
    signal,
  });
}

/** Creates a body whose first read stalls until dispatcher cancellation. */
function createStalledBody(): Readonly<{
  body: AsyncIterable<Uint8Array>;
  cleanupCalls: () => number;
  started: Promise<void>;
}> {
  let cleanupCount = 0;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const iterator: AsyncIterator<Uint8Array> = {
    next() {
      markStarted?.();
      return new Promise<IteratorResult<Uint8Array>>(() => undefined);
    },
    async return() {
      cleanupCount += 1;
      return { done: true, value: undefined };
    },
  };
  return {
    body: {
      [Symbol.asyncIterator]: () => iterator,
    },
    cleanupCalls: () => cleanupCount,
    started,
  };
}

/** Creates a manually settled promise for late control-plane result tests. */
function createDeferred(): Readonly<{
  promise: Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
}> {
  let rejectPromise: ((error: unknown) => void) | undefined;
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: (error) => rejectPromise?.(error),
    resolve: () => resolvePromise?.(),
  };
}

/** Creates a valid body that records whether ingestion ever began. */
function createObservedBody(): Readonly<{
  body: AsyncIterable<Uint8Array>;
  wasRead: () => boolean;
}> {
  let read = false;
  return {
    body: (async function* () {
      read = true;
      yield Buffer.from(JSON.stringify({ input: "hello" }));
    })(),
    wasRead: () => read,
  };
}

/** Reads the stable error code without relying on implementation messages. */
function responseCode(
  response: Awaited<ReturnType<GatewayDispatcher>>
): string | undefined {
  return "ok" in response.body && !response.body.ok
    ? response.body.error.code
    : undefined;
}

describe("gateway dispatcher", () => {
  it("dispatches an exact authenticated Codex operation through server policy", async () => {
    const fixture = createFixture();
    const response = await fixture.dispatch(createRequest(fixture));

    expect(response).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        ok: true,
        data: { echoed: "hello", source: "server-registry" },
      },
    });
    expect(fixture.rateBudget.attempts).toEqual([
      {
        ownerSubject: "owner_a",
        connectionId: "connection_a",
        requestId: "request_1",
        policy: {
          endpoint: "codex.chat",
          ownerLimit: 4,
          globalLimit: 40,
          windowSeconds: 60,
        },
      },
    ]);
  });

  it("binds a versioned chat envelope to route authority and returns a byte stream", async () => {
    const output = (async function* () {
      yield { type: "start" };
      yield { type: "text-delta", id: "text-1", delta: "answer" };
    })();
    const execute = vi.fn(async () => output);
    const fixture = createFixture({
      protocolVersion: 1,
      maxBodyBytes: 4_096,
      execute,
      parseInput: (input) => input,
    });
    const envelope = {
      version: 1,
      operation: "chat",
      resource: { type: "owned-mindmap", id: "canonical-map-1" },
      input: {
        instructions: "Help with the map",
        conversation: "user: hello",
        toolManifest: "[]",
      },
    };

    const response = await fixture.dispatch(
      createRequest(fixture, {
        body: chunks(JSON.stringify({ input: envelope })),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers).toEqual({
      "content-type": GATEWAY_CHAT_STREAM_CONTENT_TYPE,
    });
    expect(Symbol.asyncIterator in response.body).toBe(true);
    if (!(Symbol.asyncIterator in response.body))
      throw new Error("expected stream");
    const frames: string[] = [];
    for await (const frame of response.body) {
      frames.push(new TextDecoder().decode(frame));
    }
    expect(frames).toEqual([
      '{"version":1,"event":{"type":"start"}}\n',
      '{"version":1,"event":{"type":"text-delta","id":"text-1","delta":"answer"}}\n',
    ]);
    expect(execute).toHaveBeenCalledWith(
      envelope.input,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("rejects a canonical resource mismatch before operation execution", async () => {
    const execute = vi.fn();
    const fixture = createFixture({
      protocolVersion: 1,
      maxBodyBytes: 4_096,
      execute,
      parseInput: (input) => input,
    });
    const response = await fixture.dispatch(
      createRequest(fixture, {
        body: chunks(
          JSON.stringify({
            input: {
              version: 1,
              operation: "chat",
              resource: { type: "owned-mindmap", id: "other-map" },
              input: {
                instructions: "Help",
                conversation: "user: hello",
                toolManifest: "[]",
              },
            },
          })
        ),
      })
    );

    expect(responseCode(response)).toBe("invalid_request");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a chat-to-action response swap with a stable gateway failure", async () => {
    const fixture = createFixture({
      protocolVersion: 1,
      maxBodyBytes: 4_096,
      parseInput: (input) => input,
      execute: async () => ({ secret: SECRET_CANARY }),
    });
    const response = await fixture.dispatch(
      createRequest(fixture, {
        body: chunks(
          JSON.stringify({
            input: {
              version: 1,
              operation: "chat",
              resource: { type: "owned-mindmap", id: "canonical-map-1" },
              input: {
                instructions: "Help",
                conversation: "user: hello",
                toolManifest: "[]",
              },
            },
          })
        ),
      })
    );

    expect(responseCode(response)).toBe("operation_failed");
  });

  it("derives mandatory v1 response contracts from each operation", () => {
    const registry = new CodexOperationRegistry([
      {
        operation: "chat",
        protocolVersion: 1,
        parseInput: (input) => input,
        execute: async () => (async function* () {})(),
        responseKind: "json",
      } as CodexOperationDefinition,
      {
        operation: "mind-map-generation",
        protocolVersion: 1,
        parseInput: (input) => input,
        execute: async () => null,
        responseKind: "stream",
        parseOutput: (output: unknown) => output,
      } as CodexOperationDefinition,
      {
        operation: "node-editing",
        protocolVersion: 1,
        parseInput: (input) => input,
        execute: async () => null,
      },
    ]);

    expect(registry.get("chat")?.responseKind).toBe("stream");
    expect(registry.get("chat")?.parseOutput).toBeUndefined();
    expect(registry.get("mind-map-generation")?.responseKind).toBe("json");
    expect(() =>
      registry.get("mind-map-generation")?.parseOutput?.({ arbitrary: true })
    ).toThrow();
    expect(() =>
      registry.get("node-editing")?.parseOutput?.({
        version: 1,
        operation: "mind-map-generation",
        rawOutput: "wrong operation",
        output: { name: "Map", nodes: [{ title: "Node", children: [] }] },
      })
    ).toThrow();
  });

  it("always validates action output and rejects an action-to-stream swap", async () => {
    const bootstrapEnvelope = {
      version: 1,
      operation: "mind-map-generation",
      resource: {
        type: "owner-bootstrap",
        intent: "create-first-mindmap",
      },
      input: { instructions: "Generate", prompt: "Systems" },
    };
    for (const invalidOutput of [
      { arbitrary: true },
      (async function* () {
        yield { type: "start" };
      })(),
    ]) {
      const fixture = createFixture({
        operation: "mind-map-generation",
        protocolVersion: 1,
        maxBodyBytes: 4_096,
        parseInput: (input) => input,
        execute: async () => invalidOutput,
      });
      const response = await fixture.dispatch(
        createRequest(fixture, {
          body: chunks(JSON.stringify({ input: bootstrapEnvelope })),
        })
      );
      expect(responseCode(response)).toBe("operation_failed");
    }

    const validFixture = createFixture({
      operation: "mind-map-generation",
      protocolVersion: 1,
      maxBodyBytes: 4_096,
      parseInput: (input) => input,
      execute: async () => ({
        version: 1,
        operation: "mind-map-generation",
        rawOutput: "raw",
        output: { name: "Systems", nodes: [{ title: "Root", children: [] }] },
      }),
    });
    const validResponse = await validFixture.dispatch(
      createRequest(validFixture, {
        body: chunks(JSON.stringify({ input: bootstrapEnvelope })),
      })
    );
    expect(validResponse).toMatchObject({
      status: 200,
      body: { ok: true, data: { operation: "mind-map-generation" } },
    });
  });

  it.each(["deadline", "request abort"] as const)(
    "owns provider iteration through %s and closes it exactly once",
    async (outcome) => {
      let providerSignal: AbortSignal | undefined;
      const returnIterator = vi.fn(async () => ({
        done: true as const,
        value: undefined,
      }));
      const execute = vi.fn(
        async (_input: unknown, context: { signal: AbortSignal }) => {
          providerSignal = context.signal;
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () =>
                  new Promise<IteratorResult<unknown>>(() => undefined),
                return: returnIterator,
              };
            },
          };
        }
      );
      const fixture = createFixture({
        protocolVersion: 1,
        maxBodyBytes: 4_096,
        timeoutMs: outcome === "deadline" ? 10 : 1_000,
        execute,
        parseInput: (input) => input,
      });
      const controller = new AbortController();
      const response = await fixture.dispatch(
        createProtocolChatRequest(
          fixture,
          outcome === "request abort" ? controller.signal : undefined
        )
      );
      if (!(Symbol.asyncIterator in response.body)) {
        throw new Error("expected stream");
      }
      const iterator = response.body[Symbol.asyncIterator]();
      const pending = iterator.next();
      if (outcome === "request abort")
        controller.abort(new Error(SECRET_CANARY));

      await expect(pending).rejects.toMatchObject({
        code: outcome === "deadline" ? "request_timeout" : "request_aborted",
        message: "Gateway request was rejected",
      });
      expect(providerSignal?.aborted).toBe(true);
      await vi.waitFor(() => expect(returnIterator).toHaveBeenCalledTimes(1));
    }
  );

  it("maps provider next and return rejection to stable secret-free errors", async () => {
    const returnIterator = vi.fn(async () => {
      throw new Error(SECRET_CANARY);
    });
    const fixture = createFixture({
      protocolVersion: 1,
      maxBodyBytes: 4_096,
      parseInput: (input) => input,
      execute: async () => ({
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              throw new Error(SECRET_CANARY);
            },
            return: returnIterator,
          };
        },
      }),
    });
    const response = await fixture.dispatch(createProtocolChatRequest(fixture));
    if (!(Symbol.asyncIterator in response.body)) {
      throw new Error("expected stream");
    }
    const iterator = response.body[Symbol.asyncIterator]();

    const nextError = await iterator.next().then(
      () => null,
      (error: unknown) => error
    );
    expect(nextError).toMatchObject({
      code: "operation_failed",
      message: "Gateway request was rejected",
    });
    expect(String(nextError)).not.toContain(SECRET_CANARY);
    expect(returnIterator).toHaveBeenCalledTimes(1);
  });

  it("maps an explicit provider return rejection without reflecting it", async () => {
    const fixture = createFixture({
      protocolVersion: 1,
      maxBodyBytes: 4_096,
      parseInput: (input) => input,
      execute: async () => ({
        [Symbol.asyncIterator]() {
          return {
            next: async () => ({
              done: false as const,
              value: { type: "start" },
            }),
            return: async () => {
              throw new Error(SECRET_CANARY);
            },
          };
        },
      }),
    });
    const response = await fixture.dispatch(createProtocolChatRequest(fixture));
    if (!(Symbol.asyncIterator in response.body)) {
      throw new Error("expected stream");
    }
    const iterator = response.body[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });

    const returnError = await iterator.return?.().then(
      () => null,
      (error: unknown) => error
    );
    expect(returnError).toMatchObject({
      code: "operation_failed",
      message: "Gateway request was rejected",
    });
    expect(String(returnError)).not.toContain(SECRET_CANARY);
  });

  it("snapshots server route, context, and rate policy at creation", async () => {
    const fixture = createFixture();
    const token = issueToken(fixture);
    (fixture.expected as { subject: string }).subject = "owner_mutated";
    (fixture.route as { path: string }).path = "/mutated";
    (fixture.route.rateBudget as { ownerLimit: number }).ownerLimit = 999;

    const response = await fixture.dispatch(createRequest(fixture, { token }));
    expect(response.status).toBe(200);
    expect(fixture.rateBudget.attempts[0]).toMatchObject({
      ownerSubject: "owner_a",
      policy: { ownerLimit: 4 },
    });
  });

  it("rejects unknown routes and wrong methods before auth, replay, or budgets", async () => {
    const fixture = createFixture();
    const token = issueToken(fixture);

    const unknown = await fixture.dispatch(
      createRequest(fixture, { path: "/internal/v1/codex/unknown", token })
    );
    const wrongMethod = await fixture.dispatch(
      createRequest(fixture, { method: "GET", token })
    );
    const accepted = await fixture.dispatch(createRequest(fixture, { token }));

    expect([unknown.status, responseCode(unknown)]).toEqual([404, "not_found"]);
    expect([wrongMethod.status, responseCode(wrongMethod)]).toEqual([
      405,
      "method_not_allowed",
    ]);
    expect(accepted.status).toBe(200);
    expect(fixture.rateBudget.attempts).toHaveLength(1);
  });

  it.each([
    ["missing", {}],
    ["wrong scheme", { authorization: "Basic abc" }],
    ["duplicate", { authorization: ["Bearer one", "Bearer two"] }],
    [
      "case-duplicate",
      { authorization: "Bearer one", Authorization: "Bearer two" },
    ],
    ["malformed token", { authorization: "Bearer not.a.valid.token" }],
  ] as const)(
    "rejects a %s assertion header without charging",
    async (_label, headers) => {
      const fixture = createFixture();
      const response = await fixture.dispatch(
        createRequest(fixture, {
          headers: { ...headers, "content-type": "application/json" },
        })
      );

      expect([response.status, responseCode(response)]).toEqual([
        401,
        "unauthorized",
      ]);
      expect(fixture.rateBudget.attempts).toHaveLength(0);
    }
  );

  it.each(["subject", "connection", "operation", "provider"] as const)(
    "charges an authentically signed %s mismatch before denying it",
    async (kind) => {
      const fixture = createFixture();
      let token = issueToken(fixture, {
        ...(kind === "subject" ? { subject: "owner_b" } : {}),
        ...(kind === "connection" ? { connectionId: "connection_b" } : {}),
        ...(kind === "operation" ? { operation: "node-editing" } : {}),
      });
      if (kind === "provider") {
        token = rewriteSignedToken(token, fixture.privateKey, {
          claims: (claims) => {
            claims.provider = "claude";
          },
        });
      }

      const response = await fixture.dispatch(
        createRequest(fixture, { token })
      );
      expect([response.status, responseCode(response)]).toEqual([
        401,
        "unauthorized",
      ]);
      expect(fixture.rateBudget.attempts).toHaveLength(1);
    }
  );

  it.each(["noncanonical", "header", "claim", "kid"] as const)(
    "charges a configured-key signature before rejecting invalid %s data",
    async (kind) => {
      const fixture = createFixture();
      const token = rewriteSignedToken(
        issueToken(fixture),
        fixture.privateKey,
        {
          ...(kind === "noncanonical" ? { prettyClaims: true } : {}),
          ...(kind === "header"
            ? {
                header: (header: Record<string, unknown>) => {
                  header.algorithm = "not-EdDSA";
                },
              }
            : {}),
          ...(kind === "claim"
            ? {
                claims: (claims: Record<string, unknown>) => {
                  claims.subject = "";
                },
              }
            : {}),
          ...(kind === "kid"
            ? {
                header: (header: Record<string, unknown>) => {
                  header.kid = "configured-key-alias-mismatch";
                },
                claims: (claims: Record<string, unknown>) => {
                  claims.kid = "configured-key-alias-mismatch";
                },
              }
            : {}),
        }
      );

      const response = await fixture.dispatch(
        createRequest(fixture, { token })
      );
      expect([response.status, responseCode(response)]).toEqual([
        401,
        "unauthorized",
      ]);
      expect(fixture.rateBudget.attempts).toHaveLength(1);
    }
  );

  it("does not charge unknown-key or signature-tampered assertions", async () => {
    const fixture = createFixture();
    const unknownKeys = generateKeyPairSync("ed25519");
    const unknownToken = issueInternalAssertion(
      {
        ...fixture.expected,
        nonce: "unknown_nonce",
      },
      { keyId: "unknown-key", privateKey: unknownKeys.privateKey },
      fixture.clock
    );
    const validToken = issueToken(fixture, { nonce: "tampered_nonce" });
    const [header, claims, signature] = validToken.split(".");
    const signatureBytes = Buffer.from(signature, "base64url");
    signatureBytes[0] ^= 0x01;
    const tamperedToken = `${header}.${claims}.${signatureBytes.toString("base64url")}`;

    for (const token of [unknownToken, tamperedToken]) {
      const response = await fixture.dispatch(
        createRequest(fixture, { token })
      );
      expect([response.status, responseCode(response)]).toEqual([
        401,
        "unauthorized",
      ]);
    }
    expect(fixture.rateBudget.attempts).toHaveLength(0);
  });

  it("keeps a signed context rejection unauthorized when charging is unavailable", async () => {
    const fixture = createFixture();
    fixture.rateBudget.failure = new Error(SECRET_CANARY);
    const token = issueToken(fixture, { subject: "owner_b" });

    const response = await fixture.dispatch(createRequest(fixture, { token }));
    expect([response.status, responseCode(response)]).toEqual([
      401,
      "unauthorized",
    ]);
    expect(fixture.rateBudget.attempts).toHaveLength(1);
    expect(JSON.stringify(response)).not.toContain(SECRET_CANARY);
  });

  it("consumes replay state for a valid assertion rejected by the rate budget", async () => {
    const fixture = createFixture();
    fixture.rateBudget.failure = new RateBudgetError("exhausted");
    const token = issueToken(fixture);
    const limited = await fixture.dispatch(createRequest(fixture, { token }));
    fixture.rateBudget.failure = undefined;
    const replay = await fixture.dispatch(createRequest(fixture, { token }));

    expect([limited.status, responseCode(limited)]).toEqual([
      429,
      "rate_limited",
    ]);
    expect([replay.status, responseCode(replay)]).toEqual([
      401,
      "unauthorized",
    ]);
    expect(fixture.rateBudget.attempts).toHaveLength(2);
  });

  it("charges replayed assertions while preserving an unauthorized response", async () => {
    const fixture = createFixture();
    const token = issueToken(fixture);
    expect(
      (await fixture.dispatch(createRequest(fixture, { token }))).status
    ).toBe(200);

    const replay = await fixture.dispatch(createRequest(fixture, { token }));
    expect([replay.status, responseCode(replay)]).toEqual([
      401,
      "unauthorized",
    ]);
    expect(fixture.rateBudget.attempts).toHaveLength(2);
  });

  it.each([
    [new RateBudgetError("exhausted"), 429, "rate_limited"],
    [new RateBudgetError("unavailable"), 503, "rate_limit_unavailable"],
    [
      new Error(`redis://${SECRET_CANARY}@private`),
      503,
      "rate_limit_unavailable",
    ],
  ] as const)(
    "fails closed when the budget rejects",
    async (failure, status, code) => {
      const fixture = createFixture();
      fixture.rateBudget.failure = failure;
      const response = await fixture.dispatch(createRequest(fixture));

      expect([response.status, responseCode(response)]).toEqual([status, code]);
      expect(JSON.stringify(response)).not.toContain(SECRET_CANARY);
    }
  );

  it("times out a stalled rate store, cancels it, and observes a late rejection", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let storeContext: ControlPlaneOperationContext | undefined;
    const execute = vi.fn();
    const body = createObservedBody();
    try {
      const fixture = createFixture({
        execute,
        rateBudgetTimeoutMs: 25,
        rateConsume: (context) => {
          storeContext = context;
          return deferred.promise;
        },
      });
      const token = issueToken(fixture);
      const pending = fixture.dispatch(
        createRequest(fixture, { body: body.body, token })
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(storeContext?.deadlineAtMilliseconds).toBeGreaterThanOrEqual(
        Date.now()
      );

      await vi.advanceTimersByTimeAsync(25);
      const response = await pending;
      expect([response.status, responseCode(response)]).toEqual([
        503,
        "rate_limit_unavailable",
      ]);
      expect(storeContext?.signal.aborted).toBe(true);
      expect(body.wasRead()).toBe(false);
      expect(execute).not.toHaveBeenCalled();

      deferred.reject(new Error(SECRET_CANARY));
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).not.toHaveBeenCalled();

      const retryBody = createObservedBody();
      const retry = await fixture.dispatch(
        createRequest(fixture, { body: retryBody.body, token })
      );
      expect([retry.status, responseCode(retry)]).toEqual([
        401,
        "unauthorized",
      ]);
      expect(retryBody.wasRead()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      process.removeListener("unhandledRejection", unhandled);
      vi.useRealTimers();
    }
  });

  it("fences a same-tick post-auth abort before returning 499", async () => {
    const execute = vi.fn();
    const body = createObservedBody();
    const fixture = createFixture({ execute });
    const token = issueToken(fixture);
    const controller = new AbortController();

    // Dispatch authenticates synchronously before its first awaited store call.
    const pending = fixture.dispatch(
      createRequest(fixture, {
        body: body.body,
        signal: controller.signal,
        token,
      })
    );
    controller.abort(SECRET_CANARY);

    const response = await pending;
    const retryBody = createObservedBody();
    const retry = await fixture.dispatch(
      createRequest(fixture, { body: retryBody.body, token })
    );
    expect([response.status, responseCode(response)]).toEqual([
      499,
      "request_aborted",
    ]);
    expect([retry.status, responseCode(retry)]).toEqual([401, "unauthorized"]);
    expect(fixture.rateBudget.attempts).toHaveLength(2);
    expect(body.wasRead()).toBe(false);
    expect(retryBody.wasRead()).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows rate accounting to commit after caller abort before returning 499", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred();
    let storeContext: ControlPlaneOperationContext | undefined;
    const execute = vi.fn();
    const body = createObservedBody();
    try {
      const fixture = createFixture({
        execute,
        rateConsume: (context) => {
          storeContext = context;
          return deferred.promise;
        },
      });
      const token = issueToken(fixture);
      const controller = new AbortController();
      const pending = fixture.dispatch(
        createRequest(fixture, {
          body: body.body,
          signal: controller.signal,
          token,
        })
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(storeContext).toBeDefined();
      controller.abort(SECRET_CANARY);
      await vi.advanceTimersByTimeAsync(0);
      expect(storeContext?.signal.aborted).toBe(false);
      deferred.resolve();
      await vi.advanceTimersByTimeAsync(0);

      const response = await pending;
      expect([response.status, responseCode(response)]).toEqual([
        499,
        "request_aborted",
      ]);
      const retryBody = createObservedBody();
      const retry = await fixture.dispatch(
        createRequest(fixture, { body: retryBody.body, token })
      );
      expect([retry.status, responseCode(retry)]).toEqual([
        401,
        "unauthorized",
      ]);
      expect(body.wasRead()).toBe(false);
      expect(retryBody.wasRead()).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a stalled replay store, cancels it, and observes a late resolve", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred();
    let replayContext: ControlPlaneOperationContext | undefined;
    const replayDefense: ReplayDefense = {
      consume(_entry, _nowSeconds, context) {
        replayContext = context;
        return deferred.promise;
      },
    };
    const execute = vi.fn();
    const body = createObservedBody();
    try {
      const fixture = createFixture({
        execute,
        replayDefense,
        replayDefenseTimeoutMs: 25,
      });
      const pending = fixture.dispatch(
        createRequest(fixture, { body: body.body })
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(replayContext).toBeDefined();

      await vi.advanceTimersByTimeAsync(25);
      const response = await pending;
      expect([response.status, responseCode(response)]).toEqual([
        503,
        "replay_defense_unavailable",
      ]);
      expect(replayContext?.signal.aborted).toBe(true);
      expect(body.wasRead()).toBe(false);
      expect(execute).not.toHaveBeenCalled();

      deferred.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows replay accounting to commit after caller abort before returning 499", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred();
    let replayContext: ControlPlaneOperationContext | undefined;
    let consumed = false;
    const replayDefense: ReplayDefense = {
      consume(_entry, _nowSeconds, context) {
        replayContext = context;
        if (consumed) throw new ReplayDefenseError("replay_detected");
        return deferred.promise.then(() => {
          consumed = true;
        });
      },
    };
    const execute = vi.fn();
    const body = createObservedBody();
    try {
      const fixture = createFixture({ execute, replayDefense });
      const token = issueToken(fixture);
      const controller = new AbortController();
      const pending = fixture.dispatch(
        createRequest(fixture, {
          body: body.body,
          signal: controller.signal,
          token,
        })
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(replayContext).toBeDefined();
      controller.abort(SECRET_CANARY);
      await vi.advanceTimersByTimeAsync(0);
      expect(replayContext?.signal.aborted).toBe(false);
      deferred.resolve();
      await vi.advanceTimersByTimeAsync(0);

      const response = await pending;
      expect([response.status, responseCode(response)]).toEqual([
        499,
        "request_aborted",
      ]);
      const retryBody = createObservedBody();
      const retry = await fixture.dispatch(
        createRequest(fixture, { body: retryBody.body, token })
      );
      expect([retry.status, responseCode(retry)]).toEqual([
        401,
        "unauthorized",
      ]);
      expect(body.wasRead()).toBe(false);
      expect(retryBody.wasRead()).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes replay after an ambiguous rate timeout despite caller abort", async () => {
    vi.useFakeTimers();
    const replayCommit = createDeferred();
    let replayContext: ControlPlaneOperationContext | undefined;
    let consumed = false;
    const replayDefense: ReplayDefense = {
      consume(_entry, _nowSeconds, context) {
        replayContext = context;
        if (consumed) throw new ReplayDefenseError("replay_detected");
        return replayCommit.promise.then(() => {
          consumed = true;
        });
      },
    };
    const execute = vi.fn();
    const body = createObservedBody();
    try {
      const fixture = createFixture({
        execute,
        rateBudgetTimeoutMs: 25,
        rateConsume: () => new Promise<void>(() => undefined),
        replayDefense,
        replayDefenseTimeoutMs: 100,
      });
      const token = issueToken(fixture);
      const controller = new AbortController();
      const pending = fixture.dispatch(
        createRequest(fixture, {
          body: body.body,
          signal: controller.signal,
          token,
        })
      );

      await vi.advanceTimersByTimeAsync(25);
      expect(replayContext).toBeDefined();
      controller.abort(SECRET_CANARY);
      await vi.advanceTimersByTimeAsync(0);
      expect(replayContext?.signal.aborted).toBe(false);
      replayCommit.resolve();
      await vi.advanceTimersByTimeAsync(0);

      const response = await pending;
      expect([response.status, responseCode(response)]).toEqual([
        503,
        "rate_limit_unavailable",
      ]);
      expect(body.wasRead()).toBe(false);
      expect(execute).not.toHaveBeenCalled();

      const retryBody = createObservedBody();
      const retryPending = fixture.dispatch(
        createRequest(fixture, { body: retryBody.body, token })
      );
      await vi.advanceTimersByTimeAsync(25);
      const retry = await retryPending;
      expect([retry.status, responseCode(retry)]).toEqual([
        401,
        "unauthorized",
      ]);
      expect(retryBody.wasRead()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives replay unavailability precedence and honors a durable late commit", async () => {
    vi.useFakeTimers();
    const replayCommit = createDeferred();
    let replayContext: ControlPlaneOperationContext | undefined;
    let consumed = false;
    const replayDefense: ReplayDefense = {
      consume(_entry, _nowSeconds, context) {
        replayContext = context;
        if (consumed) throw new ReplayDefenseError("replay_detected");
        return replayCommit.promise.then(() => {
          consumed = true;
        });
      },
    };
    const execute = vi.fn();
    const body = createObservedBody();
    try {
      const fixture = createFixture({
        execute,
        rateBudgetTimeoutMs: 25,
        rateConsume: () => new Promise<void>(() => undefined),
        replayDefense,
        replayDefenseTimeoutMs: 25,
      });
      const token = issueToken(fixture);
      const controller = new AbortController();
      const pending = fixture.dispatch(
        createRequest(fixture, {
          body: body.body,
          signal: controller.signal,
          token,
        })
      );

      await vi.advanceTimersByTimeAsync(25);
      expect(replayContext).toBeDefined();
      controller.abort(SECRET_CANARY);
      expect(replayContext?.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(25);

      const response = await pending;
      expect([response.status, responseCode(response)]).toEqual([
        503,
        "replay_defense_unavailable",
      ]);
      expect(replayContext?.signal.aborted).toBe(true);
      expect(body.wasRead()).toBe(false);
      expect(execute).not.toHaveBeenCalled();

      // A durable store may commit after its response deadline. The attached
      // observer records that completion, and recovery rejects the exact token.
      replayCommit.resolve();
      await vi.advanceTimersByTimeAsync(0);
      const retryBody = createObservedBody();
      const retryPending = fixture.dispatch(
        createRequest(fixture, { body: retryBody.body, token })
      );
      await vi.advanceTimersByTimeAsync(25);
      const retry = await retryPending;
      expect([retry.status, responseCode(retry)]).toEqual([
        401,
        "unauthorized",
      ]);
      expect(retryBody.wasRead()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("charges valid owners before content, length, JSON, and operation validation", async () => {
    const scenarios: Array<(fixture: Fixture) => GatewayRequestEnvelope> = [
      (fixture) =>
        createRequest(fixture, {
          contentType: "application/json; charset=utf-8",
        }),
      (fixture) => createRequest(fixture, { contentLength: "999" }),
      (fixture) => createRequest(fixture, { body: chunks("{not-json") }),
      (fixture) =>
        createRequest(fixture, { body: chunks(JSON.stringify({ input: 42 })) }),
      (fixture) =>
        createRequest(fixture, {
          body: chunks(
            JSON.stringify({
              input: "hello",
              operation: "node-editing",
              provider: "claude",
              command: "arbitrary",
              env: { CODEX_HOME: "/attacker" },
              model: "attacker-model",
              cwd: "/private",
            })
          ),
        }),
    ];

    for (const scenario of scenarios) {
      const fixture = createFixture();
      const response = await fixture.dispatch(scenario(fixture));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(fixture.rateBudget.attempts).toHaveLength(1);
    }
  });

  it("rejects an oversized declared body before iterating its stream", async () => {
    const fixture = createFixture({ maxBodyBytes: 16 });
    let iterated = false;
    async function* untouchedBody(): AsyncIterable<Uint8Array> {
      iterated = true;
      yield Buffer.from("{}");
    }

    const response = await fixture.dispatch(
      createRequest(fixture, { body: untouchedBody(), contentLength: "17" })
    );
    expect([response.status, responseCode(response), iterated]).toEqual([
      413,
      "payload_too_large",
      false,
    ]);
    expect(fixture.rateBudget.attempts).toHaveLength(1);
  });

  it("bounds decoded chunked bodies and closes the source on overflow", async () => {
    const fixture = createFixture({ maxBodyBytes: 24 });
    let closed = false;
    async function* chunkedBody(): AsyncIterable<Uint8Array> {
      try {
        yield Buffer.from('{"input":"');
        yield Buffer.from("x".repeat(24));
        yield Buffer.from('"}');
      } finally {
        closed = true;
      }
    }

    const response = await fixture.dispatch(
      createRequest(fixture, { body: chunkedBody() })
    );
    expect([response.status, responseCode(response), closed]).toEqual([
      413,
      "payload_too_large",
      true,
    ]);
  });

  it("rejects zero-byte chunk floods and requests iterator cleanup", async () => {
    const fixture = createFixture();
    let closed = false;
    async function* zeroByteFlood(): AsyncIterable<Uint8Array> {
      try {
        while (true) yield new Uint8Array();
      } finally {
        closed = true;
      }
    }

    const response = await fixture.dispatch(
      createRequest(fixture, { body: zeroByteFlood() })
    );
    expect([response.status, responseCode(response), closed]).toEqual([
      400,
      "invalid_request",
      true,
    ]);
  });

  it("accepts at most the configured number of one-byte chunks", async () => {
    const json = JSON.stringify({ input: "hello" });
    const exactFixture = createFixture({ maxBodyChunks: json.length });
    const overflowFixture = createFixture({ maxBodyChunks: json.length });
    const oneByteChunks = (value: string): AsyncIterable<Uint8Array> =>
      chunks(...value.split(""));

    const accepted = await exactFixture.dispatch(
      createRequest(exactFixture, { body: oneByteChunks(json) })
    );
    const rejected = await overflowFixture.dispatch(
      createRequest(overflowFixture, { body: oneByteChunks(`${json} `) })
    );
    expect(accepted.status).toBe(200);
    expect([rejected.status, responseCode(rejected)]).toEqual([
      413,
      "payload_too_large",
    ]);
  });

  it("aborts a stalled body read and requests iterator cleanup", async () => {
    const execute = vi.fn();
    const fixture = createFixture({ execute });
    const controller = new AbortController();
    const stalled = createStalledBody();
    const pending = fixture.dispatch(
      createRequest(fixture, { body: stalled.body, signal: controller.signal })
    );
    await stalled.started;
    controller.abort(SECRET_CANARY);

    const response = await pending;
    expect([response.status, responseCode(response)]).toEqual([
      499,
      "request_aborted",
    ]);
    expect(stalled.cleanupCalls()).toBe(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("times out a stalled body read and requests iterator cleanup", async () => {
    const execute = vi.fn();
    const fixture = createFixture({ bodyReadTimeoutMs: 10, execute });
    const stalled = createStalledBody();

    const response = await fixture.dispatch(
      createRequest(fixture, { body: stalled.body })
    );
    expect([response.status, responseCode(response)]).toEqual([
      504,
      "request_timeout",
    ]);
    expect(stalled.cleanupCalls()).toBe(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects malformed lengths, invalid UTF-8, and byte-count mismatch", async () => {
    const requests = [
      (fixture: Fixture) => createRequest(fixture, { contentLength: "+2" }),
      (fixture: Fixture) =>
        createRequest(fixture, {
          headers: {
            authorization: `Bearer ${issueToken(fixture)}`,
            "content-type": "application/json",
            "content-length": "17",
            "Content-Length": "17",
          },
        }),
      (fixture: Fixture) =>
        createRequest(fixture, {
          body: chunks(JSON.stringify({ input: "hello" })),
          contentLength: "1",
        }),
      (fixture: Fixture) =>
        createRequest(fixture, {
          body: (async function* () {
            yield Uint8Array.from([0xc3, 0x28]);
          })(),
        }),
      (fixture: Fixture) =>
        createRequest(fixture, {
          body: (async function* (emitChunk: boolean) {
            if (emitChunk) yield new Uint8Array();
            throw new Error(SECRET_CANARY);
          })(false),
        }),
    ];

    for (const createScenario of requests) {
      const fixture = createFixture();
      const response = await fixture.dispatch(createScenario(fixture));
      expect([response.status, responseCode(response)]).toEqual([
        400,
        "invalid_request",
      ]);
      expect(fixture.rateBudget.attempts).toHaveLength(1);
    }
  });

  it("does not invoke the operation when aborted before the handoff", async () => {
    const execute = vi.fn();
    const fixture = createFixture({ execute });
    const controller = new AbortController();
    controller.abort();

    const response = await fixture.dispatch(
      createRequest(fixture, { signal: controller.signal })
    );
    expect([response.status, responseCode(response)]).toEqual([
      499,
      "request_aborted",
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(fixture.rateBudget.attempts).toHaveLength(0);
  });

  it("honors an abort that arrives after validation but before execution", async () => {
    const controller = new AbortController();
    const execute = vi.fn();
    const fixture = createFixture({
      execute,
      parseInput: (input) => {
        controller.abort();
        return input;
      },
    });

    const response = await fixture.dispatch(
      createRequest(fixture, { signal: controller.signal })
    );
    expect([response.status, responseCode(response)]).toEqual([
      499,
      "request_aborted",
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(fixture.rateBudget.attempts).toHaveLength(1);
  });

  it("never executes when an abort settles ahead of the queued handoff", async () => {
    const controller = new AbortController();
    const execute = vi.fn();
    const fixture = createFixture({
      execute,
      parseInput: (input) => {
        // This abort microtask is queued before executeWithCancellation queues
        // its operation microtask, deterministically exercising the prior race.
        queueMicrotask(() => controller.abort());
        return input;
      },
    });

    const response = await fixture.dispatch(
      createRequest(fixture, { signal: controller.signal })
    );
    expect([response.status, responseCode(response)]).toEqual([
      499,
      "request_aborted",
    ]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("aborts an active operation without reflecting its eventual error", async () => {
    let operationSignal: AbortSignal | undefined;
    const fixture = createFixture({
      execute: async (_input, context) => {
        operationSignal = context.signal;
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new Error(SECRET_CANARY)),
            { once: true }
          );
        });
      },
    });
    const controller = new AbortController();
    const pending = fixture.dispatch(
      createRequest(fixture, { signal: controller.signal })
    );
    await vi.waitFor(() => expect(operationSignal).toBeDefined());
    controller.abort(SECRET_CANARY);

    const response = await pending;
    expect([
      response.status,
      responseCode(response),
      operationSignal?.aborted,
    ]).toEqual([499, "request_aborted", true]);
    expect(JSON.stringify(response)).not.toContain(SECRET_CANARY);
  });

  it("times out an operation, signals cancellation, and returns a fixed error", async () => {
    let operationSignal: AbortSignal | undefined;
    const fixture = createFixture({
      timeoutMs: 10,
      execute: async (_input, context) => {
        operationSignal = context.signal;
        await new Promise<void>(() => undefined);
      },
    });

    const response = await fixture.dispatch(createRequest(fixture));
    expect([
      response.status,
      responseCode(response),
      operationSignal?.aborted,
    ]).toEqual([504, "request_timeout", true]);
  });

  it("normalizes parser and operation errors without leaking secret canaries", async () => {
    const parserFailure = createFixture({
      parseInput: () => {
        throw new Error(SECRET_CANARY);
      },
    });
    const operationFailure = createFixture({
      execute: () => {
        throw new Error(SECRET_CANARY);
      },
    });

    const responses = await Promise.all([
      parserFailure.dispatch(createRequest(parserFailure)),
      operationFailure.dispatch(createRequest(operationFailure)),
    ]);
    expect(responses.map((response) => responseCode(response))).toEqual([
      "invalid_request",
      "operation_failed",
    ]);
    expect(JSON.stringify(responses)).not.toContain(SECRET_CANARY);
  });

  it("charges authenticated bytes before mapping later verifier configuration failure", async () => {
    const fixture = createFixture();
    const token = issueToken(fixture);
    fixture.clock.set(-1);

    const response = await fixture.dispatch(createRequest(fixture, { token }));
    expect([response.status, responseCode(response)]).toEqual([
      503,
      "gateway_configuration_unavailable",
    ]);
    expect(fixture.rateBudget.attempts).toHaveLength(1);
  });

  it("rejects invalid or incomplete server registries during startup", () => {
    expect(() => createFixture({ rateBudgetTimeoutMs: 0 })).toThrowError(
      "Gateway request was rejected"
    );
    expect(() =>
      createFixture({ replayDefenseTimeoutMs: 10_001 })
    ).toThrowError("Gateway request was rejected");

    const fixture = createFixture();
    expect(
      () =>
        new CodexOperationRegistry([
          {
            operation: "chat",
            parseInput: (input) => input,
            execute: () => undefined,
          },
          {
            operation: "chat",
            parseInput: (input) => input,
            execute: () => undefined,
          },
        ])
    ).toThrowError("Gateway request was rejected");

    const missingChat = new CodexOperationRegistry([
      {
        operation: "node-editing",
        parseInput: (input) => input,
        execute: () => undefined,
      },
    ]);
    expect(() =>
      createGatewayDispatcher({
        route: {
          method: "POST",
          path: "/internal/v1/codex/chat",
          operation: "chat",
          rateBudget: {
            endpoint: "codex.chat",
            ownerLimit: 1,
            globalLimit: 1,
            windowSeconds: 1,
          },
        },
        expected: fixture.expected,
        clock: fixture.clock,
        replayDefense: new BoundedReplayCache(1),
        verificationKeys: fixture.verificationKeys,
        rateBudget: fixture.rateBudget,
        operationRegistry: missingChat,
      })
    ).toThrowError("Gateway request was rejected");
  });
});
