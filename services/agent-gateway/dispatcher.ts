import {
  awaitControlPlaneOperation,
  type ControlPlaneOperationContext,
} from "./control-plane.ts";
import {
  type AuthenticatedInternalAssertion,
  authenticateInternalAssertion,
  type Clock,
  DEFAULT_REPLAY_DEFENSE_TIMEOUT_MS,
  type ExpectedAssertionContext,
  GATEWAY_OPERATIONS,
  type GatewayOperation,
  type InternalAssertionClaims,
  InternalAssertionError,
  MAX_REPLAY_DEFENSE_TIMEOUT_MS,
  type ReplayDefense,
  type VerificationKeys,
  verifyAuthenticatedInternalAssertion,
} from "./internal-auth.ts";

const DEFAULT_MAX_BODY_BYTES = 64 * 1_024;
const DEFAULT_MAX_BODY_CHUNKS = 256;
const DEFAULT_BODY_READ_TIMEOUT_MS = 5_000;
const DEFAULT_RATE_BUDGET_TIMEOUT_MS = 1_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 1024 * 1_024;
const MAX_BODY_CHUNKS = 4_096;
const MAX_BODY_READ_TIMEOUT_MS = 30_000;
const MAX_CONTROL_PLANE_TIMEOUT_MS = 10_000;
const MAX_EXECUTION_TIMEOUT_MS = 5 * 60_000;
const BODY_CLEANUP_GRACE_MS = 25;

type GatewayHeaderValue = string | readonly string[] | undefined;

type GatewayRequestEnvelope = Readonly<{
  method: string;
  path: string;
  headers: Readonly<Record<string, GatewayHeaderValue>>;
  body: AsyncIterable<Uint8Array>;
  signal?: AbortSignal;
}>;

type GatewayErrorCode =
  | "gateway_configuration_unavailable"
  | "invalid_request"
  | "method_not_allowed"
  | "not_found"
  | "operation_failed"
  | "payload_too_large"
  | "rate_limit_unavailable"
  | "rate_limited"
  | "replay_defense_unavailable"
  | "request_aborted"
  | "request_timeout"
  | "unauthorized"
  | "unsupported_media_type";

type GatewayErrorBody = Readonly<{
  ok: false;
  error: Readonly<{ code: GatewayErrorCode }>;
}>;

type GatewaySuccessBody = Readonly<{
  ok: true;
  data: unknown;
}>;

type GatewayResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: GatewayErrorBody | GatewaySuccessBody;
}>;

type RateBudgetPolicy = Readonly<{
  endpoint: string;
  ownerLimit: number;
  globalLimit: number;
  windowSeconds: number;
}>;

type RateBudgetAttempt = Readonly<{
  ownerSubject: string;
  connectionId: string;
  requestId: string;
  policy: RateBudgetPolicy;
}>;

interface RateBudget {
  consume(
    attempt: RateBudgetAttempt,
    context?: ControlPlaneOperationContext
  ): void | Promise<void>;
}

type RateBudgetErrorCode = "exhausted" | "unavailable";

/** Typed rate-store rejection whose implementation details never reach clients. */
class RateBudgetError extends Error {
  readonly code: RateBudgetErrorCode;

  constructor(code: RateBudgetErrorCode) {
    super("Gateway rate budget rejected the request");
    this.name = "RateBudgetError";
    this.code = code;
  }
}

type OperationExecutionContext = Readonly<{
  claims: InternalAssertionClaims;
  signal: AbortSignal;
}>;

type CodexOperationDefinition = Readonly<{
  operation: GatewayOperation;
  parseInput: (input: unknown) => unknown;
  execute: (
    input: unknown,
    context: OperationExecutionContext
  ) => unknown | Promise<unknown>;
}>;

/** Immutable server-owned operation lookup; transport input cannot mutate it. */
class CodexOperationRegistry {
  private readonly definitions: ReadonlyMap<
    GatewayOperation,
    CodexOperationDefinition
  >;

