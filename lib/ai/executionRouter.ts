import "server-only";

import { z } from "zod";

import type { GatewayOperation } from "../../services/agent-gateway/internal-auth.ts";
import type {
  GatewayClientRequest,
  GatewayServerClient,
} from "../gateway/server-client.ts";
import type { CreateAIChatStreamOptions } from "./chatTypes";
import { AIConfigurationError } from "./errors";
import {
  createAIChatStream,
  generateAIStructured,
  isAIConfigured,
} from "./providerRouter";

const CONNECTIONS_V2_ENV_VAR = "SPRIG_CONNECTIONS_V2";
const DEFAULT_CONNECTION_RESOLUTION_TIMEOUT_MS = 1_000;
const MAX_CONNECTION_RESOLUTION_TIMEOUT_MS = 10_000;
const MAX_IDENTIFIER_LENGTH = 256;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const gatewayOperations = [
  "chat",
  "mind-map-generation",
  "node-editing",
] as const satisfies readonly GatewayOperation[];

type AIExecutionMode = "connections-v2" | "local-operator";

type ConnectionExecutionIntent = Readonly<{
  operation: GatewayOperation;
  signal: AbortSignal;
}>;

type ConnectionExecutionResolution = Readonly<{
  ownerId: string;
  connection: Readonly<{
    id: string;
    provider: "codex";
    status: "connected";
    isDefault: true;
  }>;
  operation: GatewayOperation;
  resource: GatewayClientRequest["resource"];
}>;

interface ConnectionExecutionResolver {
  /** Derives owner, default connection, provider, and resource on the server. */
  resolve(
    intent: ConnectionExecutionIntent,
    context: Readonly<{
      signal: AbortSignal;
      deadlineAtMilliseconds: number;
    }>
  ):
    | ConnectionExecutionResolution
    | null
    | Promise<ConnectionExecutionResolution | null>;
}

type ConnectionExecutionRouter = Readonly<{
  execute(intent: ConnectionExecutionIntent): Promise<unknown>;
}>;

type ConnectionExecutionRouterOptions = Readonly<{
  resolver: ConnectionExecutionResolver;
  gatewayClient: GatewayServerClient;
  createRequestId?: () => string;
  resolutionTimeoutMs?: number;
}>;

type GenerateRoutedAIStructuredOptions<Schema extends z.ZodType> = {
  instructions: string;
  operation: Extract<GatewayOperation, "mind-map-generation" | "node-editing">;
  prompt: string;
  schema: Schema;
  signal?: AbortSignal;
};

type AIExecutionDispatcher = Readonly<{
  createChatStream(
    options: CreateAIChatStreamOptions
  ): Promise<ReturnType<typeof createAIChatStream>>;
  generateStructured<Schema extends z.ZodType>(
    options: GenerateRoutedAIStructuredOptions<Schema>
  ): Promise<{ rawOutput: string; output: z.infer<Schema> }>;
  isConfigured(): boolean;
}>;

type AIExecutionDispatcherOptions = Readonly<{
  connectionsRouter?: ConnectionExecutionRouter;
  readConnectionsFlag?: () => string | undefined;
}>;

/** Reads the exact migration flag; ambiguity fails closed instead of choosing a lane. */
function getAIExecutionMode(
  value = process.env[CONNECTIONS_V2_ENV_VAR]
): AIExecutionMode {
  if (value === undefined || value === "false") return "local-operator";
  if (value === "true") return "connections-v2";

  throw new AIConfigurationError();
}

