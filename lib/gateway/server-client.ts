import "server-only";

import { z } from "zod";

import type { ControlPlaneOperationContext } from "../../services/agent-gateway/control-plane.ts";
import {
  GATEWAY_OPERATIONS,
  type GatewayOperation,
} from "../../services/agent-gateway/internal-auth.ts";

const GATEWAY_BASE_PATH = "/internal/v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RESOLVER_TIMEOUT_MS = 1_000;
const DEFAULT_SIGNER_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1_024;
const DEFAULT_MAX_RESPONSE_CHUNKS = 1_024;
const MAX_REQUEST_TIMEOUT_MS = 5 * 60_000;
const MAX_CONTROL_PLANE_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const MAX_RESPONSE_CHUNKS = 4_096;
const MAX_IDENTIFIER_LENGTH = 256;

const OPERATION_PATHS: Readonly<Record<GatewayOperation, string>> =
  Object.freeze({
    chat: "operations/chat",
    "mind-map-generation": "operations/mind-map-generation",
    "node-editing": "operations/node-editing",
  });

const GATEWAY_ERROR_STATUS = Object.freeze({
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
} as const);

const gatewayErrorCodeSchema = z.enum([
  "gateway_configuration_unavailable",
  "invalid_request",
  "method_not_allowed",
  "not_found",
  "operation_failed",
  "payload_too_large",
  "rate_limit_unavailable",
  "rate_limited",
  "replay_defense_unavailable",
  "request_aborted",
  "request_timeout",
  "unauthorized",
  "unsupported_media_type",
]);
const gatewaySuccessSchema = z
  .object({ ok: z.literal(true), data: z.unknown() })
  .strict();
const gatewayFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.object({ code: gatewayErrorCodeSchema }).strict(),
  })
  .strict();

type GatewayRemoteErrorCode = z.infer<typeof gatewayErrorCodeSchema>;
type GatewayClientErrorCode =
  | GatewayRemoteErrorCode
  | "connection_unavailable"
  | "gateway_client_configuration_invalid"
  | "gateway_response_invalid"
  | "gateway_unavailable"
  | "request_aborted"
  | "request_timeout"
  | "response_too_large";

type AuthenticatedGatewayContext = Readonly<{
  ownerId: string;
  resource: Readonly<{
    type: "mindmap";
    id: string;
  }>;
}>;

type GatewayClientRequest = Readonly<{
  context: AuthenticatedGatewayContext;
  connectionId: string;
  operation: GatewayOperation;
  requestId: string;
  signal?: AbortSignal;
}>;

type ResolveConnectionInput = Readonly<{
  ownerId: string;
  connectionId: string;
  provider: "codex";
  requireDefault: true;
}>;

type ResolvedGatewayConnection = Readonly<{
  ownerId: string;
  connectionId: string;
  provider: "codex";
  status: "connected" | "expired" | "pending" | "revoked" | "error";
  isDefault: boolean;
}>;

interface GatewayConnectionResolver {
  resolve(
    input: ResolveConnectionInput,
    context: ControlPlaneOperationContext
  ):
    | ResolvedGatewayConnection
    | null
    | Promise<ResolvedGatewayConnection | null>;
}

type SignAssertionInput = Readonly<{
  issuer: string;
  audience: string;
  subject: string;
  connectionId: string;
  provider: "codex";
  operation: GatewayOperation;
  requestId: string;
}>;

interface GatewayAssertionSigner {
  sign(
    input: SignAssertionInput,
    context: ControlPlaneOperationContext
  ): string | Promise<string>;
}

type GatewayTransportRequest = Readonly<{
  url: string;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
  redirect: "error";
  signal: AbortSignal;
}>;

type GatewayTransportResponse = Readonly<{
  status: number;
  redirected: boolean;
  url: string;
  headers: Pick<Headers, "get">;
  body: ReadableStream<Uint8Array> | null;
}>;