  constructor(definitions: readonly CodexOperationDefinition[]) {
    const entries = new Map<GatewayOperation, CodexOperationDefinition>();
    for (const definition of definitions) {
      if (!GATEWAY_OPERATIONS.includes(definition.operation)) {
        throw configurationError();
      }
      if (entries.has(definition.operation)) {
        throw configurationError();
      }
      entries.set(definition.operation, Object.freeze({ ...definition }));
    }
    if (entries.size === 0) {
      throw configurationError();
    }
    this.definitions = entries;
    Object.freeze(this);
  }

  /** Resolves only a compile-time gateway operation selected by server policy. */
  get(operation: GatewayOperation): CodexOperationDefinition | undefined {
    return this.definitions.get(operation);
  }
}

type GatewayRoute = Readonly<{
  method: "POST";
  path: `/${string}`;
  operation: GatewayOperation;
  rateBudget: RateBudgetPolicy;
}>;

type GatewayDispatcherOptions = Readonly<{
  route: GatewayRoute;
  expected: ExpectedAssertionContext;
  clock: Clock;
  replayDefense: ReplayDefense;
  verificationKeys: VerificationKeys;
  rateBudget: RateBudget;
  operationRegistry: CodexOperationRegistry;
  maxBodyBytes?: number;
  maxBodyChunks?: number;
  bodyReadTimeoutMs?: number;
  executionTimeoutMs?: number;
  rateBudgetTimeoutMs?: number;
  replayDefenseTimeoutMs?: number;
}>;

type GatewayDispatcher = (
  request: GatewayRequestEnvelope
) => Promise<GatewayResponse>;

/** Internal control-flow failure that is always rendered from a fixed code map. */
class GatewayRequestError extends Error {
  readonly code: GatewayErrorCode;

  constructor(code: GatewayErrorCode) {
    super("Gateway request was rejected");
    this.name = "GatewayRequestError";
    this.code = code;
  }
}

/**
 * Creates one deployment-neutral dispatcher for an exact server-owned route and
 * authorization context. The returned function never throws request failures.
 */
