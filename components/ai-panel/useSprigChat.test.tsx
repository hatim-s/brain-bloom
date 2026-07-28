// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "@/convex/_generated/dataModel";

import { useSprigChat } from "./useSprigChat";

const mocks = vi.hoisted(() => ({
  chat: {
    clearError: vi.fn(),
    error: undefined as Error | undefined,
    messages: [] as UIMessage[],
    regenerate: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    setMessages: vi.fn(),
    status: "ready" as const,
    stop: vi.fn(async () => {}),
  },
  finish: null as null | ((event: Record<string, unknown>) => void),
  history: undefined as undefined | Array<Record<string, unknown>>,
  threads: undefined as undefined | Array<Record<string, unknown>>,
  transportOptions: null as null | {
    prepareSendMessagesRequest: (options: Record<string, unknown>) => {
      body: Record<string, unknown>;
    };
  },
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: {
    onFinish: (event: Record<string, unknown>) => void;
  }) => {
    mocks.finish = options.onFinish;
    return mocks.chat;
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    if (typeof args === "object" && args !== null && "mindmapId" in args) {
      return mocks.threads;
    }

    return args === "skip" ? undefined : mocks.history;
  },
}));

vi.mock("ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("ai")>();

  return {
    ...original,
    DefaultChatTransport: class {
      constructor(options: typeof mocks.transportOptions) {
        mocks.transportOptions = options;
      }
    },
  };
});

beforeEach(() => {
  mocks.chat.clearError.mockReset();
  mocks.chat.regenerate.mockReset().mockResolvedValue(undefined);
  mocks.chat.sendMessage.mockReset().mockResolvedValue(undefined);
  mocks.chat.setMessages.mockReset();
  mocks.chat.stop.mockReset().mockResolvedValue(undefined);
  mocks.finish = null;
  mocks.history = undefined;
  mocks.threads = undefined;
  mocks.transportOptions = null;
});

afterEach(cleanup);

describe("useSprigChat", () => {
  it("keeps fresh-thread intent when late history resolves", async () => {
    const { result, rerender } = renderHook(() =>
      useSprigChat({
        mindmapId: "mindmaps:1" as Id<"mindmaps">,
        onTurnFinished: vi.fn(),
      })
    );

    act(() => result.current.startNewConversation());
    mocks.chat.setMessages.mockClear();
    mocks.threads = [
      { _id: "threads:old", mindmapId: "mindmaps:1", title: "Old" },
    ];
    mocks.history = [
      {
        _id: "messages:old",
        role: "assistant",
        content: [{ type: "text", text: "Old reply" }],
      },
    ];
    rerender();

    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false));
    expect(mocks.chat.setMessages).not.toHaveBeenCalled();

    let sendResult!: Promise<boolean>;
    act(() => {
      sendResult = result.current.sendPrompt("Fresh prompt", null);
    });
    expect(mocks.chat.sendMessage).toHaveBeenCalledWith(
      { text: "Fresh prompt" },
      { body: { mindmapId: "mindmaps:1" } }
    );

    act(() => {
      mocks.finish?.({
        message: {
          id: "assistant:new",
          role: "assistant",
          parts: [{ type: "text", text: "Fresh reply" }],
        },
        isAbort: false,
        isError: false,
      });
    });
    await expect(sendResult).resolves.toBe(true);
  });

  it("truncates older messages in the client transport body", () => {
    renderHook(() =>
      useSprigChat({
        mindmapId: "mindmaps:1" as Id<"mindmaps">,
        onTurnFinished: vi.fn(),
      })
    );
    const messages = Array.from({ length: 45 }, (_, index) => ({
      id: `user-${index}`,
      role: "user" as const,
      parts: [{ type: "text" as const, text: String(index) }],
    }));
    const prepared = mocks.transportOptions!.prepareSendMessagesRequest({
      body: { mindmapId: "mindmaps:1" },
      messages,
    });

    expect(prepared.body.messages).toEqual(messages.slice(-40));
  });
});
