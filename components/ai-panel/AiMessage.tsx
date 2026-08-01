"use client";

import { ConvexError } from "convex/values";
import { Undo2 } from "lucide-react";
import { useState } from "react";

import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { useEventCallback } from "@/hooks/use-event-callback";
import { cn } from "@/lib/utils";

import {
  describeToolPart,
  getToolParts,
  getUndoOperationId,
  type SprigUIMessage,
} from "./messages";

/** Server rejections a writer can act on, restated in product language. */
const UNDO_ERROR_COPY: Record<string, string> = {
  "Already undone": "This change was already undone.",
  "Not found": "This change is no longer in the map's history.",
  "Undo out of order": "The map moved on. Reload, then undo again.",
};

const UNDO_FALLBACK_ERROR = "Undo failed. Try again.";

type UndoState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "undone" }
  | { status: "error"; message: string };

/** Reads the actionable payload out of a Convex validation failure. */
function getUndoErrorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return UNDO_ERROR_COPY[error.data] ?? UNDO_FALLBACK_ERROR;
  }

  return UNDO_FALLBACK_ERROR;
}

/**
 * One turn in the transcript, plus whatever the model did to the map.
 *
 * The tool strip is mono and muted so it reads as a receipt under the prose
 * rather than as a second voice in the conversation. It stays deliberately
 * uncolored: clay marks the model *acting* (the header's streaming dot, the node
 * card's ring), and a permanent clay rail on every past turn would turn that
 * pulse into wallpaper. Undo is the writer's action, so it is quiet ghost chrome
 * rather than moss — the composer keeps the panel's single moss voice.
 */
function AiMessage({
  message,
  messageNumber,
  onUndo,
}: {
  message: SprigUIMessage;
  messageNumber: number;
  onUndo: (operationId: string, shouldRefresh: boolean) => Promise<void>;
}) {
  const [undoState, setUndoState] = useState<UndoState>({ status: "idle" });
  const toolParts = getToolParts(message);
  const operationId = getUndoOperationId(message);
  const undoDescriptionId = `${message.id}-undo-description`;
  const shouldRefresh = toolParts.some(
    (part) =>
      part.toolName === "renameMindmap" &&
      part.state === "output-available" &&
      part.output?.error === undefined
  );

  const handleUndo = useEventCallback(async () => {
    if (operationId === null) return;

    setUndoState({ status: "pending" });

    try {
      await onUndo(operationId, shouldRefresh);
      setUndoState({ status: "undone" });
    } catch (error) {
      setUndoState({ status: "error", message: getUndoErrorMessage(error) });
    }
  });

  return (
    <Message from={message.role}>
      <MessageContent className="gap-3">
        {message.parts.map((part, index) =>
          part.type === "text" && part.text.length > 0 ? (
            <MessageResponse key={`${message.id}-text-${index}`}>
              {part.text}
            </MessageResponse>
          ) : null
        )}
        {toolParts.length > 0 ? (
          <ul className="flex flex-col gap-1 border-l border-border pl-3">
            {toolParts.map((part, index) => {
              const { label, status } = describeToolPart(part);

              return (
                <li
                  className={cn(
                    "font-mono text-[11px] leading-relaxed",
                    status === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                  key={`${message.id}-tool-${index}`}
                >
                  {status === "running" ? `${label}…` : label}
                </li>
              );
            })}
          </ul>
        ) : null}
      </MessageContent>
      {operationId === null ? null : (
        <div className="flex flex-col items-start gap-1.5">
          {undoState.status === "undone" ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Undone back to this change.
            </p>
          ) : (
            <Button
              aria-describedby={undoDescriptionId}
              aria-label={`Undo to message ${messageNumber}`}
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={undoState.status === "pending"}
              onClick={() => void handleUndo()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Undo2 aria-hidden="true" className="!size-3.5" />
              {undoState.status === "pending" ? "Undoing…" : "Undo to here"}
            </Button>
          )}
          {undoState.status === "error" ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {undoState.message}
            </p>
          ) : null}
          {undoState.status === "idle" || undoState.status === "pending" ? (
            <p
              className="text-[11px] text-muted-foreground"
              id={undoDescriptionId}
            >
              Reverses this change and everything after it.
            </p>
          ) : null}
        </div>
      )}
    </Message>
  );
}

export { AiMessage, getUndoErrorMessage };