function createGatewayDispatcher(
  options: GatewayDispatcherOptions
): GatewayDispatcher {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxBodyChunks = options.maxBodyChunks ?? DEFAULT_MAX_BODY_CHUNKS;
  const bodyReadTimeoutMs =
    options.bodyReadTimeoutMs ?? DEFAULT_BODY_READ_TIMEOUT_MS;
  const rateBudgetTimeoutMs =
    options.rateBudgetTimeoutMs ?? DEFAULT_RATE_BUDGET_TIMEOUT_MS;
  const replayDefenseTimeoutMs =
    options.replayDefenseTimeoutMs ?? DEFAULT_REPLAY_DEFENSE_TIMEOUT_MS;
  const executionTimeoutMs =
    options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  assertDispatcherConfiguration(
    options,
    maxBodyBytes,
    maxBodyChunks,
    bodyReadTimeoutMs,
    rateBudgetTimeoutMs,
    replayDefenseTimeoutMs,
    executionTimeoutMs
  );
  const configuredOptions = snapshotDispatcherOptions(options);

  return async (request: GatewayRequestEnvelope): Promise<GatewayResponse> => {
    if (request.path !== configuredOptions.route.path) {
      return errorResponse("not_found");
    }
    if (request.method !== configuredOptions.route.method) {
      return errorResponse("method_not_allowed");
    }
    if (request.signal?.aborted) {
      return errorResponse("request_aborted");
    }

    const assertion = readBearerAssertion(request.headers);
    let authenticated: AuthenticatedInternalAssertion;
    try {
      authenticated = authenticateInternalAssertion(
        assertion,
        configuredOptions.verificationKeys
      );
    } catch (error) {
      if (
        error instanceof InternalAssertionError &&
        error.code === "internal_auth_configuration_invalid"
      ) {
        return errorResponse("gateway_configuration_unavailable");
      }
      return errorResponse("unauthorized");
    }

    // Signature authentication is the point of no cancellation for accounting.
    // Caller disconnect is recorded on the request signal and checked only after
    // independent bounded rate and replay mutations finish.
    const rateFailure = await consumeRateBudget(
      configuredOptions,
      rateBudgetTimeoutMs
    );

    let claims: InternalAssertionClaims;
    try {
      // Budget charging is intentionally between signature authentication and
      // all parsing, canonical, temporal, replay, and context validation.
      claims = await verifyAuthenticatedInternalAssertion(authenticated, {
        clock: configuredOptions.clock,
        expected: configuredOptions.expected,
        replayDefense: configuredOptions.replayDefense,
        replayDefenseTimeoutMs,
      });
    } catch (error) {
      if (
        error instanceof InternalAssertionError &&
        error.code === "replay_defense_unavailable"
      ) {
        return errorResponse("replay_defense_unavailable");
      }
      if (
        error instanceof InternalAssertionError &&
        error.code === "internal_auth_configuration_invalid"
      ) {
        return errorResponse("gateway_configuration_unavailable");
      }
      return errorResponse("unauthorized");
    }
    if (rateFailure) {
      return errorResponse(rateFailure);
    }
    if (request.signal?.aborted) {
      return errorResponse("request_aborted");
    }

    try {
      assertJsonContentType(request.headers);
      const body = await readJsonBody(
        request.body,
        request.headers,
        maxBodyBytes,
        maxBodyChunks,
        bodyReadTimeoutMs,
        request.signal
      );
      const operationInput = readOperationInput(body);
      const definition = configuredOptions.operationRegistry.get(
        configuredOptions.route.operation
      );
      if (!definition) {
        throw new GatewayRequestError("gateway_configuration_unavailable");
      }

      let parsedInput: unknown;
      try {
        parsedInput = definition.parseInput(operationInput);
      } catch {
        throw new GatewayRequestError("invalid_request");
      }

      const data = await executeWithCancellation(
        definition,
        parsedInput,
        claims,
        request.signal,
        executionTimeoutMs
      );
      return successResponse(data);
    } catch (error) {
      if (error instanceof GatewayRequestError) {
        return errorResponse(error.code);
      }
      return errorResponse("operation_failed");
    }
  };
}

/** Snapshots caller-owned policy objects so later mutation cannot alter routing. */
function snapshotDispatcherOptions(
  options: GatewayDispatcherOptions
): GatewayDispatcherOptions {
  return Object.freeze({
    ...options,
    expected: Object.freeze({ ...options.expected }),
    route: Object.freeze({
      ...options.route,
      rateBudget: Object.freeze({ ...options.route.rateBudget }),
    }),
    verificationKeys: Object.freeze({ ...options.verificationKeys }),
  });
}

/** Validates all startup policy before accepting a request. */
function assertDispatcherConfiguration(
  options: GatewayDispatcherOptions,
  maxBodyBytes: number,
  maxBodyChunks: number,
  bodyReadTimeoutMs: number,
  rateBudgetTimeoutMs: number,
  replayDefenseTimeoutMs: number,
  executionTimeoutMs: number
): void {
  if (
    options.route.path.length < 2 ||
    options.route.path.includes("?") ||
    options.route.operation !== options.expected.operation ||
    options.expected.provider !== "codex" ||
    !options.operationRegistry.get(options.route.operation) ||
    !isPositiveSafeInteger(maxBodyBytes) ||
    maxBodyBytes > MAX_BODY_BYTES ||
    !isPositiveSafeInteger(maxBodyChunks) ||
    maxBodyChunks > MAX_BODY_CHUNKS ||
    !isPositiveSafeInteger(bodyReadTimeoutMs) ||
    bodyReadTimeoutMs > MAX_BODY_READ_TIMEOUT_MS ||
    !isPositiveSafeInteger(rateBudgetTimeoutMs) ||
    rateBudgetTimeoutMs > MAX_CONTROL_PLANE_TIMEOUT_MS ||
    !isPositiveSafeInteger(replayDefenseTimeoutMs) ||
    replayDefenseTimeoutMs > MAX_REPLAY_DEFENSE_TIMEOUT_MS ||
    !isPositiveSafeInteger(executionTimeoutMs) ||
    executionTimeoutMs > MAX_EXECUTION_TIMEOUT_MS
  ) {
    throw configurationError();
  }

  const policy = options.route.rateBudget;
  if (
    policy.endpoint.length === 0 ||
    policy.endpoint.length > 128 ||
    !isPositiveSafeInteger(policy.ownerLimit) ||
    !isPositiveSafeInteger(policy.globalLimit) ||
    !isPositiveSafeInteger(policy.windowSeconds)
  ) {
    throw configurationError();
  }
}

