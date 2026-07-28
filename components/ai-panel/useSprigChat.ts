"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useEventCallback } from "@/hooks/use-event-callback";

import { THREAD_ID_HEADER } from "./constants";
import {
  type SprigUIMessage,
  type ThreadMessageRecord,
  toUIMessages,
} from "./messages";

type UseSprigChatOptions = {
  mindmapId: Id<"mindmaps">;
  /** Called once per assistant turn that completed without abort or error. */
  onTurnFinished: (message: SprigUIMessage) => void;
};

/** The fields of a persisted thread the switcher needs to list it. */
type SprigThreadSummary = {
  _id: Id<"threads">;
  _creationTime: number;
  title: string;
};

type UseSprigChat = {
  messages: SprigUIMessage[];
  status: ReturnType<typeof useChat<SprigUIMessage>>["status"];
  error: Error | undefined;
  isStreaming: boolean;
  isHistoryLoading: boolean;
  /** Every thread on this map, newest first; `undefined` until Convex answers. */
  threads: SprigThreadSummary[] | undefined;
  /** The thread the panel is addressing, or `null` for an unsent fresh one. */
  activeThreadId: Id<"threads"> | null;
  clearError: () => void;
  regenerate: () => Promise<boolean>;
  /** Returns `false` when the switch was refused (mid-stream, or a no-op). */
  selectThread: (threadId: Id<"threads">) => boolean;
  sendPrompt: (text: string, selectedNodeId: string | null) => Promise<boolean>;
  startNewConversation: () => void;
  stop: () => void;
};

/**
 * Owns the chat transport, the persisted thread, and history replay.
 *
 * The AI SDK's transport is constructed once and reads the thread id from the
 * response header the route sets, so the second turn of a conversation lands
 * in the same Convex thread as the first without a round trip to find it.
 */
