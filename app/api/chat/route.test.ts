import type { UIMessage } from "ai";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClaudeChatStream: vi.fn(),
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
  getConvexAuthToken: vi.fn(),
  streamOptions: undefined as
    | {
        instructions: string;
        messages: UIMessage[];
        tools: Record<
          string,
          {
            execute: (
              input: unknown,
              options: {
                toolCallId: string;
                messages: never[];
                context: object;
              }
            ) => Promise<unknown>;
          }
        >;
        onFinish?: (event: {
          responseMessage: UIMessage;
          isAborted: boolean;
        }) => PromiseLike<void> | void;
      }
    | undefined,
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("convex/nextjs", () => ({
  fetchMutation: mocks.fetchMutation,
  fetchQuery: mocks.fetchQuery,
}));
vi.mock("@/lib/convex-server", () => ({
  getConvexAuthToken: mocks.getConvexAuthToken,
}));
vi.mock("@/lib/claude-agent", () => ({
  isClaudeConfigured: () => Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
}));
vi.mock("@/lib/ai/claudeChat", () => {
  return {
    createClaudeChatStream: mocks.createClaudeChatStream,
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
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-token";
    mocks.auth.mockResolvedValue({
      userId: "user-1",
      getToken: vi.fn(async () => "convex-token"),
    });
    mocks.getConvexAuthToken.mockResolvedValue("convex-token");
    mocks.fetchQuery.mockResolvedValue(createMindmapResult());
    mocks.streamOptions = undefined;
    mocks.createClaudeChatStream.mockImplementation((options) => {
      mocks.streamOptions = options;
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  it("returns 401 JSON before reading configuration for an unauthenticated user", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

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
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

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
    expect(mocks.createClaudeChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("[nodeId:root]"),
        messages: [userMessage],
        tools: expect.any(Object),
      })
    );
  });

  it("returns a 404 JSON response when the mindmap query is not found", async () => {
    mocks.fetchQuery.mockRejectedValueOnce(new ConvexError("Not found"));

    const response = await POST(
      createRequest({ mindmapId: "map-1", messages: [userMessage] })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(mocks.createClaudeChatStream).not.toHaveBeenCalled();
  });

  it("returns a 403 JSON response when Convex rejects access", async () => {
    mocks.fetchQuery.mockRejectedValueOnce(new ConvexError("Forbidden"));

    const response = await POST(
      createRequest({ mindmapId: "map-1", messages: [userMessage] })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.createClaudeChatStream).not.toHaveBeenCalled();
  });

  it("persists full UI parts and links the earliest applied operation", async () => {
    mocks.fetchMutation
      .mockResolvedValueOnce("thread-1")
      .mockResolvedValueOnce({ operationId: "operation-7", seq: 7 })
      .mockResolvedValueOnce({ operationId: "operation-8", seq: 8 })
      .mockResolvedValueOnce("user-message-1")
      .mockResolvedValueOnce("assistant-message-1");

    await POST(createRequest({ mindmapId: "map-1", messages: [userMessage] }));

    const streamOptions = mocks.streamOptions;
    if (streamOptions === undefined) {
      throw new Error("Expected AI chat stream options");
    }

    await streamOptions.tools.updateNode.execute(
      { nodeId: "root", title: "Updated launch plan" },
      { toolCallId: "call-1", messages: [], context: {} }
    );
    await streamOptions.tools.renameMindmap.execute(
      { name: "Updated launch plan" },
      { toolCallId: "call-2", messages: [], context: {} }
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

    await mocks.streamOptions?.onFinish?.({
      responseMessage: assistantMessage,
      isAborted: false,
    });

    expect(mocks.fetchMutation.mock.calls[3]?.[1]).toEqual({
      threadId: "thread-1",
      messageId: "user-1",
      role: "user",
      content: userMessage.parts,
    });
    expect(mocks.fetchMutation.mock.calls[4]?.[1]).toEqual({
      threadId: "thread-1",
      messageId: "assistant-1",
      role: "assistant",
      content: assistantMessage.parts,
      operationId: "operation-7",
    });
  });

  it("skips both persistence writes when the response is aborted", async () => {
    mocks.fetchMutation.mockResolvedValueOnce("thread-1");
    await POST(createRequest({ mindmapId: "map-1", messages: [userMessage] }));

    await mocks.streamOptions?.onFinish?.({
      responseMessage: {
        id: "assistant-partial",
        role: "assistant",
        parts: [{ type: "text", text: "Partial" }],
      },
      isAborted: true,
    });

    expect(mocks.fetchMutation).toHaveBeenCalledOnce();
  });

  it("rejects a thread bound to another mindmap before model execution", async () => {
    mocks.fetchQuery
      .mockResolvedValueOnce(createMindmapResult())
      .mockResolvedValueOnce({ _id: "thread-1", mindmapId: "map-2" });

    const response = await POST(
      createRequest({
        mindmapId: "map-1",
        threadId: "thread-1",
        messages: [userMessage],
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "thread belongs to a different mindmap",
    });
    expect(mocks.createClaudeChatStream).not.toHaveBeenCalled();
  });

  it("rejects requests over the JSON byte ceiling", async () => {
    const response = await POST(
      createRequest({
        mindmapId: "map-1",
        messages: [
          {
            ...userMessage,
            parts: [{ type: "text", text: "x".repeat(270_000) }],
          },
        ],
      })
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request too large",
    });
    expect(mocks.createClaudeChatStream).not.toHaveBeenCalled();
  });

  it("rejects more than 40 messages and oversized text parts", async () => {
    const tooMany = await POST(
      createRequest({
        mindmapId: "map-1",
        messages: Array.from({ length: 41 }, (_, index) => ({
          ...userMessage,
          id: `user-${index}`,
        })),
      })
    );
    const longPart = await POST(
      createRequest({
        mindmapId: "map-1",
        messages: [
          {
            ...userMessage,
            parts: [{ type: "text", text: "x".repeat(16_001) }],
          },
        ],
      })
    );

    expect(tooMany.status).toBe(400);
    expect(longPart.status).toBe(400);
    expect(mocks.createClaudeChatStream).not.toHaveBeenCalled();
  });
});
