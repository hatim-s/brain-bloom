"use client";

import { useMutation } from "convex/react";
import { PanelRightClose, Sprout } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useEventCallback } from "@/hooks/use-event-callback";

import {
  useMindmapFlow,
  useMindmapStoreApi,
} from "../flow/providers/MindmapFlowProvider";
import { AiChatInput } from "./AiChatInput";
import { AiMessage } from "./AiMessage";
import { collectTouchedNodeIds, getToolParts } from "./messages";
import { SelectedNodeChip } from "./SelectedNodeChip";
import { ThreadSwitcher } from "./ThreadSwitcher";
import { type SprigThreadSummary, useSprigChat } from "./useSprigChat";

const AI_NOT_CONFIGURED_MESSAGE = "AI is not configured";

/**
 * Detects the route's known 503 body in the error text exposed by the AI SDK.
 */
function isAIConfigurationError(error: Error | undefined): boolean {
  return error?.message.includes(AI_NOT_CONFIGURED_MESSAGE) ?? false;
}

/**
 * The Sprig conversation surface.
 *
 * A quiet card that sits beside the canvas rather than over it: one hairline
 * on the left, mono for anything the machine says about itself, and clay
 * (`--glow`) reserved for the moments the model is present — the streaming dot
 * and Sprig's own empty-state mark. Everything the writer does is moss.
 */