/** Creates the immutable request-scoped resolver-to-gateway execution boundary. */
function createConnectionExecutionRouter(
  options: ConnectionExecutionRouterOptions
): ConnectionExecutionRouter {
  const resolutionTimeoutMs =
    options.resolutionTimeoutMs ?? DEFAULT_CONNECTION_RESOLUTION_TIMEOUT_MS;

  if (
    typeof options.resolver?.resolve !== "function" ||
    typeof options.gatewayClient?.execute !== "function" ||
    !Number.isSafeInteger(resolutionTimeoutMs) ||
    resolutionTimeoutMs < 1 ||
    resolutionTimeoutMs > MAX_CONNECTION_RESOLUTION_TIMEOUT_MS ||
    (options.createRequestId !== undefined &&
      typeof options.createRequestId !== "function")
  ) {
    throw new AIConfigurationError();
  }

  const createRequestId =
    options.createRequestId ?? (() => crypto.randomUUID());

  return Object.freeze({
    async execute(rawIntent: ConnectionExecutionIntent): Promise<unknown> {
      const intent = readExecutionIntent(rawIntent);
      const resolutionController = new AbortController();
      const forwardAbort = (): void => resolutionController.abort();
      intent.signal.addEventListener("abort", forwardAbort, { once: true });
      if (intent.signal.aborted) forwardAbort();
      const deadlineAtMilliseconds = Date.now() + resolutionTimeoutMs;
      const timer = setTimeout(
        () => resolutionController.abort(),
        resolutionTimeoutMs
      );

      try {
        const resolution = await awaitResolution(
          () =>
            options.resolver.resolve(
              intent,
              Object.freeze({
                signal: resolutionController.signal,
                deadlineAtMilliseconds,
              })
            ),
          resolutionController.signal
        );
        const authority = readResolution(resolution, intent.operation);
        const requestId = createRequestId();
        if (!isIdentifier(requestId)) throw new AIConfigurationError();

        return await options.gatewayClient.execute(
          Object.freeze({
            resource: authority.resource,
            connectionId: authority.connection.id,
            operation: authority.operation,
            requestId,
            signal: intent.signal,
          })
        );
      } finally {
        clearTimeout(timer);
        intent.signal.removeEventListener("abort", forwardAbort);
        resolutionController.abort();
      }
    },
  });
}

/** Builds the one mode switch used by chat, first-map, and node-edit execution. */
function createAIExecutionDispatcher(
  options: AIExecutionDispatcherOptions = {}
): AIExecutionDispatcher {
  const readConnectionsFlag =
    options.readConnectionsFlag ?? (() => process.env[CONNECTIONS_V2_ENV_VAR]);

  /** Resolves the current lane without allowing a failed v2 route to fall back. */
  function mode(): AIExecutionMode {
    return getAIExecutionMode(readConnectionsFlag());
  }

  /** Requires the human-gated production composition before v2 execution. */
  function requireConnectionsRouter(): ConnectionExecutionRouter {
    if (options.connectionsRouter === undefined) {
      throw new AIConfigurationError();
    }
    return options.connectionsRouter;
  }

  return Object.freeze({
    isConfigured(): boolean {
      try {
        return mode() === "local-operator"
          ? isAIConfigured()
          : options.connectionsRouter !== undefined;
      } catch {
        return false;
      }
    },

    async createChatStream(
      options
    ): Promise<ReturnType<typeof createAIChatStream>> {
      if (mode() === "local-operator") {
        return createAIChatStream(options);
      }

      const value = await requireConnectionsRouter().execute(
        Object.freeze({ operation: "chat", signal: options.abortSignal })
      );
      if (!(value instanceof ReadableStream)) throw new AIConfigurationError();
      return value as ReturnType<typeof createAIChatStream>;
    },

    async generateStructured<Schema extends z.ZodType>(
      options: GenerateRoutedAIStructuredOptions<Schema>
    ): Promise<{ rawOutput: string; output: z.infer<Schema> }> {
      if (mode() === "local-operator") {
        return generateAIStructured({
          instructions: options.instructions,
          prompt: options.prompt,
          schema: options.schema,
        });
      }

      const signal = options.signal ?? new AbortController().signal;
      const value = await requireConnectionsRouter().execute(
        Object.freeze({ operation: options.operation, signal })
      );
      const envelope = z
        .object({ rawOutput: z.string(), output: z.unknown() })
        .strict()
        .safeParse(value);
      if (!envelope.success) throw new AIConfigurationError();

      const output = options.schema.safeParse(envelope.data.output);
      if (!output.success) throw new AIConfigurationError();
      return { rawOutput: envelope.data.rawOutput, output: output.data };
    },
  });
}

