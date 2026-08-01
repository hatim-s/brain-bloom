"use client";

import { ArrowUp } from "lucide-react";
import { useRef, useState } from "react";

import {
  AutosizeTextarea,
  AutosizeTextAreaRef,
} from "@/components/auto-resizer-textarea";
import { Button } from "@/components/ui/button";
import { useEventCallback } from "@/hooks/use-event-callback";

import { useMindmapFlow } from "../../providers/MindmapFlowProvider";
import type { AiEditAction } from "../../providers/types";

/** How each intent introduces itself above the field. */
const ACTION_TITLES: Record<AiEditAction, string> = {
  grow: "Grow this branch",
  refine: "Refine this node",
  explain: "Explain this node",
};

/** What the field suggests when the writer has nothing specific in mind. */
const ACTION_PLACEHOLDERS: Record<AiEditAction, string> = {
  grow: "What should grow here? Enter sends the default.",
  refine: "What should change? Enter sends the default.",
  explain: "What do you want to know? Enter asks for an explanation.",
};

/**
 * The instruction each intent falls back to when submitted empty.
 *
 * These are complete requests on their own so a bare Enter is a first-class
 * gesture, not an error.
 */
const ACTION_DEFAULT_PROMPTS: Record<AiEditAction, string> = {
  grow: "Grow this branch with the most useful next ideas.",
  refine:
    "Refine this node's title and description so they are clearer and more precise.",
  explain: "Explain this node and how it fits into the map.",
};

/**
 * The compact prompt a toolbar action opens on the node itself.
 *
 * This is a moment where the model is present, so the surface wears clay: the
 * intent line and the field's boundary carry the AI accent while Send stays
 * moss, because sending is still the reader's own action.
 *
 * It does not own a transport: submitting queues the instruction on the store,
 * and the Sprig panel — which holds the chat hook, the thread id, and the undo
 * receipts — picks it up and sends it through `/api/chat` scoped to this node.
 * The popover closes immediately; the clay bloom on the touched nodes and the
 * transcript in the panel are the response.
 */
function NodeAiPrompt() {
  const aiEditNode = useMindmapFlow((state) => state.aiEditNode);
  const aiEditAction = useMindmapFlow((state) => state.aiEditAction);
  const aiStreaming = useMindmapFlow((state) => state.aiStreaming);
  const nodesMap = useMindmapFlow((state) => state.nodesMap);
  const setAiEditNode = useMindmapFlow((state) => state.setAiEditNode);
  const requestAiPrompt = useMindmapFlow(
    (state) => state.actions.requestAiPrompt
  );

  const [value, setValue] = useState("");
  const textareaRef = useRef<AutosizeTextAreaRef>(null);

  const handleChange = useEventCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      e.stopPropagation();
      setValue(e.target.value);
    }
  );

  const handleSubmit = useEventCallback(() => {
    if (aiEditNode === null || aiStreaming) return;

    const prompt = value.trim() || ACTION_DEFAULT_PROMPTS[aiEditAction];

    requestAiPrompt(aiEditNode, prompt);
    setValue("");
    setAiEditNode(null);
  });

  const handleKeyDown = useEventCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // The canvas behind this field owns arrows, Tab, and Space as shortcuts;
      // stop them here so typing a prompt never navigates the map.
      e.stopPropagation();

      if (e.nativeEvent.isComposing || e.key === "Process") {
        return;
      }

      if (e.key === "Escape") {
        setAiEditNode(null);
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    }
  );

  // The popover renders this only while `aiEditNode` is set.
  const node = nodesMap[aiEditNode!];
  if (!node) return null;

  return (
    <div className="flex flex-col gap-2 p-3.5">
      <p className="text-xs font-medium text-glow">
        {ACTION_TITLES[aiEditAction]}
        <span className="text-muted-foreground"> · {node.data.title}</span>
      </p>
      <div className="flex items-end gap-2">
        <AutosizeTextarea
          className="min-h-[2.25rem] flex-1 resize-none rounded-[12px] border-glow/45 bg-background px-3 py-2 text-sm focus-visible:border-glow focus-visible:ring-0"
          disabled={aiStreaming}
          maxHeight={140}
          minHeight={30}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={ACTION_PLACEHOLDERS[aiEditAction]}
          ref={textareaRef}
          value={value}
        />
        <Button
          aria-label="Send to Sprig"
          className="shrink-0"
          disabled={aiStreaming}
          onClick={handleSubmit}
          size="icon"
          type="button"
        >
          <ArrowUp aria-hidden="true" className="!size-4" />
        </Button>
      </div>
      <p className="font-mono text-[11px] leading-none text-muted-foreground">
        {aiStreaming
          ? "Sprig is still working — one change at a time."
          : "enter to send · esc to close"}
      </p>
    </div>
  );
}

export { ACTION_DEFAULT_PROMPTS, NodeAiPrompt };
