"use client";

import { useMutation } from "convex/react";
import { PanelRightClose, RotateCw, Sprout } from "lucide-react";
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

import { useMindmapFlow } from "../flow/providers/MindmapFlowProvider";
import { AiChatInput } from "./AiChatInput";
import { AiMessage } from "./AiMessage";
import {
  collectTouchedNodeIds,
  getToolParts,
  getUndoOperationId,
} from "./messages";
import { SelectedNodeChip } from "./SelectedNodeChip";
import { useSprigChat } from "./useSprigChat";

/**
 * The Sprig conversation surface.
 *
 * A quiet card that sits beside the canvas rather than over it: one hairline
 * on the left, mono for anything the machine says about itself, and the bloom
 * accent reserved for the single moment the model is actually working.
 */
function AiPanel({
  onCollapse,
  onReload = () => window.location.reload(),
}: {
  onCollapse: () => void;
  onReload?: () => void;
}) {
  const router = useRouter();
  const mindmapId = useMindmapFlow((state) => state.mindmapDB._id);
  const activeNode = useMindmapFlow((state) => state.activeNode);
  const mindmapNodesMap = useMindmapFlow((state) => state.mindmapNodesMap);
  const setAiTouchedNodeIds = useMindmapFlow(
    (state) => state.setAiTouchedNodeIds
  );
  const pendingOpsLength = useMindmapFlow((state) => state.pendingOps.length);
  const syncState = useMindmapFlow((state) => state.syncState);
  const flushNow = useMindmapFlow((state) => state.actions.flushNow);
  const undoTo = useMutation(api.ops.undoTo);

  // The canvas store is seeded from server props at mount and has no live
  // subscription, so a server-side edit is announced rather than applied.
  const [isCanvasStale, setIsCanvasStale] = useState(false);
  const [dismissedNodeId, setDismissedNodeId] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const wasStreamingRef = useRef(false);

  const ensureCanvasEditsSaved = useEventCallback(async () => {
    if (pendingOpsLength === 0 && syncState === "idle") {
      setReloadError(null);
      return true;
    }

    const saved = await flushNow();
    if (saved) {
      setReloadError(null);
      return true;
    }

    const message =
      "Couldn't save your latest canvas edits — resolve saving before reloading.";
    setReloadError(message);
    setAnnouncement(message);
    return false;
  });

  const handleTurnFinished = useEventCallback(
    async (message: Parameters<typeof collectTouchedNodeIds>[0]) => {
      const touchedNodeIds = collectTouchedNodeIds(message);

      if (touchedNodeIds.length > 0) {
        setAiTouchedNodeIds(touchedNodeIds);
      }

      if (getUndoOperationId(message) !== null) {
        setIsCanvasStale(true);
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
      setAnnouncement("Sprig could not finish that. Try again.");
    }
  }, [chat.error]);

  const handleUndo = useCallback(
    async (operationId: string, shouldRefresh: boolean) => {
      if (!(await ensureCanvasEditsSaved())) {
        throw new Error("Unsaved canvas edits");
      }

      await undoTo({ operationId: operationId as Id<"operations"> });
      setIsCanvasStale(true);
      setAnnouncement("Change undone");

      if (shouldRefresh && (await ensureCanvasEditsSaved())) {
        router.refresh();
      }
    },
    [ensureCanvasEditsSaved, router, undoTo]
  );

  const handleSubmit = useEventCallback((text: string) =>
    chat.sendPrompt(text, selectedNodeId)
  );

  const handleReload = useEventCallback(async () => {
    if (await ensureCanvasEditsSaved()) {
      onReload();
    }
  });

  return (
    <section
      aria-label="Sprig assistant"
      className="flex h-full min-h-0 w-full flex-col bg-card"
    >
      <div aria-live="polite" className="sr-only" role="status">
        {announcement}
      </div>
      {/* The floating header and theme switcher already own the top band of the
          viewport, so the panel starts its own chrome below them. */}
      <div className="flex items-center gap-2 border-b border-border px-3 pb-2.5 pt-16">
        <span className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">
          Sprig
        </span>
        {chat.isStreaming ? (
          <span aria-hidden="true" className="sprig-bloom-dot" />
        ) : null}
        <Button
          className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
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
              icon={<Sprout aria-hidden="true" className="size-5" />}
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
        {chat.error === undefined ? null : (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive px-2.5 py-2 text-sm font-medium text-destructive"
            role="alert"
          >
            <span className="flex-1">
              Sprig could not finish that. Try sending it again.
            </span>
            <button
              className="font-medium underline underline-offset-2"
              onClick={() => void chat.regenerate()}
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
        {reloadError ? (
          <div
            className="rounded-md border border-destructive px-2.5 py-2 text-sm font-medium text-destructive"
            role="alert"
          >
            {reloadError}
          </div>
        ) : null}
        {isCanvasStale ? (
          <div className="flex items-start gap-2 rounded-md border border-line-strong bg-secondary px-2.5 py-2 text-xs text-muted-foreground">
            <span className="flex-1">
              The map changed on the server. Reload to see it on the canvas.
            </span>
            <Button
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => void handleReload()}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCw aria-hidden="true" className="!size-3" />
              Reload
            </Button>
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

export { AiPanel };