interface GatewayTransport {
  send(request: GatewayTransportRequest): Promise<GatewayTransportResponse>;
}

type FetchImplementation = (
  input: string,
  init: RequestInit
) => Promise<Response>;

type GatewayServerClientOptions = Readonly<{
  gatewayOrigin: string;
  issuer: string;
  audience: string;
  connectionResolver: GatewayConnectionResolver;
  assertionSigner: GatewayAssertionSigner;
  transport: GatewayTransport;
  requestTimeoutMs?: number;
  resolverTimeoutMs?: number;
  signerTimeoutMs?: number;
  maxResponseBytes?: number;
  maxResponseChunks?: number;
}>;

type GatewayServerClient = Readonly<{
  execute(request: GatewayClientRequest): Promise<unknown>;
}>;

/** Stable, secret-free client failure suitable for a server route mapping. */
class GatewayClientError extends Error {
  readonly code: GatewayClientErrorCode;

  constructor(code: GatewayClientErrorCode) {
    super("Gateway client request failed");
    this.name = "GatewayClientError";
    this.code = code;
  }
}

/** Adapts an explicitly injected fetch implementation without using global fetch. */
function createFetchGatewayTransport(
  fetchImplementation: FetchImplementation
): GatewayTransport {
  if (typeof fetchImplementation !== "function") {
    throw clientError("gateway_client_configuration_invalid");
  }

  return Object.freeze({
    async send(request: GatewayTransportRequest) {
      return fetchImplementation(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect,
        signal: request.signal,
      });
    },
  });
}

/**
 * Creates a server-only gateway client whose caller cannot choose transport,
 * route, assertion authority, provider runtime, command, model, or credentials.
 */
function createGatewayServerClient(
  options: GatewayServerClientOptions
): GatewayServerClient {
  let configuration: ReturnType<typeof readConfiguration>;
  try {
    configuration = readConfiguration(options);
  } catch (error) {
    if (error instanceof GatewayClientError) throw error;
    throw clientError("gateway_client_configuration_invalid");
  }

  return Object.freeze({
    async execute(request: GatewayClientRequest): Promise<unknown> {
      let parsedRequest: GatewayClientRequest;
      try {
        parsedRequest = readRequest(request);
      } catch (error) {
        if (error instanceof GatewayClientError) throw error;
        throw clientError("gateway_client_configuration_invalid");
      }
      if (parsedRequest.signal?.aborted) {
        throw clientError("request_aborted");
      }

      const requestController = new AbortController();
      const handleCallerAbort = (): void => requestController.abort();
      parsedRequest.signal?.addEventListener("abort", handleCallerAbort, {
        once: true,
      });
      // Close the check/listener race without forwarding the caller's reason.
      if (parsedRequest.signal?.aborted) handleCallerAbort();
      const requestTimer = setTimeout(
        () => requestController.abort(),
        configuration.requestTimeoutMs
      );

      try {
        const connection = await runControlPlaneStage(
          (context) =>
            configuration.connectionResolver.resolve(
              Object.freeze({
                ownerId: parsedRequest.context.ownerId,
                connectionId: parsedRequest.connectionId,
                provider: "codex",
                requireDefault: true,
              }),
              context
            ),
          configuration.resolverTimeoutMs,
          requestController.signal,
          parsedRequest.signal
        );
        requireUsableConnection(connection, parsedRequest);

        const assertion = await runControlPlaneStage(
          (context) =>
            configuration.assertionSigner.sign(
              Object.freeze({
                issuer: configuration.issuer,
                audience: configuration.audience,
                subject: parsedRequest.context.ownerId,
                connectionId: parsedRequest.connectionId,
                provider: "codex",
                operation: parsedRequest.operation,
                requestId: parsedRequest.requestId,
              }),
              context
            ),
          configuration.signerTimeoutMs,
          requestController.signal,
          parsedRequest.signal
        );
        requireAssertion(assertion);

        const url = buildOperationUrl(
          configuration.gatewayOrigin,
          parsedRequest.operation
        );
        const body = JSON.stringify({
          input: {
            resource: parsedRequest.context.resource,
          },
        });
        const transportPromise = Promise.resolve().then(() => {
          // A queued transport handoff must not start after cancellation wins.
          if (requestController.signal.aborted) {
            throw cancellationError(
              requestController.signal,
              parsedRequest.signal
            );
          }
          return configuration.transport.send(
            Object.freeze({
              url,
              method: "POST",
              headers: Object.freeze({
                authorization: `Bearer ${assertion}`,
                "content-type": "application/json",
                "x-request-id": parsedRequest.requestId,
              }),
              body,
              redirect: "error",
              signal: requestController.signal,
            })
          );
        });
        const response = await awaitObserved(
          transportPromise,
          requestController.signal,
          parsedRequest.signal
        );
        return await readGatewayResponse(
          response,
          url,
          configuration.maxResponseBytes,
          configuration.maxResponseChunks,
          requestController.signal,
          parsedRequest.signal
        );
      } catch (error) {
        if (error instanceof GatewayClientError) throw error;
        throw cancellationError(requestController.signal, parsedRequest.signal);
      } finally {
        clearTimeout(requestTimer);
        parsedRequest.signal?.removeEventListener("abort", handleCallerAbort);
        requestController.abort();
      }
    },
  });
}

