import "server-only";

import { isIP } from "node:net";

import { z } from "zod";

import type { ControlPlaneOperationContext } from "../../services/agent-gateway/control-plane.ts";
import {
  GATEWAY_OPERATIONS,
  type GatewayOperation,
} from "../../services/agent-gateway/internal-auth.ts";
import {
  createGatewayOperationEnvelope,
  GATEWAY_CHAT_STREAM_CONTENT_TYPE,
  type GatewayActionResult,
  type GatewayChatChunk,
  type GatewayChatInput,
  type GatewayMindmapGenerationInput,
  type GatewayNodeEditingInput,
  type GatewayResourceAuthority,
  parseGatewayActionResult,
  parseGatewayChatStreamFrame,
} from "../../services/agent-gateway/operation-protocol.ts";

const GATEWAY_BASE_PATH = "/internal/v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 1_000;
const DEFAULT_SIGNER_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1_024;
const DEFAULT_MAX_RESPONSE_CHUNKS = 1_024;
const DEFAULT_CLEANUP_TIMEOUT_MS = 100;
const MAX_REQUEST_TIMEOUT_MS = 5 * 60_000;
const MAX_CONTROL_PLANE_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const MAX_RESPONSE_CHUNKS = 4_096;
const MAX_CLEANUP_TIMEOUT_MS = 1_000;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_RESPONSE_HEADER_COUNT = 64;
const MAX_RESPONSE_HEADER_NAME_LENGTH = 128;
const MAX_RESPONSE_HEADER_VALUE_LENGTH = 1_024;

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
  | "authorization_unavailable"
  | "gateway_client_configuration_invalid"
  | "gateway_response_invalid"
  | "gateway_unavailable"
  | "request_aborted"
  | "request_timeout"
  | "response_too_large";

type GatewayResourceIntent = Readonly<{
  type: "mindmap";
  id: string;
}>;

type GatewayBootstrapResourceIntent = Readonly<{
  type: "owner-bootstrap";
  intent: "create-first-mindmap";
}>;

type GatewayProtocolResourceIntent =
  | GatewayResourceIntent
  | GatewayBootstrapResourceIntent;

type GatewayClientRequest = Readonly<{
  resource: GatewayResourceIntent;
  connectionId: string;
  operation: GatewayOperation;
  requestId: string;
  signal?: AbortSignal;
}>;

type GatewayChatClientRequest = Readonly<{
  resource: GatewayResourceIntent;
  connectionId: string;
  operation: "chat";
  requestId: string;
  input: GatewayChatInput;
  signal?: AbortSignal;
}>;

type GatewayActionClientRequest =
  | Readonly<{
      resource: GatewayBootstrapResourceIntent;
      connectionId: string;
      operation: "mind-map-generation";
      requestId: string;
      input: GatewayMindmapGenerationInput;
      signal?: AbortSignal;
    }>
  | Readonly<{
      resource: GatewayResourceIntent;
      connectionId: string;
      operation: "node-editing";
      requestId: string;
      input: GatewayNodeEditingInput;
      signal?: AbortSignal;
    }>;

type GatewayProtocolClientRequest =
  | GatewayChatClientRequest
  | GatewayActionClientRequest;

type AuthorizeGatewayIntentInput = Readonly<{
  resource: GatewayProtocolResourceIntent;
  connectionId: string;
  provider: "codex";
  operation: GatewayOperation;
  requireDefault: true;
}>;

// Deliberately not exported: execute callers can submit intent, but only the
// construction-time server resolver can return derived authority.
type AuthorizedGatewayResolution = Readonly<{
  ownerId: string;
  resource:
    | Readonly<{
        type: "mindmap";
        requestedId: string;
        canonicalId: string;
      }>
    | Readonly<{
        type: "owner-bootstrap";
        intent: "create-first-mindmap";
      }>;
  connection: Readonly<{
    requestedId: string;
    canonicalId: string;
    provider: "codex";
    status: "connected" | "expired" | "pending" | "revoked" | "error";
    isDefault: boolean;
  }>;
  operation: GatewayOperation;
}>;