/** Reads exactly one canonical Bearer credential without accepting duplicates. */
function readBearerAssertion(
  headers: Readonly<Record<string, GatewayHeaderValue>>
): string | undefined {
  const authorization = readSingletonHeader(headers, "authorization");
  if (!authorization) {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
  return match?.[1];
}

/** Requires the one media type supported by this JSON-only dispatcher. */
function assertJsonContentType(
  headers: Readonly<Record<string, GatewayHeaderValue>>
): void {
  if (readSingletonHeader(headers, "content-type") !== "application/json") {
    throw new GatewayRequestError("unsupported_media_type");
  }
}

/** Returns one case-insensitive scalar header and rejects ambiguous values. */
function readSingletonHeader(
  headers: Readonly<Record<string, GatewayHeaderValue>>,
  requestedName: string
): string | undefined {
  const matches = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === requestedName
  );
  if (matches.length !== 1) {
    return undefined;
  }
  const value = matches[0][1];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Reads a bounded byte stream completely before decoding or parsing JSON. */
async function readJsonBody(
  body: AsyncIterable<Uint8Array>,
  headers: Readonly<Record<string, GatewayHeaderValue>>,
  maxBodyBytes: number,
  maxBodyChunks: number,
  bodyReadTimeoutMs: number,
  requestSignal: AbortSignal | undefined
): Promise<unknown> {
  const declaredLength = readContentLength(headers);
  if (declaredLength !== undefined && declaredLength > maxBodyBytes) {
    throw new GatewayRequestError("payload_too_large");
  }

  if (requestSignal?.aborted) {
    throw new GatewayRequestError("request_aborted");
  }

  let iterator: AsyncIterator<Uint8Array>;
  try {
    iterator = body[Symbol.asyncIterator]();
    if (typeof iterator.next !== "function") {
      throw new GatewayRequestError("invalid_request");
    }
  } catch (error) {
    if (error instanceof GatewayRequestError) throw error;
    throw new GatewayRequestError("invalid_request");
  }

  const chunks: Uint8Array[] = [];
  let chunkCount = 0;
  let completed = false;
  let totalBytes = 0;
  let rejectCancellation: ((error: GatewayRequestError) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const handleAbort = (): void => {
    rejectCancellation?.(new GatewayRequestError("request_aborted"));
  };
  requestSignal?.addEventListener("abort", handleAbort, { once: true });
  const timeout = setTimeout(() => {
    rejectCancellation?.(new GatewayRequestError("request_timeout"));
  }, bodyReadTimeoutMs);

  try {
    if (requestSignal?.aborted) handleAbort();
    while (true) {
      let result: IteratorResult<Uint8Array>;
      try {
        result = await Promise.race([
          Promise.resolve().then(() => iterator.next()),
          cancellation,
        ]);
      } catch (error) {
        if (error instanceof GatewayRequestError) throw error;
        throw new GatewayRequestError("invalid_request");
      }
      if (typeof result !== "object" || result === null) {
        throw new GatewayRequestError("invalid_request");
      }
      if (result.done) {
        completed = true;
        break;
      }

      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new GatewayRequestError("invalid_request");
      }
      if (chunk.byteLength === 0) {
        throw new GatewayRequestError("invalid_request");
      }
      chunkCount += 1;
      if (chunkCount > maxBodyChunks) {
        throw new GatewayRequestError("payload_too_large");
      }
      if (chunk.byteLength > maxBodyBytes - totalBytes) {
        throw new GatewayRequestError("payload_too_large");
      }
      totalBytes += chunk.byteLength;
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof GatewayRequestError) throw error;
    throw new GatewayRequestError("invalid_request");
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", handleAbort);
    if (!completed) await closeBodyIterator(iterator);
  }
  if (declaredLength !== undefined && declaredLength !== totalBytes) {
    throw new GatewayRequestError("invalid_request");
  }

  try {
    const bytes = Buffer.concat(
      chunks.map((chunk) =>
        Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      ),
      totalBytes
    );
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(json) as unknown;
  } catch {
    throw new GatewayRequestError("invalid_request");
  }
}

/** Requests iterator cleanup without allowing a hostile return hook to hang. */
async function closeBodyIterator(
  iterator: AsyncIterator<Uint8Array>
): Promise<void> {
  let returnMethod: AsyncIterator<Uint8Array>["return"];
  try {
    returnMethod = iterator.return;
  } catch {
    return;
  }
  if (typeof returnMethod !== "function") return;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const cleanup = Promise.resolve()
      .then(() => returnMethod.call(iterator))
      .then(
        () => undefined,
        () => undefined
      );
    await Promise.race([
      cleanup,
      new Promise<void>((resolve) => {
        cleanupTimer = setTimeout(resolve, BODY_CLEANUP_GRACE_MS);
      }),
    ]);
  } finally {
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
  }
}

