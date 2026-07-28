import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  convertToModelMessages: vi.fn(),
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
  getConvexAuthToken: vi.fn(),
  responseOptions: undefined as
    | {
        headers?: HeadersInit;
        onFinish?: (event: {
          responseMessage: UIMessage;
        }) => PromiseLike<void> | void;
      }
    | undefined,
  streamText: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("convex/nextjs", () => ({
  fetchMutation: mocks.fetchMutation,
  fetchQuery: mocks.fetchQuery,
}));
vi.mock("@/lib/convex-server", () => ({
  getConvexAuthToken: mocks.getConvexAuthToken,
}));
vi.mock("@/lib/anthropic", () => ({
  getAnthropicModel: () => ({ modelId: "test-model" }),
  isAIConfigured: () => Boolean(process.env.ANTHROPIC_OAUTH_TOKEN),
}));
vi.mock("ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("ai")>();

  return {
    ...original,
    convertToModelMessages: mocks.convertToModelMessages,
    streamText: mocks.streamText,
  };
});

const userMessage: UIMessage = {
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "Build a launch plan" }],
};

/** Creates one JSON chat request accepted by the route validator. */
function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Returns the compact owned-map shape consumed by the chat route. */
function createMindmapResult() {
  return {
    mindmap: { name: "Launch plan" },
    nodes: [
      {
        nodeId: "root",
        parentId: null,
        type: "root" as const,
        title: "Launch plan",
        order: 0,
      },
    ],
  };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_OAUTH_TOKEN = "oauth-token";
    mocks.auth.mockResolvedValue({
      userId: "user-1",
      getToken: vi.fn(async () => "convex-token"),
    });
    mocks.getConvexAuthToken.mockResolvedValue("convex-token");
    mocks.fetchQuery.mockResolvedValue(createMindmapResult());
    mocks.convertToModelMessages.mockResolvedValue([
      { role: "user", content: "Build a launch plan" },
    ]);
    mocks.responseOptions = undefined;
    mocks.streamText.mockReturnValue({
      toUIMessageStreamResponse: vi.fn((options) => {
        mocks.responseOptions = options;
        return new Response("stream", { headers: options.headers });
      }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
  });

  it("returns 401 JSON before reading configuration for an unauthenticated user", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    delete process.env.ANTHROPIC_OAUTH_TOKEN;

    const response = await POST(
      createRequest({ mindmapId: "map-1", messages: [userMessage] })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthenticated",
    });
    expect(mocks.getConvexAuthToken).not.toHaveBeenCalled();
    expect(mocks.fetchQuery).not.toHaveBeenCalled();
  });

  it("returns 503 JSON when the Claude OAuth token is absent", async () => {
    delete process.env.ANTHROPIC_OAUTH_TOKEN;

    const response = await POST(
      createRequest({ mindmapId: "map-1", messages: [userMessage] })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AI is not configured",
    });
    expect(mocks.getConvexAuthToken).not.toHaveBeenCalled();
  });

  it("creates a titled thread and exposes it on the streamed response", async () => {
    mocks.fetchMutation.mockResolvedValueOnce("thread-1");

    const response = await POST(
      createRequest({ mindmapId: "map-1", messages: [userMessage] })
    );

    expect(mocks.getConvexAuthToken).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMutation.mock.calls[0]?.[1]).toEqual({
      mindmapId: "map-1",
      title: "Build a launch plan",
    });
    expect(response.headers.get("x-sprig-thread-id")).toBe("thread-1");
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("[nodeId:root]"),
        messages: [{ role: "user", content: "Build a launch plan" }],
        tools: expect.any(Object),
        stopWhen: expect.any(Function),
      })
    );
  });

  it("persists full UI parts and links the latest applied operation", async () => {
    mocks.fetchMutation
      .mockResolvedValueOnce("thread-1")
      .mockResolvedValueOnce({ operationId: "operation-7", seq: 7 })
      .mockResolvedValueOnce("user-message-1")
      .mockResolvedValueOnce("assistant-message-1");

    await POST(createRequest({ mindmapId: "map-1", messages: [userMessage] }));

    const streamOptions = mocks.streamText.mock.calls[0]?.[0];
    await streamOptions.tools.updateNode.execute(
      { nodeId: "root", title: "Updated launch plan" },
      { toolCallId: "call-1", messages: [], context: {} }
    );
    const assistantMessage: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Updated." },
        {
          type: "tool-updateNode",
          toolCallId: "call-1",
          state: "output-available",
          input: { nodeId: "root", title: "Updated launch plan" },
          output: { operationId: "operation-7" },
        },
      ],
    };

    await mocks.responseOptions?.onFinish?.({
      responseMessage: assistantMessage,
    });

    expect(mocks.fetchMutation.mock.calls[2]?.[1]).toEqual({
      threadId: "thread-1",
      role: "user",
      content: userMessage.parts,
    });
    expect(mocks.fetchMutation.mock.calls[3]?.[1]).toEqual({
      threadId: "thread-1",
      role: "assistant",
      content: assistantMessage.parts,
      operationId: "operation-7",
    });
  });
});