/** Snapshots and validates all construction-time policy. */
function readConfiguration(
  options: GatewayServerClientOptions
): Required<
  Omit<GatewayServerClientOptions, "gatewayOrigin" | "issuer" | "audience">
> &
  Readonly<{ gatewayOrigin: string; issuer: string; audience: string }> {
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const resolverTimeoutMs =
    options.resolverTimeoutMs ?? DEFAULT_RESOLVER_TIMEOUT_MS;
  const signerTimeoutMs = options.signerTimeoutMs ?? DEFAULT_SIGNER_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxResponseChunks =
    options.maxResponseChunks ?? DEFAULT_MAX_RESPONSE_CHUNKS;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(options.gatewayOrigin);
  } catch {
    throw clientError("gateway_client_configuration_invalid");
  }

  if (
    parsedOrigin.protocol !== "https:" ||
    parsedOrigin.username !== "" ||
    parsedOrigin.password !== "" ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search !== "" ||
    parsedOrigin.hash !== "" ||
    parsedOrigin.origin !== options.gatewayOrigin ||
    !isIdentifier(options.issuer) ||
    !isIdentifier(options.audience) ||
    typeof options.connectionResolver?.resolve !== "function" ||
    typeof options.assertionSigner?.sign !== "function" ||
    typeof options.transport?.send !== "function" ||
    !isBoundedInteger(requestTimeoutMs, MAX_REQUEST_TIMEOUT_MS) ||
    !isBoundedInteger(resolverTimeoutMs, MAX_CONTROL_PLANE_TIMEOUT_MS) ||
    resolverTimeoutMs > requestTimeoutMs ||
    !isBoundedInteger(signerTimeoutMs, MAX_CONTROL_PLANE_TIMEOUT_MS) ||
    signerTimeoutMs > requestTimeoutMs ||
    !isBoundedInteger(maxResponseBytes, MAX_RESPONSE_BYTES) ||
    !isBoundedInteger(maxResponseChunks, MAX_RESPONSE_CHUNKS)
  ) {
    throw clientError("gateway_client_configuration_invalid");
  }

  return Object.freeze({
    gatewayOrigin: parsedOrigin.origin,
    issuer: options.issuer,
    audience: options.audience,
    connectionResolver: options.connectionResolver,
    assertionSigner: options.assertionSigner,
    transport: options.transport,
    requestTimeoutMs,
    resolverTimeoutMs,
    signerTimeoutMs,
    maxResponseBytes,
    maxResponseChunks,
  });
}