/** Parses an optional, exact decimal content length without coercion. */
function readContentLength(
  headers: Readonly<Record<string, GatewayHeaderValue>>
): number | undefined {
  const matchingNames = Object.keys(headers).filter(
    (name) => name.toLowerCase() === "content-length"
  );
  const value = readSingletonHeader(headers, "content-length");
  if (value === undefined) {
    if (matchingNames.length > 0) {
      throw new GatewayRequestError("invalid_request");
    }
    return undefined;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new GatewayRequestError("invalid_request");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new GatewayRequestError("invalid_request");
  }
  return length;
}

/** Accepts only `{ input }`, preventing body-level policy or registry override. */
function readOperationInput(body: unknown): unknown {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.getPrototypeOf(body) !== Object.prototype
  ) {
    throw new GatewayRequestError("invalid_request");
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("input" in record)) {
    throw new GatewayRequestError("invalid_request");
  }
  return record.input;
}

/** Attempts the endpoint's atomic owner/global budget and fails closed. */
async function consumeRateBudget(
  options: GatewayDispatcherOptions,
  timeoutMs: number
): Promise<"rate_limited" | "rate_limit_unavailable" | undefined> {
  const outcome = await awaitControlPlaneOperation(
    (context) => options.rateBudget.consume(rateAttempt(options), context),
    timeoutMs
  );
  if (outcome.status === "aborted") return "rate_limit_unavailable";
  if (outcome.status === "timed_out") return "rate_limit_unavailable";
  if (outcome.status === "rejected") {
    return outcome.error instanceof RateBudgetError &&
      outcome.error.code === "exhausted"
      ? "rate_limited"
      : "rate_limit_unavailable";
  }
  return undefined;
}

/** Builds the immutable budget key exclusively from server-authenticated data. */
function rateAttempt(options: GatewayDispatcherOptions): RateBudgetAttempt {
  return {
    ownerSubject: options.expected.subject,
    connectionId: options.expected.connectionId,
    requestId: options.expected.requestId,
    policy: options.route.rateBudget,
  };
}