interface GatewayAuthorityResolver {
  /** Derives current owner authority and atomically validates the full intent. */
  authorize(
    input: AuthorizeGatewayIntentInput,
    context: ControlPlaneOperationContext
  ):
    | AuthorizedGatewayResolution
    | null
    | Promise<AuthorizedGatewayResolution | null>;
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

interface GatewayResponseBodyReader {
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel(): void | PromiseLike<void>;
  releaseLock(): void;
}

interface GatewayResponseBody {
  getReader(): GatewayResponseBodyReader;
  cancel(): void | PromiseLike<void>;
}

type GatewayTransportResponse = Readonly<{
  status: number;
  redirected: boolean;
  url: string;
  headers: Pick<Headers, "get"> & Partial<Pick<Headers, "entries">>;
  body: GatewayResponseBody | null;
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
  gatewayOriginAllowlist: readonly string[];
  issuer: string;
  audience: string;
  authorityResolver: GatewayAuthorityResolver;
  assertionSigner: GatewayAssertionSigner;
  transport: GatewayTransport;
  requestTimeoutMs?: number;
  authorizationTimeoutMs?: number;
  signerTimeoutMs?: number;
  maxResponseBytes?: number;
  maxResponseChunks?: number;
  cleanupTimeoutMs?: number;
}>;

type GatewayServerClient = Readonly<{
  execute(request: GatewayClientRequest): Promise<unknown>;
  executeAction(
    request: GatewayActionClientRequest
  ): Promise<GatewayActionResult>;
  streamChat(
    request: GatewayChatClientRequest
  ): Promise<ReadableStream<GatewayChatChunk>>;
}>;

/** Stable, secret-free client failure suitable for a server route mapping. */
class GatewayClientError extends Error {
  readonly code: GatewayClientErrorCode;
  readonly status: number;