function AiPanel({ onCollapse }: { onCollapse: () => void }) {
  const router = useRouter();
  const store = useMindmapStoreApi();
  const mindmapId = useMindmapFlow((state) => state.mindmapDB._id);
  const activeNode = useMindmapFlow((state) => state.activeNode);
  const mindmapNodesMap = useMindmapFlow((state) => state.mindmapNodesMap);
  const pendingOpsLength = useMindmapFlow((state) => state.pendingOps.length);
  const syncState = useMindmapFlow((state) => state.syncState);
  const flushNow = useMindmapFlow((state) => state.actions.flushNow);
  const aiPromptRequest = useMindmapFlow((state) => state.aiPromptRequest);
  const clearAiPromptRequest = useMindmapFlow(
    (state) => state.actions.clearAiPromptRequest
  );
  const setAiStreaming = useMindmapFlow(
    (state) => state.actions.setAiStreaming
  );
  const undoTo = useMutation(api.ops.undoTo);

  const [dismissedNodeId, setDismissedNodeId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const wasStreamingRef = useRef(false);
  const aiTurnSeededUpdatedAtRef = useRef(store.getState().seededUpdatedAt);

  const ensureCanvasEditsSaved = useEventCallback(async () => {
    if (pendingOpsLength === 0 && syncState === "idle") {
      setRefreshError(null);
      return true;
    }

    const saved = await flushNow();
    if (saved) {
      setRefreshError(null);
      return true;
    }

    const message =
      "Couldn't save your latest canvas edits — resolve saving before refreshing.";
    setRefreshError(message);
    setAnnouncement(message);
    return false;
  });

  const handleTurnFinished = useEventCallback(
    async (message: Parameters<typeof collectTouchedNodeIds>[0]) => {
      const touchedNodeIds = collectTouchedNodeIds(message);

      if (touchedNodeIds.length > 0) {
        store
          .getState()
          .actions.setAiTouchedNodeIdsAfterReseed(
            touchedNodeIds,
            aiTurnSeededUpdatedAtRef.current
          );
      }

      const renamedMindmap = getToolParts(message).some(
        (part) =>
          part.toolName === "renameMindmap" &&
          part.state === "output-available" &&
          part.output?.error === undefined
      );

      // Node content lives in the client canvas; only the name needs new RSC.
      if (renamedMindmap && (await ensureCanvasEditsSaved())) {
        router.refresh();
      }
    }
  );

  const chat = useSprigChat({ mindmapId, onTurnFinished: handleTurnFinished });
  const hasAIConfigurationError = isAIConfigurationError(chat.error);

  // Mirror the transport's streaming state into the store so canvas surfaces
  // (the inline node prompt, the collapsed panel tab) can read it without
  // owning a chat hook of their own.
  useEffect(() => {
    setAiStreaming(chat.isStreaming);
    return () => setAiStreaming(false);
  }, [chat.isStreaming, setAiStreaming]);

  // Consume the instruction the inline node prompt queued. It waits while a
  // turn is already in flight (the prompt disables its submit for the same
  // reason, so a queued request is a rare race, not a surprise send).
  useEffect(() => {
    if (aiPromptRequest === null || chat.isStreaming || chat.isHistoryLoading) {
      return;
    }

    const { nodeId, prompt } = aiPromptRequest;

    clearAiPromptRequest();
    aiTurnSeededUpdatedAtRef.current = store.getState().seededUpdatedAt;
    void chat.sendPrompt(prompt, nodeId);
  }, [aiPromptRequest, chat, clearAiPromptRequest, store]);

  const activeNodeTitle =
    activeNode === null
      ? null
      : (mindmapNodesMap[activeNode]?.data.title ?? null);
  const isChipVisible =
    activeNode !== null &&
    activeNodeTitle !== null &&
    dismissedNodeId !== activeNode;
  const selectedNodeId = isChipVisible ? activeNode : null;

  useEffect(() => {
    setDismissedNodeId(null);
  }, [activeNode]);

  useEffect(() => {
    if (chat.isStreaming) {
      setAnnouncement("Sprig is thinking");
    } else if (wasStreamingRef.current && chat.status === "ready") {
      setAnnouncement("Sprig replied");
    }

    wasStreamingRef.current = chat.isStreaming;
  }, [chat.isStreaming, chat.status]);

  useEffect(() => {
    if (chat.error !== undefined) {
      setAnnouncement(
        isAIConfigurationError(chat.error)
          ? "AI is not configured"
          : "Sprig could not finish that. Try again."
      );
    }
  }, [chat.error]);

  const handleUndo = useCallback(
    async (operationId: string, shouldRefresh: boolean) => {
      if (!(await ensureCanvasEditsSaved())) {
        throw new Error("Unsaved canvas edits");
      }

      await undoTo({ operationId: operationId as Id<"operations"> });
      setAnnouncement("Change undone");

      if (shouldRefresh && (await ensureCanvasEditsSaved())) {
        router.refresh();
      }
    },
    [ensureCanvasEditsSaved, router, undoTo]
  );

  const handleSubmit = useEventCallback((text: string) => {
    aiTurnSeededUpdatedAtRef.current = store.getState().seededUpdatedAt;
    return chat.sendPrompt(text, selectedNodeId);
  });

  const handleRegenerate = useEventCallback(() => {
    aiTurnSeededUpdatedAtRef.current = store.getState().seededUpdatedAt;
    return chat.regenerate();
  });

  const handleSelectThread = useEventCallback((thread: SprigThreadSummary) => {
    // The transcript is replaced without moving focus, so the switch has to be
    // announced or a screen reader user gets no confirmation it happened.
    if (chat.selectThread(thread._id)) {
      setAnnouncement(`Opened conversation: ${thread.title}`);
    }
  });

  return (
    <section
      aria-label="Sprig assistant"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-floating"
    >
      <div aria-live="polite" className="sr-only" role="status">
        {announcement}
      </div>
      {/* Header chrome stays neutral on hover on purpose: clay already lives in
          this band while a turn streams, and moss hovers beside it would put two
          accents in one 40px row (the One Voice Rule). Moss speaks in the
          composer's send button, where the writer's action actually is. */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="text-[13px] font-medium text-foreground">Sprig</span>
        {/* The one clay moment in the header: the model is working right now.
            It settles away the instant the turn ends — never a standing badge. */}
        {chat.isStreaming ? (
          <span aria-hidden="true" className="sprig-glow-dot" />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <ThreadSwitcher
            activeThreadId={chat.activeThreadId}
            isStreaming={chat.isStreaming}
            onSelect={handleSelectThread}
            threads={chat.threads}
          />
          <Button
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={chat.isStreaming || chat.messages.length === 0}
            onClick={chat.startNewConversation}
            size="sm"
            type="button"
            variant="ghost"
          >
            New conversation
          </Button>
          <Button
            aria-label="Collapse Sprig panel"
            className="size-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={onCollapse}
            size="icon"
            type="button"
            variant="ghost"
          >
            <PanelRightClose aria-hidden="true" className="!size-4" />
          </Button>
        </div>
      </div>

      <Conversation className="min-h-0 flex-1" aria-label="Conversation">
        <ConversationContent className="gap-6 px-3 py-4">
          {chat.isHistoryLoading ? (
            <div aria-label="Loading conversation">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-4 w-1/2" />
            </div>
          ) : chat.messages.length === 0 ? (
            <ConversationEmptyState
              description="Ask for a branch, a rewrite, or a reshuffle. Every change is saved to the map and can be undone from here."
              // Sprig introducing itself is an AI-presence moment, so the sprout
              // wears clay. It is gone the moment a conversation exists.
              icon={<Sprout aria-hidden="true" className="size-5 text-glow" />}
              title="Nothing here yet"
            />
          ) : (
            chat.messages.map((message, index) => (
              <AiMessage
                key={message.id}
                message={message}
                messageNumber={index + 1}
                onUndo={handleUndo}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="Scroll to latest message" />
      </Conversation>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        {chat.error === undefined ? null : hasAIConfigurationError ? (
          <div
            className="rounded-md border border-line-strong bg-secondary px-2.5 py-2 text-sm text-muted-foreground"
            role="status"
          >
            <p className="font-medium text-foreground">AI is not configured</p>
            <p className="mt-1 text-xs leading-relaxed">
              Configure the provider selected by <code>SPRIG_AI_PROVIDER</code>{" "}
              as described in <code>docs/ENV.md</code>, then reload.
            </p>
          </div>
        ) : (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive px-2.5 py-2 text-sm font-medium text-destructive"
            role="alert"
          >
            <span className="flex-1">
              Sprig could not finish that. Try sending it again.
            </span>
            <button
              className="font-medium underline underline-offset-2"
              onClick={() => void handleRegenerate()}
              type="button"
            >
              Try again
            </button>
            <button
              className="font-medium underline underline-offset-2"
              onClick={chat.clearError}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}
        {refreshError ? (
          <div
            className="rounded-md border border-destructive px-2.5 py-2 text-sm font-medium text-destructive"
            role="alert"
          >
            {refreshError}
          </div>
        ) : null}
        {isChipVisible ? (
          <SelectedNodeChip
            onDismiss={() => setDismissedNodeId(activeNode)}
            title={activeNodeTitle}
          />
        ) : null}
        <AiChatInput
          isSendDisabled={chat.isHistoryLoading}
          isStreaming={chat.isStreaming}
          onStop={chat.stop}
          onSubmit={handleSubmit}
        />
      </div>
    </section>
  );
}

export { AiPanel, isAIConfigurationError };