/** Validates the narrow server-derived invocation boundary. */
function readRequest(request: GatewayClientRequest): GatewayClientRequest {
  if (
    typeof request !== "object" ||
    request === null ||
    !isIdentifier(request.context?.ownerId) ||
    request.context.resource?.type !== "mindmap" ||
    !isIdentifier(request.context.resource.id) ||
    !isIdentifier(request.connectionId) ||
    !GATEWAY_OPERATIONS.includes(request.operation) ||
    !isIdentifier(request.requestId) ||
    (request.signal !== undefined && !(request.signal instanceof AbortSignal))
  ) {
    throw clientError("gateway_client_configuration_invalid");
  }

  return Object.freeze({
    context: Object.freeze({
      ownerId: request.context.ownerId,
      resource: Object.freeze({ ...request.context.resource }),
    }),
    connectionId: request.connectionId,
    operation: request.operation,
    requestId: request.requestId,
    signal: request.signal,
  });
}

/** Executes a resolver or signer behind its own bound and the request deadline. */
async function runControlPlaneStage<T>(
  operation: (context: ControlPlaneOperationContext) => T | PromiseLike<T>,
  timeoutMs: number,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal
): Promise<T> {
  const stageController = new AbortController();
  const handleRequestAbort = (): void => stageController.abort();
  requestSignal.addEventListener("abort", handleRequestAbort, { once: true });
  if (requestSignal.aborted) handleRequestAbort();
  const timer = setTimeout(() => stageController.abort(), timeoutMs);
  try {
    const promise = Promise.resolve().then(() => {
      // Do not invoke a control-plane dependency after abort or timeout wins.
      if (stageController.signal.aborted) {
        throw cancellationError(requestSignal, callerSignal);
      }
      return operation(
        Object.freeze({
          signal: stageController.signal,
          deadlineAtMilliseconds: Date.now() + timeoutMs,
        })
      );
    });
    return await awaitObserved(promise, stageController.signal, callerSignal);
  } catch {
    if (callerSignal?.aborted) throw clientError("request_aborted");
    if (requestSignal.aborted) throw clientError("request_timeout");
    throw clientError("gateway_unavailable");
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", handleRequestAbort);
    stageController.abort();
  }
}

/** Rejects all missing, mismatched, non-default, or unusable connection state alike. */
function requireUsableConnection(
  connection: ResolvedGatewayConnection | null,
  request: GatewayClientRequest
): asserts connection is ResolvedGatewayConnection {
  if (
    connection === null ||
    connection.ownerId !== request.context.ownerId ||
    connection.connectionId !== request.connectionId ||
    connection.provider !== "codex" ||
    connection.status !== "connected" ||
    connection.isDefault !== true
  ) {
    throw clientError("connection_unavailable");
  }
}

/** Requires a bounded opaque assertion without parsing or reflecting it. */
function requireAssertion(assertion: string): void {
  if (
    typeof assertion !== "string" ||
    assertion.length === 0 ||
    assertion.length > 8_192 ||
    /[\r\n]/.test(assertion)
  ) {
    throw clientError("gateway_unavailable");
  }
}

/** Builds the only allowed gateway endpoint for a compile-time operation. */
function buildOperationUrl(
  origin: string,
  operation: GatewayOperation
): string {
  const path = OPERATION_PATHS[operation];
  if (!path) throw clientError("gateway_client_configuration_invalid");
  return `${origin}${GATEWAY_BASE_PATH}/${path}`;
}

