"use client";

import { X } from "lucide-react";

/**
 * The canvas selection, restated as chat context.
 *
 * Dismissing it is not cosmetic: the panel stops sending `selectedNodeId` with
 * the next turn, so the chip is an honest switch for "answer about this node"
 * rather than a label the model might quietly ignore.
 */
function SelectedNodeChip({
  onDismiss,
  title,
}: {
  onDismiss: () => void;
  title: string;
}) {
  return (
    <div className="flex items-center gap-1.5 self-start rounded-full border border-line-strong bg-secondary py-1 pl-2.5 pr-1">
      <span className="max-w-[24ch] truncate font-mono text-[11px] leading-none text-muted-foreground">
        Working on: <span className="text-foreground">{title}</span>
      </span>
      <button
        aria-label={`Stop working on ${title}`}
        className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-organic hover:text-foreground motion-reduce:transition-none"
        onClick={onDismiss}
        type="button"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </div>
  );
}

export { SelectedNodeChip };