  constructor(code: GatewayClientErrorCode) {
    super("Gateway client request failed");
    this.name = "GatewayClientError";
    this.code = code;
    this.status = statusForClientError(code);
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
        const resolution = await runAuthorityStage(
          (context) =>
            configuration.authorityResolver.authorize(
              Object.freeze({
                resource: parsedRequest.resource,
                connectionId: parsedRequest.connectionId,
                provider: "codex",
                operation: parsedRequest.operation,
                requireDefault: true,
              }),
              context
            ),
          configuration.authorizationTimeoutMs,
          requestController.signal,
          parsedRequest.signal
        );
        const authority = requireAuthorizedResolution(
          resolution,
          parsedRequest
        );

        const assertion = await runControlPlaneStage(
          (context) =>
            configuration.assertionSigner.sign(
              Object.freeze({
                issuer: configuration.issuer,
                audience: configuration.audience,
                subject: authority.ownerId,
                connectionId: authority.connection.canonicalId,
                provider: "codex",
                operation: authority.operation,
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
          authority.operation
        );
        if (authority.resource.type !== "mindmap") {
          throw clientError("authorization_unavailable");
        }
        const body = JSON.stringify({
          input: {
            resource: {
              type: authority.resource.type,
              id: authority.resource.canonicalId,
            },
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
          parsedRequest.signal,
          (lateResponse) => {
            observeResponseDisposal(
              lateResponse,
              configuration.cleanupTimeoutMs
            );
          }
        );
        return await readGatewayResponse(
          response,
          url,
          configuration.maxResponseBytes,
          configuration.maxResponseChunks,
          configuration.cleanupTimeoutMs,
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
    async executeAction(
      request: GatewayActionClientRequest
    ): Promise<GatewayActionResult> {
      const parsedRequest = readProtocolRequest(request, "action");
      if (parsedRequest.operation === "chat") {
        throw clientError("gateway_client_configuration_invalid");
      }
      const active = await startProtocolRequest(parsedRequest, configuration);
      try {
        const value = await readGatewayResponse(
          active.response,
          active.url,
          configuration.maxResponseBytes,
          configuration.maxResponseChunks,
          configuration.cleanupTimeoutMs,
          active.requestController.signal,
          parsedRequest.signal,
          true
        );
        try {
          return parseGatewayActionResult(value, parsedRequest.operation);
        } catch {
          throw clientError("gateway_response_invalid");
        }
      } finally {
        active.finish();
      }
    },
    async streamChat(
      request: GatewayChatClientRequest
    ): Promise<ReadableStream<GatewayChatChunk>> {
      const parsedRequest = readProtocolRequest(request, "chat");
      const active = await startProtocolRequest(parsedRequest, configuration);
      try {
        return await createBoundedGatewayStream(
          active.response,
          active.url,
          configuration.maxResponseBytes,
          configuration.maxResponseChunks,
          configuration.cleanupTimeoutMs,
          active.requestController.signal,
          parsedRequest.signal,
          active.finish
        );
      } catch (error) {
        active.finish();
        if (error instanceof GatewayClientError) throw error;
        throw clientError("gateway_response_invalid");
      }
    },
  });
}

type GatewayClientConfiguration = ReturnType<typeof readConfiguration>;
type ActiveProtocolRequest = Readonly<{
  response: GatewayTransportResponse;
  url: string;
  requestController: AbortController;
  finish: () => void;
}>;

/** Authorizes, signs, and sends one versioned request exactly once. */
async function startProtocolRequest(
  parsedRequest: GatewayProtocolClientRequest,
  configuration: GatewayClientConfiguration
): Promise<ActiveProtocolRequest> {
  if (parsedRequest.signal?.aborted) throw clientError("request_aborted");

  const requestController = new AbortController();
  const handleCallerAbort = (): void => requestController.abort();
  parsedRequest.signal?.addEventListener("abort", handleCallerAbort, {
    once: true,
  });
  if (parsedRequest.signal?.aborted) handleCallerAbort();
  const requestTimer = setTimeout(
    () => requestController.abort(),
    configuration.requestTimeoutMs
  );
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    clearTimeout(requestTimer);
    parsedRequest.signal?.removeEventListener("abort", handleCallerAbort);
    requestController.abort();
  };

  try {
    const resolution = await runAuthorityStage(
      (context) =>
        configuration.authorityResolver.authorize(
          Object.freeze({
            resource: parsedRequest.resource,
            connectionId: parsedRequest.connectionId,
            provider: "codex",
            operation: parsedRequest.operation,
            requireDefault: true,
          }),
          context
        ),
      configuration.authorizationTimeoutMs,
      requestController.signal,
      parsedRequest.signal
    );
    const authority = requireAuthorizedResolution(resolution, parsedRequest);
    const assertion = await runControlPlaneStage(
      (context) =>
        configuration.assertionSigner.sign(
          Object.freeze({
            issuer: configuration.issuer,
            audience: configuration.audience,
            subject: authority.ownerId,
            connectionId: authority.connection.canonicalId,
            provider: "codex",
            operation: authority.operation,
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
      authority.operation
    );
    const canonicalResource = canonicalProtocolAuthority(authority.resource);
    const envelope = createGatewayOperationEnvelope(
      authority.operation,
      canonicalResource,
      parsedRequest.input
    );
    const transportPromise = Promise.resolve().then(() => {
      if (requestController.signal.aborted) {
        throw cancellationError(requestController.signal, parsedRequest.signal);
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
          body: JSON.stringify({ input: envelope }),
          redirect: "error",
          signal: requestController.signal,
        })
      );
    });
    const response = await awaitObserved(
      transportPromise,
      requestController.signal,
      parsedRequest.signal,
      (lateResponse) => {
        observeResponseDisposal(lateResponse, configuration.cleanupTimeoutMs);
      }
    );
    return Object.freeze({ response, url, requestController, finish });
  } catch (error) {
    finish();
    if (error instanceof GatewayClientError) throw error;
    throw cancellationError(requestController.signal, parsedRequest.signal);
  }
}

/** Snapshots and validates all construction-time policy. */
function readConfiguration(options: GatewayServerClientOptions): Required<
  Omit<
    GatewayServerClientOptions,
    "gatewayOrigin" | "gatewayOriginAllowlist" | "issuer" | "audience"
  >
> &
  Readonly<{
    gatewayOrigin: string;
    gatewayOriginAllowlist: readonly string[];
    issuer: string;
    audience: string;
  }> {
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const authorizationTimeoutMs =
    options.authorizationTimeoutMs ?? DEFAULT_AUTHORIZATION_TIMEOUT_MS;
  const signerTimeoutMs = options.signerTimeoutMs ?? DEFAULT_SIGNER_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxResponseChunks =
    options.maxResponseChunks ?? DEFAULT_MAX_RESPONSE_CHUNKS;
  const cleanupTimeoutMs =
    options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  const gatewayOriginAllowlist = readGatewayOriginAllowlist(
    options.gatewayOriginAllowlist
  );
  const gatewayOrigin = readSelectedGatewayOrigin(
    options.gatewayOrigin,
    gatewayOriginAllowlist
  );

  if (
    !isIdentifier(options.issuer) ||
    !isIdentifier(options.audience) ||
    typeof options.authorityResolver?.authorize !== "function" ||
    typeof options.assertionSigner?.sign !== "function" ||
    typeof options.transport?.send !== "function" ||
    !isBoundedInteger(requestTimeoutMs, MAX_REQUEST_TIMEOUT_MS) ||
    !isBoundedInteger(authorizationTimeoutMs, MAX_CONTROL_PLANE_TIMEOUT_MS) ||
    authorizationTimeoutMs > requestTimeoutMs ||
    !isBoundedInteger(signerTimeoutMs, MAX_CONTROL_PLANE_TIMEOUT_MS) ||
    signerTimeoutMs > requestTimeoutMs ||
    !isBoundedInteger(maxResponseBytes, MAX_RESPONSE_BYTES) ||
    !isBoundedInteger(maxResponseChunks, MAX_RESPONSE_CHUNKS) ||
    !isBoundedInteger(cleanupTimeoutMs, MAX_CLEANUP_TIMEOUT_MS)
  ) {
    throw clientError("gateway_client_configuration_invalid");
  }

  return Object.freeze({
    gatewayOrigin,
    gatewayOriginAllowlist,
    issuer: options.issuer,
    audience: options.audience,
    authorityResolver: options.authorityResolver,
    assertionSigner: options.assertionSigner,
    transport: options.transport,
    requestTimeoutMs,
    authorizationTimeoutMs,
    signerTimeoutMs,
    maxResponseBytes,
    maxResponseChunks,
    cleanupTimeoutMs,
  });
}

/** Validates the narrow server-derived invocation boundary. */
function readRequest(request: GatewayClientRequest): GatewayClientRequest {
  if (
    typeof request !== "object" ||
    request === null ||
    !hasExactKeys(request, [
      "connectionId",
      "operation",
      "requestId",
      "resource",
      ...(request.signal === undefined ? [] : ["signal"]),
    ]) ||
    request.resource?.type !== "mindmap" ||
    !hasExactKeys(request.resource, ["id", "type"]) ||
    !isIdentifier(request.resource.id) ||
    !isIdentifier(request.connectionId) ||
    !GATEWAY_OPERATIONS.includes(request.operation) ||
    !isIdentifier(request.requestId) ||
    (request.signal !== undefined && !(request.signal instanceof AbortSignal))
  ) {
    throw clientError("gateway_client_configuration_invalid");
  }

  return Object.freeze({
    resource: Object.freeze({ ...request.resource }),
    connectionId: request.connectionId,
    operation: request.operation,
    requestId: request.requestId,
    signal: request.signal,
  });
}

/** Validates and snapshots one operation-specific protocol invocation. */
function readProtocolRequest(
  request: GatewayProtocolClientRequest,
  kind: "action" | "chat"
): GatewayProtocolClientRequest {
  try {
    if (
      typeof request !== "object" ||
      request === null ||
      !hasExactKeys(request, [
        "connectionId",
        "input",
        "operation",
        "requestId",
        "resource",
        ...(request.signal === undefined ? [] : ["signal"]),
      ]) ||
      !isIdentifier(request.connectionId) ||
      !isIdentifier(request.requestId) ||
      (request.signal !== undefined &&
        !(request.signal instanceof AbortSignal)) ||
      (kind === "chat"
        ? request.operation !== "chat"
        : request.operation !== "mind-map-generation" &&
          request.operation !== "node-editing")
    ) {
      throw clientError("gateway_client_configuration_invalid");
    }

    const resource = readProtocolResourceIntent(request.resource);
    // Creating the closed envelope here validates every payload field before
    // authority lookup, while the canonical resource is substituted later.
    const validationResource: GatewayResourceAuthority =
      resource.type === "mindmap"
        ? { type: "owned-mindmap", id: resource.id }
        : { ...resource };
    const validated = createGatewayOperationEnvelope(
      request.operation,
      validationResource,
      request.input
    );
    return Object.freeze({
      resource: Object.freeze({ ...resource }),
      connectionId: request.connectionId,
      operation: request.operation,
      requestId: request.requestId,
      input: deepFreezeJson(validated.input),
      signal: request.signal,
    }) as GatewayProtocolClientRequest;
  } catch (error) {
    if (error instanceof GatewayClientError) throw error;
    throw clientError("gateway_client_configuration_invalid");
  }
}

/** Recursively freezes the already-validated JSON payload snapshot. */
function deepFreezeJson<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

/** Accepts either an owned-map lookup or the exact first-map bootstrap intent. */
function readProtocolResourceIntent(
  resource: GatewayProtocolResourceIntent
): GatewayProtocolResourceIntent {
  if (
    typeof resource !== "object" ||
    resource === null ||
    (resource.type === "mindmap"
      ? !hasExactKeys(resource, ["id", "type"]) || !isIdentifier(resource.id)
      : resource.type !== "owner-bootstrap" ||
        !hasExactKeys(resource, ["intent", "type"]) ||
        resource.intent !== "create-first-mindmap")
  ) {
    throw clientError("gateway_client_configuration_invalid");
  }
  return resource;
}

/** Executes an authority or signer dependency behind its request deadline. */
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

/**
 * Executes the atomic authorization resolver without exposing whether its
 * owner, resource, or connection checks failed, timed out, or were unavailable.
 */
async function runAuthorityStage<T>(
  operation: (context: ControlPlaneOperationContext) => T | PromiseLike<T>,
  timeoutMs: number,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal
): Promise<T> {
  try {
    return await runControlPlaneStage(
      operation,
      timeoutMs,
      requestSignal,
      callerSignal
    );
  } catch {
    if (callerSignal?.aborted) throw clientError("request_aborted");
    throw clientError("authorization_unavailable");
  }
}

/** Validates and snapshots authority returned only by the server dependency. */
function requireAuthorizedResolution(
  resolution: AuthorizedGatewayResolution | null,
  request: GatewayClientRequest | GatewayProtocolClientRequest
): AuthorizedGatewayResolution {
  try {
    if (
      resolution === null ||
      !isIdentifier(resolution.ownerId) ||
      !authorityResourceMatches(resolution.resource, request.resource) ||
      resolution.connection.requestedId !== request.connectionId ||
      !isIdentifier(resolution.connection.canonicalId) ||
      resolution.connection.provider !== "codex" ||
      resolution.connection.status !== "connected" ||
      resolution.connection.isDefault !== true ||
      resolution.operation !== request.operation
    ) {
      throw clientError("authorization_unavailable");
    }

    return Object.freeze({
      ownerId: resolution.ownerId,
      resource: Object.freeze({ ...resolution.resource }),
      connection: Object.freeze({ ...resolution.connection }),
      operation: resolution.operation,
    });
  } catch {
    throw clientError("authorization_unavailable");
  }
}

/** Matches the resolver's canonical authority to the exact caller intent. */
function authorityResourceMatches(
  authority: AuthorizedGatewayResolution["resource"],
  intent: GatewayProtocolResourceIntent
): boolean {
  if (authority.type === "mindmap") {
    return (
      intent.type === "mindmap" &&
      authority.requestedId === intent.id &&
      isIdentifier(authority.canonicalId)
    );
  }
  return (
    intent.type === "owner-bootstrap" &&
    authority.intent === "create-first-mindmap" &&
    intent.intent === authority.intent
  );
}

/** Converts resolver output into the authority carried by the v1 envelope. */
function canonicalProtocolAuthority(
  resource: AuthorizedGatewayResolution["resource"]
): GatewayResourceAuthority {
  return resource.type === "mindmap"
    ? Object.freeze({ type: "owned-mindmap", id: resource.canonicalId })
    : Object.freeze({
        type: "owner-bootstrap",
        intent: "create-first-mindmap",
      });
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
  cleanupTimeoutMs: number,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal,
  requireHeaderEnumeration = false
): Promise<unknown> {
  const body = readResponseBody(response);
  let declaredLength: number | undefined;
  let metadataValid = false;
  let metadataError: GatewayClientError | undefined;
  try {
    assertResponseHeaderBounds(response, requireHeaderEnumeration);
    const contentType = readBoundedResponseHeader(response, "content-type");
    declaredLength = readResponseContentLength(response, maxBytes);
    metadataValid =
      typeof response === "object" &&
      response !== null &&
      isGatewayStatus(response.status) &&
      response.redirected === false &&
      response.url === expectedUrl &&
      typeof response.headers?.get === "function" &&
      isJsonContentType(contentType) &&
      body !== null &&
      typeof body.getReader === "function";
  } catch (error) {
    // All transport metadata ambiguity shares one response failure below.
    if (error instanceof GatewayClientError) metadataError = error;
  }
  if (metadataError !== undefined) {
    await disposeResponseBody(body, cleanupTimeoutMs);
    throw metadataError;
  }
  if (!metadataValid || body === null) {
    await disposeResponseBody(body, cleanupTimeoutMs);
    throw clientError("gateway_response_invalid");
  }

  let encodedBody: Uint8Array;
  try {
    encodedBody = await readBoundedBody(
      body,
      maxBytes,
      maxChunks,
      requestSignal,
      callerSignal
    );
    if (
      declaredLength !== undefined &&
      declaredLength !== encodedBody.byteLength
    ) {
      throw clientError("gateway_response_invalid");
    }
  } catch (error) {
    await disposeResponseBody(body, cleanupTimeoutMs);
    if (error instanceof GatewayClientError) throw error;
    throw clientError("gateway_response_invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(encodedBody)
    );
  } catch {
    await disposeResponseBody(body, cleanupTimeoutMs);
    throw clientError("gateway_response_invalid");
  }

  const success = gatewaySuccessSchema.safeParse(value);
  if (response.status === 200 && success.success) return success.data.data;

  const failure = gatewayFailureSchema.safeParse(value);
  if (!failure.success) {
    await disposeResponseBody(body, cleanupTimeoutMs);
    throw clientError("gateway_response_invalid");
  }
  const expectedStatus = GATEWAY_ERROR_STATUS[failure.data.error.code];
  if (response.status !== expectedStatus) {
    await disposeResponseBody(body, cleanupTimeoutMs);
    throw clientError("gateway_response_invalid");
  }
  throw clientError(failure.data.error.code);
}

/**
 * Validates a chat response and returns a demand-driven bounded event stream.
 * The request deadline and caller abort remain active until close or cancel.
 */
async function createBoundedGatewayStream(
  response: GatewayTransportResponse,
  expectedUrl: string,
  maxBytes: number,
  maxChunks: number,
  cleanupTimeoutMs: number,
  requestSignal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  finishRequest: () => void
): Promise<ReadableStream<GatewayChatChunk>> {
  if (response.status !== 200) {
    await readGatewayResponse(
      response,
      expectedUrl,
      maxBytes,
      maxChunks,
      cleanupTimeoutMs,
      requestSignal,
      callerSignal,
      true
    );
    throw clientError("gateway_response_invalid");
  }

  const body = readResponseBody(response);
  let declaredLength: number | undefined;
  let metadataValid = false;
  let metadataError: GatewayClientError | undefined;
  try {
    assertResponseHeaderBounds(response, true);
    const contentType = readBoundedResponseHeader(response, "content-type");
    declaredLength = readResponseContentLength(response, maxBytes);
    metadataValid =
      response.redirected === false &&
      response.url === expectedUrl &&
      contentType === GATEWAY_CHAT_STREAM_CONTENT_TYPE &&
      body !== null &&
      typeof body.getReader === "function";
  } catch (error) {
    // All hostile or ambiguous metadata shares one stable response failure.
    if (error instanceof GatewayClientError) metadataError = error;
  }
  if (metadataError !== undefined) {
    await disposeResponseBody(body, cleanupTimeoutMs);
    throw metadataError;
  }
  if (!metadataValid || body === null) {
    await disposeResponseBody(body, cleanupTimeoutMs);
    throw clientError("gateway_response_invalid");
  }

  let reader: GatewayResponseBodyReader;
  try {
    reader = body.getReader();
  } catch {
    await disposeResponseBody(body, cleanupTimeoutMs);
    throw clientError("gateway_response_invalid");
  }

  let byteCount = 0;
  let chunkCount = 0;
  let pendingBytes = new Uint8Array();
  let upstreamDone = false;
  let terminal = false;
  let reading = false;

  /** Releases request and reader ownership once, observing hostile cleanup. */
  const close = (cancelReader: boolean): void => {
    if (terminal) return;
    terminal = true;
    requestSignal.removeEventListener("abort", handleAbort);
    if (cancelReader) {
      try {
        void Promise.resolve(reader.cancel()).catch(() => undefined);
      } catch {
        // A non-conforming reader cannot replace the stable stream outcome.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // Reader cleanup is best-effort after the protocol outcome is fixed.
    }
    finishRequest();
  };
  let streamController:
    | ReadableStreamDefaultController<GatewayChatChunk>
    | undefined;
  const handleAbort = (): void => {
    const error = cancellationError(requestSignal, callerSignal);
    close(true);
    try {
      streamController?.error(error);
    } catch {
      // A concurrent consumer cancellation may already own stream termination.
    }
  };

  return new ReadableStream<GatewayChatChunk>(
    {
      start(controller) {
        streamController = controller;
        requestSignal.addEventListener("abort", handleAbort, { once: true });
        if (requestSignal.aborted) handleAbort();
      },
      async pull(controller) {
        if (terminal || reading) return;
        reading = true;
        try {
          while (true) {
            const newline = pendingBytes.indexOf(10);
            if (newline >= 0) {
              const line = pendingBytes.slice(0, newline);
              pendingBytes = pendingBytes.slice(newline + 1);
              if (line.byteLength === 0) {
                throw clientError("gateway_response_invalid");
              }
              let value: unknown;
              try {
                value = JSON.parse(
                  new TextDecoder("utf-8", { fatal: true }).decode(line)
                );
                controller.enqueue(parseGatewayChatStreamFrame(value));
              } catch {
                throw clientError("gateway_response_invalid");
              }
              return;
            }

            if (upstreamDone) {
              if (
                pendingBytes.byteLength !== 0 ||
                (declaredLength !== undefined && declaredLength !== byteCount)
              ) {
                throw clientError("gateway_response_invalid");
              }
              close(false);
              controller.close();
              return;
            }

            const result = await awaitObserved(
              reader.read(),
              requestSignal,
              callerSignal
            );
            if (result.done) {
              upstreamDone = true;
              continue;
            }
            if (
              !(result.value instanceof Uint8Array) ||
              result.value.byteLength === 0
            ) {
              throw clientError("gateway_response_invalid");
            }
            chunkCount += 1;
            byteCount += result.value.byteLength;
            if (chunkCount > maxChunks || byteCount > maxBytes) {
              throw clientError("response_too_large");
            }
            const combined = new Uint8Array(
              pendingBytes.byteLength + result.value.byteLength
            );
            combined.set(pendingBytes);
            combined.set(result.value, pendingBytes.byteLength);
            pendingBytes = combined;
          }
        } catch (error) {
          close(true);
          controller.error(
            error instanceof GatewayClientError
              ? error
              : clientError("gateway_response_invalid")
          );
        } finally {
          reading = false;
        }
      },
      cancel() {
        close(true);
      },
    },
    // Zero buffering guarantees the server client never pre-drains chat data.
    { highWaterMark: 0 }
  );
}

/** Reads one bounded scalar response header without reflecting its contents. */
function readBoundedResponseHeader(
  response: GatewayTransportResponse,
  name: string
): string | null {
  const value = response.headers.get(name);
  if (value !== null && value.length > MAX_RESPONSE_HEADER_VALUE_LENGTH) {
    throw clientError("gateway_response_invalid");
  }
  return value;
}

/** Bounds every enumerable response header for versioned protocol calls. */
function assertResponseHeaderBounds(
  response: GatewayTransportResponse,
  requireEnumeration: boolean
): void {
  const entries = response.headers?.entries;
  if (typeof entries !== "function") {
    if (requireEnumeration) throw clientError("gateway_response_invalid");
    return;
  }
  let count = 0;
  const iterator = entries.call(response.headers);
  while (true) {
    const next = iterator.next();
    if (next.done) break;
    const [name, value] = next.value;
    count += 1;
    if (
      count > MAX_RESPONSE_HEADER_COUNT ||
      name.length === 0 ||
      name.length > MAX_RESPONSE_HEADER_NAME_LENGTH ||
      value.length > MAX_RESPONSE_HEADER_VALUE_LENGTH
    ) {
      throw clientError("gateway_response_invalid");
    }
  }
}

/** Validates an optional exact content length before reading any body bytes. */
function readResponseContentLength(
  response: GatewayTransportResponse,
  maxBytes: number
): number | undefined {
  const value = readBoundedResponseHeader(response, "content-length");
  if (value === null) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw clientError("gateway_response_invalid");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw clientError("gateway_response_invalid");
  }
  if (length > maxBytes) throw clientError("response_too_large");
  return length;
}

/** Reads a response stream with hard byte/chunk limits and observed cancellation. */
async function readBoundedBody(
  body: GatewayResponseBody,
  maxBytes: number,
  maxChunks: number,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal
): Promise<Uint8Array> {
  if (requestSignal.aborted) {
    throw cancellationError(requestSignal, callerSignal);
  }
  let reader: GatewayResponseBodyReader;
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

/** Reads a body reference without allowing hostile response getters to escape. */
function readResponseBody(
  response: GatewayTransportResponse
): GatewayResponseBody | null {
  try {
    return typeof response === "object" && response !== null
      ? response.body
      : null;
  } catch {
    return null;
  }
}

/** Disposes an unused body behind a finite bound and observes cleanup failures. */
async function disposeResponseBody(
  body: GatewayResponseBody | null,
  timeoutMs: number
): Promise<void> {
  if (body === null || typeof body !== "object") return;

  const cleanup = Promise.resolve().then(async () => {
    if (typeof body.cancel === "function") {
      await body.cancel();
      return;
    }
    if (typeof body.getReader !== "function") return;
    const reader = body.getReader();
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  });
  // Both branches resolve: cleanup failures and a stalled cancel are observed
  // without replacing the original request outcome.
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    cleanup.then(finish, finish);
  });
}

/** Disposes a body returned after request cancellation without awaiting it. */
function observeResponseDisposal(
  response: GatewayTransportResponse,
  timeoutMs: number
): void {
  void Promise.resolve()
    .then(() => disposeResponseBody(readResponseBody(response), timeoutMs))
    .catch(() => undefined);
}

/** Awaits a promise while retaining both late fulfillment and rejection handlers. */
function awaitObserved<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal,
  callerSignal?: AbortSignal,
  onLateFulfilled?: (value: T) => void
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
      (value) => {
        if (settled) {
          try {
            onLateFulfilled?.(value);
          } catch {
            // Late cleanup hooks are best-effort and must remain observed.
          }
          return;
        }
        finish(() => resolve(value));
      },
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

/** Validates and snapshots a nonempty exact HTTPS origin allowlist. */
function readGatewayOriginAllowlist(
  values: readonly string[]
): readonly string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 32) {
    throw clientError("gateway_client_configuration_invalid");
  }
  const origins = values.map(readCanonicalGatewayOrigin);
  if (new Set(origins).size !== origins.length) {
    throw clientError("gateway_client_configuration_invalid");
  }
  return Object.freeze(origins);
}

/** Requires the selected origin to be one exact allowlist member. */
function readSelectedGatewayOrigin(
  value: string,
  allowlist: readonly string[]
): string {
  const origin = readCanonicalGatewayOrigin(value);
  if (!allowlist.includes(origin)) {
    throw clientError("gateway_client_configuration_invalid");
  }
  return origin;
}

/**
 * Accepts one canonical HTTPS origin with a public-looking ASCII DNS host.
 * A non-default port is accepted only when its exact origin is allowlisted.
 */
function readCanonicalGatewayOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw clientError("gateway_client_configuration_invalid");
  }