/** Reads, bounds, and strictly validates one JSON gateway response. */
async function readGatewayResponse(
  response: GatewayTransportResponse,
  expectedUrl: string,
  maxBytes: number,
  maxChunks: number,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal
): Promise<unknown> {
  if (
    typeof response !== "object" ||
    response === null ||
    !Number.isInteger(response.status) ||
    response.redirected !== false ||
    response.url !== expectedUrl ||
    typeof response.headers?.get !== "function" ||
    !isJsonContentType(response.headers.get("content-type")) ||
    response.body === null
  ) {
    throw clientError("gateway_response_invalid");
  }

  const body = await readBoundedBody(
    response.body,
    maxBytes,
    maxChunks,
    requestSignal,
    callerSignal
  );
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw clientError("gateway_response_invalid");
  }

  const success = gatewaySuccessSchema.safeParse(value);
  if (response.status === 200 && success.success) return success.data.data;

  const failure = gatewayFailureSchema.safeParse(value);
  if (!failure.success) throw clientError("gateway_response_invalid");
  const expectedStatus = GATEWAY_ERROR_STATUS[failure.data.error.code];
  if (response.status !== expectedStatus) {
    throw clientError("gateway_response_invalid");
  }
  throw clientError(failure.data.error.code);
}

/** Reads a response stream with hard byte/chunk limits and observed cancellation. */
async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  maxChunks: number,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal
): Promise<Uint8Array> {
  if (requestSignal.aborted) {
    throw cancellationError(requestSignal, callerSignal);
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throw clientError("gateway_response_invalid");
  }

  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  let chunkCount = 0;
  let completed = false;
  try {
    while (true) {
      const result = await awaitObserved(
        reader.read(),
        requestSignal,
        callerSignal
      );
      if (result.done) {
        completed = true;
        break;
      }
      if (!(result.value instanceof Uint8Array)) {
        throw clientError("gateway_response_invalid");
      }
      chunkCount += 1;
      byteCount += result.value.byteLength;
      if (chunkCount > maxChunks || byteCount > maxBytes) {
        throw clientError("response_too_large");
      }
      chunks.push(result.value);
    }
  } finally {
    if (!completed) {
      // Cancellation is deliberately fire-and-observe: a hostile stream cannot
      // hold the request open or create an unhandled late rejection.
      try {
        void Promise.resolve(reader.cancel()).catch(() => undefined);
      } catch {
        // A non-conforming reader cannot replace the stable client failure.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A non-conforming transport cannot leak its cleanup error to callers.
    }
  }

  const combined = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

/** Awaits a promise while retaining both late fulfillment and rejection handlers. */
function awaitObserved<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal,
  callerSignal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      callback();
    };
    const handleAbort = (): void => {
      finish(() => reject(cancellationError(signal, callerSignal)));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();

    Promise.resolve(promise).then(
      (value) => finish(() => resolve(value)),
      () => finish(() => reject(clientError("gateway_unavailable")))
    );
  });
}

/** Distinguishes a caller abort from the server-owned deadline. */
function cancellationError(
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal
): GatewayClientError {
  return clientError(
    callerSignal?.aborted
      ? "request_aborted"
      : requestSignal.aborted
        ? "request_timeout"
        : "gateway_unavailable"
  );
}

/** Accepts JSON with only an optional UTF-8 charset parameter. */
function isJsonContentType(value: string | null): boolean {
  return (
    value !== null &&
    /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value.trim())
  );
}

/** Recognizes one nonblank bounded identifier with no control characters. */
function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  );
}

/** Recognizes a positive safe integer below a hard limit. */
function isBoundedInteger(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

/** Constructs a fresh generic client failure. */
function clientError(code: GatewayClientErrorCode): GatewayClientError {
  return new GatewayClientError(code);
}

export {
  type AuthenticatedGatewayContext,
  createFetchGatewayTransport,
  createGatewayServerClient,
  type FetchImplementation,
  type GatewayAssertionSigner,
  GatewayClientError,
  type GatewayClientErrorCode,
  type GatewayClientRequest,
  type GatewayConnectionResolver,
  type GatewayRemoteErrorCode,
  type GatewayServerClient,
  type GatewayServerClientOptions,
  type GatewayTransport,
  type GatewayTransportRequest,
  type GatewayTransportResponse,
  type ResolveConnectionInput,
  type ResolvedGatewayConnection,
  type SignAssertionInput,
};
