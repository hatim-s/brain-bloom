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
  isStreaming: boolean;
  onStop: () => void;
  onSubmit: (text: string) => void;
};

/**
 * The panel's composer.
 *
 * Enter sends and Shift+Enter breaks the line, which is the convention every
 * chat surface has trained writers on. The submit control becomes a stop
 * control while a turn is in flight rather than appearing next to it, so the
 * one primary action in the composer is always the one that applies.
 */
function AiChatInput({ isStreaming, onStop, onSubmit }: AiChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the prompt up to a cap. Height is reset first so the element can
  // shrink again when the writer deletes a line.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [value]);

  const handleSubmit = useEventCallback(() => {
    const prompt = value.trim();

    if (prompt.length === 0 || isStreaming) {
      return;
    }

    setValue("");
    onSubmit(prompt);
  });

  const handleKeyDown = useEventCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // The canvas listens for bare arrow and space keys; a focused composer
      // must own every keystroke it receives.
      event.stopPropagation();

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
        disabled={isStreaming}
        id="sprig-chat-input"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask Sprig to grow, prune, or rearrange the map"
        ref={textareaRef}
        rows={2}
        value={value}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] leading-none text-muted-foreground">
          Enter sends · Shift+Enter for a new line
        </p>
        {isStreaming ? (
          <Button
            aria-label="Stop generating"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={onStop}
            size="sm"
            type="button"
            variant="outline"
          >
            <Square className="!size-3" />
            Stop
          </Button>
        ) : (
          <Button
            aria-label="Send message"
            className="h-8 gap-1.5 px-3 text-xs"
            disabled={value.trim().length === 0}
            size="sm"
            type="submit"
          >
            Send
            <ArrowUp className="!size-3.5" />
          </Button>
        )}
      </div>
    </form>
  );
}

export { AiChatInput };
