import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AIConfigurationError } from "./errors";
import {
  type ConnectionExecutionIntent,
  type ConnectionExecutionResolution,
  createAIExecutionDispatcher,
  createConnectionExecutionRouter,
  getAIExecutionMode,
} from "./executionRouter";

vi.mock("server-only", () => ({}));

const providerMocks = vi.hoisted(() => ({
  createAIChatStream: vi.fn(),
  generateAIStructured: vi.fn(),
  isAIConfigured: vi.fn(() => true),
}));

vi.mock("./providerRouter", () => providerMocks);

/** Returns one complete server-derived connected Codex authority snapshot. */
function connectedResolution(
  overrides: Partial<ConnectionExecutionResolution> = {}
): ConnectionExecutionResolution {
  return {
    ownerId: "owner-alice",
    connection: {
      id: "connection-alice",
      provider: "codex",
      status: "connected",
      isDefault: true,
    },
    operation: "chat",
    resource: { type: "mindmap", id: "resource-alice" },
    ...overrides,
  };
}

/** Creates the current chat options without exposing authority fields. */
function chatOptions(signal = new AbortController().signal) {
  return {
    abortSignal: signal,
    instructions: "Help with the map",
    messages: [],
    onFinish: vi.fn(),
    tools: {},
  } as never;
}