/** Hands execution an abort signal and bounds how long dispatch awaits it. */
async function executeWithCancellation(
  definition: CodexOperationDefinition,
  input: unknown,
  claims: InternalAssertionClaims,
  requestSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<unknown> {
  if (requestSignal?.aborted) {
    throw new GatewayRequestError("request_aborted");
  }

  const executionController = new AbortController();
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", handleRequestAbort);
      action();
    };
    const handleRequestAbort = (): void => {
      finish(() => {
        executionController.abort();
        reject(new GatewayRequestError("request_aborted"));
      });
    };
    const timeout = setTimeout(() => {
      finish(() => {
        executionController.abort();
        reject(new GatewayRequestError("request_timeout"));
      });
    }, timeoutMs);
    requestSignal?.addEventListener("abort", handleRequestAbort, {
      once: true,
    });
    // Abort may race the initial check and listener registration. Recheck after
    // attachment so the operation never starts with a missed caller abort.
    if (requestSignal?.aborted) {
      handleRequestAbort();
      return;
    }

    Promise.resolve()
      .then(() => {
        // Abort and timeout may settle while this microtask is queued. Never
        // cross the execution boundary after either terminal outcome.
        if (settled) return;
        return definition.execute(input, {
          claims,
          signal: executionController.signal,
        });
      })
      .then(
        (result) => finish(() => resolve(result)),
        () => finish(() => reject(new GatewayRequestError("operation_failed")))
      );
  });
}

/** Maps one stable code to a fixed status without reflecting exception text. */
function errorResponse(code: GatewayErrorCode): GatewayResponse {
  const statusByCode: Readonly<Record<GatewayErrorCode, number>> = {
    gateway_configuration_unavailable: 503,
    invalid_request: 400,
    method_not_allowed: 405,
    not_found: 404,
    operation_failed: 502,
    payload_too_large: 413,
    rate_limit_unavailable: 503,
    rate_limited: 429,
    replay_defense_unavailable: 503,
    request_aborted: 499,
    request_timeout: 504,
    unauthorized: 401,
    unsupported_media_type: 415,
  };
  return {
    status: statusByCode[code],
    headers: { "content-type": "application/json" },
    body: { ok: false, error: { code } },
  };
}

/** Creates the single successful response shape used by the transport adapter. */
function successResponse(data: unknown): GatewayResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { ok: true, data },
  };
}

/** Produces a stable startup error without embedding policy values. */
function configurationError(): GatewayRequestError {
  return new GatewayRequestError("gateway_configuration_unavailable");
}

/** Recognizes positive bounded integer configuration values. */
function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export {
  type CodexOperationDefinition,
  CodexOperationRegistry,
  createGatewayDispatcher,
  DEFAULT_BODY_READ_TIMEOUT_MS,
  DEFAULT_EXECUTION_TIMEOUT_MS,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_BODY_CHUNKS,
  DEFAULT_RATE_BUDGET_TIMEOUT_MS,
  DEFAULT_REPLAY_DEFENSE_TIMEOUT_MS,
  type GatewayDispatcher,
  type GatewayDispatcherOptions,
  type GatewayErrorBody,
  type GatewayErrorCode,
  type GatewayHeaderValue,
  type GatewayRequestEnvelope,
  GatewayRequestError,
  type GatewayResponse,
  type GatewayRoute,
  type GatewaySuccessBody,
  MAX_BODY_BYTES,
  MAX_BODY_CHUNKS,
  MAX_BODY_READ_TIMEOUT_MS,
  MAX_CONTROL_PLANE_TIMEOUT_MS,
  MAX_EXECUTION_TIMEOUT_MS,
  type OperationExecutionContext,
  type RateBudget,
  type RateBudgetAttempt,
  RateBudgetError,
  type RateBudgetErrorCode,
  type RateBudgetPolicy,
};
