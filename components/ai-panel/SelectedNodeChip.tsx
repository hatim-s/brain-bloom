"use client";

import { X } from "lucide-react";

/**
 * The canvas selection, restated as chat context.
 *
 * Dismissing it is not cosmetic: the panel stops sending `selectedNodeId` with
 * the next turn, so the chip is an honest switch for "answer about this node"
 * rather than a label the model might quietly ignore.
 *
 * Colorway decision (the Clay Means AI Rule): this chip is a *user-chosen
 * scope, not an AI action, so it does not wear clay — clay would claim the
 * model is already doing something to this node, which is exactly the signal the
 * node card's own clay ring carries after a turn lands. The chip instead gets a
 * moss selection dot (moss is the voice of what the writer chose) on an
 * otherwise neutral sunken pill, so it reads as live context rather than as a
 * second AI indicator competing with the header's streaming dot.
 */
function SelectedNodeChip({
  onDismiss,
  title,
}: {
  onDismiss: () => void;
  title: string;
}) {
  return (
    <div className="flex items-center gap-1.5 self-start rounded-full border border-line-strong bg-secondary py-1 pl-2 pr-1">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
      <span className="max-w-[24ch] truncate text-[11px] leading-none text-muted-foreground">
        Working on <span className="font-medium text-foreground">{title}</span>
      </span>
      <button
        aria-label={`Stop working on ${title}`}
        className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-settle hover:text-foreground motion-reduce:transition-none"
        onClick={onDismiss}
        type="button"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </div>
  );
}

export { SelectedNodeChip };