describe("connection execution router", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes only the server-resolved default Codex handle to the gateway client", async () => {
    const signal = new AbortController().signal;
    const resolve = vi.fn(async () => connectedResolution());
    const execute = vi.fn(async () => ({ ok: true }));
    const router = createConnectionExecutionRouter({
      resolver: { resolve },
      gatewayClient: { execute },
      createRequestId: () => "request-server-1",
    });

    await expect(
      router.execute({ operation: "chat", signal })
    ).resolves.toEqual({ ok: true });
    expect(resolve).toHaveBeenCalledWith(
      { operation: "chat", signal },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAtMilliseconds: expect.any(Number),
      })
    );
    expect(execute).toHaveBeenCalledWith({
      resource: { type: "mindmap", id: "resource-alice" },
      connectionId: "connection-alice",
      operation: "chat",
      requestId: "request-server-1",
      signal,
    });
  });

  it.each([
    ["missing", null],
    [
      "disconnected",
      connectedResolution({
        connection: {
          id: "connection-alice",
          provider: "codex",
          status: "expired" as "connected",
          isDefault: true,
        },
      }),
    ],
    [
      "non-default",
      connectedResolution({
        connection: {
          id: "connection-alice",
          provider: "codex",
          status: "connected",
          isDefault: false as true,
        },
      }),
    ],
    [
      "provider mismatch",
      connectedResolution({
        connection: {
          id: "connection-alice",
          provider: "claude" as "codex",
          status: "connected",
          isDefault: true,
        },
      }),
    ],
    ["operation mismatch", connectedResolution({ operation: "node-editing" })],
  ])("fails closed for a %s resolution", async (_name, resolution) => {
    const execute = vi.fn();
    const router = createConnectionExecutionRouter({
      resolver: { resolve: vi.fn(async () => resolution) },
      gatewayClient: { execute },
    });

    await expect(
      router.execute({
        operation: "chat",
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(AIConfigurationError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects caller-smuggled authority before resolution", async () => {
    const resolve = vi.fn();
    const execute = vi.fn();
    const router = createConnectionExecutionRouter({
      resolver: { resolve },
      gatewayClient: { execute },
    });
    const forged = {
      operation: "chat",
      signal: new AbortController().signal,
      provider: "codex",
      connectionId: "connection-bob",
      ownerId: "owner-bob",
      home: "/credential/home",
      model: "override",
      gatewayOrigin: "https://evil.test",
    } as unknown as ConnectionExecutionIntent;

    await expect(router.execute(forged)).rejects.toBeInstanceOf(
      AIConfigurationError
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not call a queued resolver after caller cancellation", async () => {
    const controller = new AbortController();
    const resolve = vi.fn();
    const execute = vi.fn();
    const router = createConnectionExecutionRouter({
      resolver: { resolve },
      gatewayClient: { execute },
    });
    controller.abort("credential-canary");

    await expect(
      router.execute({ operation: "chat", signal: controller.signal })
    ).rejects.toBeInstanceOf(AIConfigurationError);
    expect(resolve).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("AI execution migration dispatcher", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("preserves all three existing operator-only entrypoints while the flag is off", async () => {
    const localStream = new ReadableStream();
    providerMocks.createAIChatStream.mockReturnValue(localStream);
    providerMocks.generateAIStructured
      .mockResolvedValueOnce({
        rawOutput: '{"name":"Map"}',
        output: { name: "Map" },
      })
      .mockResolvedValueOnce({
        rawOutput: '{"nodes":[]}',
        output: { nodes: [] },
      });
    const connectionsExecute = vi.fn();
    const dispatcher = createAIExecutionDispatcher({
      readConnectionsFlag: () => "false",
      connectionsRouter: { execute: connectionsExecute },
    });

    await expect(dispatcher.createChatStream(chatOptions())).resolves.toBe(
      localStream
    );
    await expect(
      dispatcher.generateStructured({
        instructions: "Generate a map",
        operation: "mind-map-generation",
        prompt: "Launch",
        schema: z.object({ name: z.string() }),
      })
    ).resolves.toEqual({
      rawOutput: '{"name":"Map"}',
      output: { name: "Map" },
    });
    await expect(
      dispatcher.generateStructured({
        instructions: "Edit a node",
        operation: "node-editing",
        prompt: "Expand",
        schema: z.object({ nodes: z.array(z.unknown()) }),
      })
    ).resolves.toEqual({ rawOutput: '{"nodes":[]}', output: { nodes: [] } });

    expect(providerMocks.createAIChatStream).toHaveBeenCalledOnce();
    expect(providerMocks.generateAIStructured).toHaveBeenCalledTimes(2);
    expect(connectionsExecute).not.toHaveBeenCalled();
  });

  it("routes all three v2 entrypoints through the same connection resolver", async () => {
    const chatStream = new ReadableStream();
    const resolve = vi.fn(async (intent: ConnectionExecutionIntent) =>
      connectedResolution({
        operation: intent.operation,
        resource: {
          type: "mindmap",
          id: `server-resource-${intent.operation}`,
        },
      })
    );
    const gatewayExecute = vi.fn(async ({ operation }) => {
      if (operation === "chat") return chatStream;
      if (operation === "mind-map-generation") {
        return { rawOutput: '{"name":"Map"}', output: { name: "Map" } };
      }
      return { rawOutput: '{"nodes":[]}', output: { nodes: [] } };
    });
    const connectionsRouter = createConnectionExecutionRouter({
      resolver: { resolve },
      gatewayClient: { execute: gatewayExecute },
      createRequestId: () => "server-request-id",
    });
    const dispatcher = createAIExecutionDispatcher({
      readConnectionsFlag: () => "true",
      connectionsRouter,
    });
    const chatSignal = new AbortController().signal;

    await dispatcher.createChatStream(chatOptions(chatSignal));
    await dispatcher.generateStructured({
      instructions: "Generate a map",
      operation: "mind-map-generation",
      prompt: "Launch",
      schema: z.object({ name: z.string() }),
    });
    await dispatcher.generateStructured({
      instructions: "Edit a node",
      operation: "node-editing",
      prompt: "Expand",
      schema: z.object({ nodes: z.array(z.unknown()) }),
    });

    expect(resolve.mock.calls.map(([intent]) => intent.operation)).toEqual([
      "chat",
      "mind-map-generation",
      "node-editing",
    ]);
    expect(gatewayExecute.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({
        operation: "chat",
        connectionId: "connection-alice",
        signal: chatSignal,
      }),
      expect.objectContaining({
        operation: "mind-map-generation",
        connectionId: "connection-alice",
        signal: expect.any(AbortSignal),
      }),
      expect.objectContaining({
        operation: "node-editing",
        connectionId: "connection-alice",
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(providerMocks.createAIChatStream).not.toHaveBeenCalled();
    expect(providerMocks.generateAIStructured).not.toHaveBeenCalled();
  });

  it("fails closed without the human-gated adapter and never falls back", async () => {
    const dispatcher = createAIExecutionDispatcher({
      readConnectionsFlag: () => "true",
    });

    expect(dispatcher.isConfigured()).toBe(false);
    await expect(
      dispatcher.createChatStream(chatOptions())
    ).rejects.toBeInstanceOf(AIConfigurationError);
    await expect(
      dispatcher.generateStructured({
        instructions: "Generate a map",
        operation: "mind-map-generation",
        prompt: "Launch",
        schema: z.object({ name: z.string() }),
      })
    ).rejects.toBeInstanceOf(AIConfigurationError);
    await expect(
      dispatcher.generateStructured({
        instructions: "Edit a node",
        operation: "node-editing",
        prompt: "Expand",
        schema: z.object({ nodes: z.array(z.unknown()) }),
      })
    ).rejects.toBeInstanceOf(AIConfigurationError);
    expect(providerMocks.createAIChatStream).not.toHaveBeenCalled();
    expect(providerMocks.generateAIStructured).not.toHaveBeenCalled();
  });

  it("treats an ambiguous flag value as unavailable", async () => {
    const dispatcher = createAIExecutionDispatcher({
      readConnectionsFlag: () => "TRUE",
      connectionsRouter: { execute: vi.fn() },
    });

    expect(dispatcher.isConfigured()).toBe(false);
    await expect(
      dispatcher.createChatStream(chatOptions())
    ).rejects.toBeInstanceOf(AIConfigurationError);
  });
});

describe("connections v2 flag", () => {
  it("defaults to the existing local lane and accepts only exact booleans", () => {
    expect(getAIExecutionMode(undefined)).toBe("local-operator");
    expect(getAIExecutionMode("false")).toBe("local-operator");
    expect(getAIExecutionMode("true")).toBe("connections-v2");
    expect(() => getAIExecutionMode("1")).toThrow(AIConfigurationError);
  });
});