  const hostname = parsed.hostname;
  const labels = hostname.split(".");
  const addressCandidate = hostname.replace(/^\[|\]$/g, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== value ||
    hostname.length === 0 ||
    hostname.endsWith(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.includes("xn--") ||
    isIP(addressCandidate) !== 0 ||
    !/^[a-z0-9.-]+$/.test(hostname) ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-")
    )
  ) {
    throw clientError("gateway_client_configuration_invalid");
  }
  return parsed.origin;
}

/** Recognizes statuses that have an exact local response-schema mapping. */
function isGatewayStatus(value: unknown): value is number {
  return (
    value === 200 ||
    Object.values(GATEWAY_ERROR_STATUS).some((status) => status === value)
  );
}

/** Maps every stable client code to one non-secret HTTP boundary status. */
function statusForClientError(code: GatewayClientErrorCode): number {
  if (code in GATEWAY_ERROR_STATUS) {
    return GATEWAY_ERROR_STATUS[code as GatewayRemoteErrorCode];
  }
  const localStatus: Readonly<
    Record<Exclude<GatewayClientErrorCode, GatewayRemoteErrorCode>, number>
  > = {
    authorization_unavailable: 404,
    gateway_client_configuration_invalid: 500,
    gateway_response_invalid: 502,
    gateway_unavailable: 503,
    response_too_large: 502,
  };
  return localStatus[code as keyof typeof localStatus];
}

/** Requires an object to expose exactly the server client's narrow fields. */
function hasExactKeys(value: object, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actualKeys.length === expected.length &&
    actualKeys.every((key, index) => key === expected[index])
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
  type AuthorizeGatewayIntentInput,
  createFetchGatewayTransport,
  createGatewayServerClient,
  type FetchImplementation,
  type GatewayActionClientRequest,
  type GatewayAssertionSigner,
  type GatewayAuthorityResolver,
  type GatewayBootstrapResourceIntent,
  type GatewayChatClientRequest,
  GatewayClientError,
  type GatewayClientErrorCode,
  type GatewayClientRequest,
  type GatewayProtocolClientRequest,
  type GatewayProtocolResourceIntent,
  type GatewayRemoteErrorCode,
  type GatewayResourceIntent,
  type GatewayResponseBody,
  type GatewayResponseBodyReader,
  type GatewayServerClient,
  type GatewayServerClientOptions,
  type GatewayTransport,
  type GatewayTransportRequest,
  type GatewayTransportResponse,
  type SignAssertionInput,
};
