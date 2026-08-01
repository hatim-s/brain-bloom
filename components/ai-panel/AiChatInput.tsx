"use client";

import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEventCallback } from "@/hooks/use-event-callback";
import { cn } from "@/lib/utils";

/** Beyond this the composer would start eating the transcript. */
const MAX_INPUT_HEIGHT_PX = 160;

type AiChatInputProps = {
  isSendDisabled: boolean;
  isStreaming: boolean;
  onStop: () => void;
  onSubmit: (text: string) => Promise<boolean>;
};

/**
 * The panel's composer.
 *
 * Enter sends and Shift+Enter breaks the line, which is the convention every
 * chat surface has trained writers on. The submit control becomes a stop
 * control while a turn is in flight rather than appearing next to it, so the
 * one primary action in the composer is always the one that applies.
 *
 * This is where the panel spends its moss: Send is the default (moss-filled)
 * button, the single voice of action in the surface. Stop drops to outline —
 * interrupting the model is a correction, not the promoted next step — and no
 * clay appears here, because nothing in the composer is the model acting.
 */
function AiChatInput({
  isSendDisabled,
  isStreaming,
  onStop,
  onSubmit,
}: AiChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wasStreamingRef = useRef(isStreaming);

  // Grow with the prompt up to a cap. Height is reset first so the element can
  // shrink again when the writer deletes a line.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [value]);

  // Preserve keyboard position across the read-only streaming interval.
  useEffect(() => {
    if (
      wasStreamingRef.current &&
      !isStreaming &&
      document.activeElement === document.body
    ) {
      textareaRef.current?.focus();
    }

    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const handleSubmit = useEventCallback(async () => {
    const prompt = value.trim();

    if (prompt.length === 0 || isStreaming || isSendDisabled) {
      return;
    }

    setValue("");
    const succeeded = await onSubmit(prompt);

    if (!succeeded) {
      // Do not overwrite anything the writer typed after the failed request.
      setValue((current) => current || prompt);
    }
  });

  const handleKeyDown = useEventCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        textareaRef.current?.blur();
        return;
      }

      // IMEs emit Enter-like keydowns while committing a composition. Never
      // treat those intermediate values as a completed chat message.
      if (event.nativeEvent.isComposing || event.key === "Process") {
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    }
  );

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
      <label className="sr-only" htmlFor="sprig-chat-input">
        Message Sprig
      </label>
      <Textarea
        className={cn(
          "min-h-[2.75rem] resize-none overflow-y-auto rounded-md bg-background text-sm",
          "border-line-strong px-3 py-2.5"
        )}
        id="sprig-chat-input"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask Sprig to grow, prune, or rearrange the map"
        readOnly={isStreaming}
        ref={textareaRef}
        rows={2}
        value={value}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-none text-muted-foreground">
          Enter sends · Shift+Enter for a new line
        </p>
        <Button
          aria-label={isStreaming ? "Stop generating" : "Send message"}
          className="h-8 gap-1.5 px-3 text-xs"
          disabled={
            !isStreaming && (isSendDisabled || value.trim().length === 0)
          }
          onClick={isStreaming ? onStop : undefined}
          size="sm"
          type={isStreaming ? "button" : "submit"}
          variant={isStreaming ? "outline" : "default"}
        >
          {isStreaming ? (
            <>
              <Square className="!size-3" />
              Stop
            </>
          ) : (
            <>
              Send
              <ArrowUp className="!size-3.5" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

export { AiChatInput };