/** Strictly snapshots the operation and server-owned abort channel. */
function readExecutionIntent(
  intent: ConnectionExecutionIntent
): ConnectionExecutionIntent {
  try {
    if (
      typeof intent !== "object" ||
      intent === null ||
      !hasExactKeys(intent, ["operation", "signal"]) ||
      !gatewayOperations.includes(intent.operation) ||
      !(intent.signal instanceof AbortSignal)
    ) {
      throw new AIConfigurationError();
    }

    return Object.freeze({
      operation: intent.operation,
      signal: intent.signal,
    });
  } catch {
    throw new AIConfigurationError();
  }
}

/** Validates the complete server resolution before revealing its opaque handle. */
function readResolution(
  resolution: ConnectionExecutionResolution | null,
  operation: GatewayOperation
): ConnectionExecutionResolution {
  try {
    if (
      resolution === null ||
      typeof resolution !== "object" ||
      !hasExactKeys(resolution, [
        "connection",
        "operation",
        "ownerId",
        "resource",
      ]) ||
      !isIdentifier(resolution.ownerId) ||
      resolution.operation !== operation ||
      typeof resolution.connection !== "object" ||
      resolution.connection === null ||
      !hasExactKeys(resolution.connection, [
        "id",
        "isDefault",
        "provider",
        "status",
      ]) ||
      resolution.connection.provider !== "codex" ||
      resolution.connection.status !== "connected" ||
      resolution.connection.isDefault !== true ||
      !isIdentifier(resolution.connection.id) ||
      typeof resolution.resource !== "object" ||
      resolution.resource === null ||
      !hasExactKeys(resolution.resource, ["id", "type"]) ||
      resolution.resource.type !== "mindmap" ||
      !isIdentifier(resolution.resource.id)
    ) {
      throw new AIConfigurationError();
    }

    return Object.freeze({
      ownerId: resolution.ownerId,
      connection: Object.freeze({ ...resolution.connection }),
      operation: resolution.operation,
      resource: Object.freeze({ ...resolution.resource }),
    });
  } catch {
    throw new AIConfigurationError();
  }
}

/** Observes a late resolver outcome after abort without allowing it to execute. */
function awaitResolution(
  resolve: () =>
    | ConnectionExecutionResolution
    | null
    | Promise<ConnectionExecutionResolution | null>,
  signal: AbortSignal
): Promise<ConnectionExecutionResolution | null> {
  return new Promise((accept, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      callback();
    };
    const handleAbort = (): void =>
      finish(() => reject(new AIConfigurationError()));
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();

    Promise.resolve()
      .then(() => {
        if (settled) throw new AIConfigurationError();
        return resolve();
      })
      .then(
        (resolution) => finish(() => accept(resolution)),
        () => finish(() => reject(new AIConfigurationError()))
      );
  });
}

/** Restricts authority and request identifiers to one bounded opaque alphabet. */
function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    IDENTIFIER_PATTERN.test(value)
  );
}

/** Requires one exact own enumerable contract without accepting hidden fields. */
function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

const defaultAIExecutionDispatcher = createAIExecutionDispatcher();

/** Routes chat through either the explicit local lane or connections v2. */
function createRoutedAIChatStream(options: CreateAIChatStreamOptions) {
  return defaultAIExecutionDispatcher.createChatStream(options);
}

/** Routes strict generation through the same mode and connection contract. */
function generateRoutedAIStructured<Schema extends z.ZodType>(
  options: GenerateRoutedAIStructuredOptions<Schema>
) {
  return defaultAIExecutionDispatcher.generateStructured(options);
}

/** Reports only currently constructible execution lanes. */
function isRoutedAIConfigured(): boolean {
  return defaultAIExecutionDispatcher.isConfigured();
}

export {
  type AIExecutionDispatcher,
  type AIExecutionDispatcherOptions,
  type AIExecutionMode,
  type ConnectionExecutionIntent,
  type ConnectionExecutionResolution,
  type ConnectionExecutionResolver,
  type ConnectionExecutionRouter,
  type ConnectionExecutionRouterOptions,
  CONNECTIONS_V2_ENV_VAR,
  createAIExecutionDispatcher,
  createConnectionExecutionRouter,
  createRoutedAIChatStream,
  generateRoutedAIStructured,
  type GenerateRoutedAIStructuredOptions,
  getAIExecutionMode,
  isRoutedAIConfigured,
};