function useSprigChat({
  mindmapId,
  onTurnFinished,
}: UseSprigChatOptions): UseSprigChat {
  // Written from inside `fetch`, read when composing the next request body.
  const threadIdRef = useRef<string | null>(null);
  const hasReplayedHistoryRef = useRef(false);
  const freshThreadIntentRef = useRef(false);
  const isActiveStreamRef = useRef(false);
  const pendingResultRef = useRef<((succeeded: boolean) => void) | null>(null);
  const lastRequestBodyRef = useRef<Record<string, string>>({ mindmapId });

  // `undefined` means "not resolved yet"; `null` means "no thread is addressed".
  // Declared above the transport because the fetch seam below adopts the id the
  // route minted for a brand-new conversation.
  const [historyThreadId, setHistoryThreadId] = useState<
    Id<"threads"> | null | undefined
  >(undefined);

  const [transport] = useState(
    () =>
      new DefaultChatTransport<SprigUIMessage>({
        api: "/api/chat",
        /**
         * The thread id is only available as a response header, which the SDK
         * does not surface, so the transport's fetch seam captures it.
         */
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init);
          const threadId = response.headers.get(THREAD_ID_HEADER);

          if (threadId !== null && threadId.length > 0) {
            threadIdRef.current = threadId;
            freshThreadIntentRef.current = false;
            // A fresh conversation only learns its thread id here, so adopt it
            // as the active one — without ever overwriting a thread the reader
            // has explicitly opened.
            setHistoryThreadId(
              (current) => current ?? (threadId as Id<"threads">)
            );
          }

          return response;
        },
        // Keep recent context while enforcing the route's 40-message ceiling.
        prepareSendMessagesRequest: ({ body, messages }) => ({
          body: {
            ...body,
            messages: messages.slice(-40),
          },
        }),
      })
  );

  const handleFinish = useEventCallback(
    ({
      message,
      isAbort,
      isError,
    }: {
      message: SprigUIMessage;
      isAbort: boolean;
      isError: boolean;
    }) => {
      isActiveStreamRef.current = false;
      pendingResultRef.current?.(!isAbort && !isError);
      pendingResultRef.current = null;

      if (isAbort || isError) {
        return;
      }

      onTurnFinished(message);
    }
  );

  const chat = useChat<SprigUIMessage>({
    id: mindmapId,
    transport,
    onFinish: handleFinish,
  });
  const { setMessages } = chat;

  const threads = useQuery(api.threads.listThreads, { mindmapId });
  const historyMessages = useQuery(
    api.threads.listMessages,
    historyThreadId ? { threadId: historyThreadId } : "skip"
  );

  // Threads are listed oldest-first, so the most recent conversation is last.
  useEffect(() => {
    if (
      historyThreadId !== undefined ||
      threads === undefined ||
      freshThreadIntentRef.current ||
      isActiveStreamRef.current
    ) {
      return;
    }

    const latestThread = threads.at(-1) ?? null;

    if (latestThread === null) {
      hasReplayedHistoryRef.current = true;
      setHistoryThreadId(null);
      return;
    }

    threadIdRef.current = latestThread._id;
    setHistoryThreadId(latestThread._id);
  }, [historyThreadId, threads]);

  // `listMessages` is a live query and keeps pushing as the route persists the
  // turn, so replay is allowed exactly once per conversation.
  useEffect(() => {
    if (
      hasReplayedHistoryRef.current ||
      historyMessages === undefined ||
      freshThreadIntentRef.current ||
      isActiveStreamRef.current
    ) {
      return;
    }

    hasReplayedHistoryRef.current = true;
    setMessages(toUIMessages(historyMessages as ThreadMessageRecord[]));
  }, [historyMessages, setMessages]);

  const isHistoryLoading =
    !hasReplayedHistoryRef.current &&
    (historyThreadId === undefined || historyMessages === undefined);

  // Convex lists threads oldest-first; the switcher reads most-recent-first.
  const orderedThreads = useMemo(
    () =>
      threads === undefined
        ? undefined
        : [...(threads as SprigThreadSummary[])].reverse(),
    [threads]
  );

  const sendPrompt = useEventCallback(
    async (text: string, selectedNodeId: string | null) => {
      if (isHistoryLoading || isActiveStreamRef.current) {
        return false;
      }

      const body = {
        mindmapId,
        ...(threadIdRef.current === null
          ? {}
          : { threadId: threadIdRef.current }),
        ...(selectedNodeId === null ? {} : { selectedNodeId }),
      };
      lastRequestBodyRef.current = body;
      isActiveStreamRef.current = true;

      const result = new Promise<boolean>((resolve) => {
        pendingResultRef.current = resolve;
      });

      try {
        void chat.sendMessage({ text }, { body }).catch(() => {
          isActiveStreamRef.current = false;
          pendingResultRef.current?.(false);
          pendingResultRef.current = null;
        });
      } catch {
        isActiveStreamRef.current = false;
        pendingResultRef.current?.(false);
        pendingResultRef.current = null;
      }

      return result;
    }
  );

  const regenerate = useEventCallback(async () => {
    if (isHistoryLoading || isActiveStreamRef.current) {
      return false;
    }

    isActiveStreamRef.current = true;
    const result = new Promise<boolean>((resolve) => {
      pendingResultRef.current = resolve;
    });

    try {
      void chat
        .regenerate({
          body: {
            ...lastRequestBodyRef.current,
            ...(threadIdRef.current === null
              ? {}
              : { threadId: threadIdRef.current }),
          },
        })
        .catch(() => {
          isActiveStreamRef.current = false;
          pendingResultRef.current?.(false);
          pendingResultRef.current = null;
        });
    } catch {
      isActiveStreamRef.current = false;
      pendingResultRef.current?.(false);
      pendingResultRef.current = null;
    }

    return result;
  });

  /**
   * Points the panel at another persisted thread and replays it.
   *
   * Switching mid-stream is refused rather than queued: the in-flight turn is
   * still addressed to the previous thread and would land in the wrong
   * conversation, so the caller is told the switch did not happen.
   */
  const selectThread = useEventCallback((threadId: Id<"threads">) => {
    if (isActiveStreamRef.current || threadId === historyThreadId) {
      return false;
    }

    // Replay is allowed once per conversation, so re-arming it is what makes
    // the next `listMessages` result land in the transcript.
    hasReplayedHistoryRef.current = false;
    freshThreadIntentRef.current = false;
    threadIdRef.current = threadId;
    lastRequestBodyRef.current = { mindmapId };
    chat.clearError();
    setMessages([]);
    setHistoryThreadId(threadId);

    return true;
  });

  const startNewConversation = useEventCallback(() => {
    // Nothing is deleted: the previous thread stays in Convex, this panel just
    // stops addressing it. P9 owns the thread switcher that can return to it.
    hasReplayedHistoryRef.current = true;
    freshThreadIntentRef.current = true;
    threadIdRef.current = null;
    setHistoryThreadId(null);
    chat.clearError();
    setMessages([]);
  });

  const stopChat = chat.stop;
  const stop = useCallback(() => {
    void stopChat();
  }, [stopChat]);

  const isStreaming =
    chat.status === "submitted" || chat.status === "streaming";

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    isStreaming,
    isHistoryLoading,
    threads: orderedThreads,
    activeThreadId: historyThreadId ?? null,
    clearError: chat.clearError,
    regenerate,
    selectThread,
    sendPrompt,
    startNewConversation,
    stop,
  };
}

export { type SprigThreadSummary, type UseSprigChat, useSprigChat };
