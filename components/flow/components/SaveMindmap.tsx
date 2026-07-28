"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useMindmapFlow } from "../providers/MindmapFlowProvider";
import { MindmapFlowContext } from "../providers/types";

type SyncState = MindmapFlowContext["syncState"];

/**
 * The word the pill shows for each sync state.
 *
 * `dirty` and `saving` deliberately collapse into one label. The difference
 * between "queued behind the debounce" and "request in flight" belongs to the
 * autosave, not to the writer, and swapping words on every keystroke would turn
 * an ambient status into a flicker.
 */
const SYNC_LABELS: Record<SyncState, string> = {
  idle: "Saved",
  dirty: "Saving…",
  saving: "Saving…",
  error: "Not saved",
};

/** Shown when the store recorded a failure without a usable message. */
const FALLBACK_ERROR = "This change could not be saved. Sprig keeps retrying.";

/**
 * Ambient autosave status for the canvas.
 *
 * Not a control: the mindmap saves itself, so this reports rather than invites.
 * It is a `role="status"` live region whose text only changes when the sync
 * state changes, which keeps announcements to the moments that matter — a
 * keystroke burst stays on one "Saving…" string and is never re-announced.
 *
 * The failure detail is carried twice, because the two audiences reach it
 * differently: visually through the tooltip, and in the accessibility tree
 * through the appended screen-reader text.
 */
const SaveMindmap = () => {
  const syncState = useMindmapFlow((state) => state.syncState);
  const lastSyncError = useMindmapFlow((state) => state.lastSyncError);
  const isError = syncState === "error";

  const pill = (
    <div
      className={cn(
        // The pill hangs off the same right-hand rail as ThemeSwitcher, one row
        // under the header band (header 12-52px, switcher 14-50px), so it never
        // enters the identity clearance those two already share.
        "sprig-sync-pill absolute top-16 right-[var(--theme-switcher-inset)] z-10",
        "flex items-center gap-2 rounded-full border bg-card px-2.5 py-1",
        "font-mono text-[11px] leading-none select-none",
        "transition-colors duration-200 ease-organic motion-reduce:transition-none",
        isError
          ? "border-destructive text-destructive"
          : // Nothing to hover in the healthy states, so the pill stops eating
            // wheel and click events meant for the canvas beneath it.
            "border-line-strong text-muted-foreground pointer-events-none"
      )}
      data-sync-state={syncState}
      role="status"
    >
      <span aria-hidden="true" className="sprig-sync-dot" />
      {SYNC_LABELS[syncState]}
      {isError ? (
        <span className="sr-only">. {lastSyncError ?? FALLBACK_ERROR}</span>
      ) : null}
    </div>
  );

  if (!isError) {
    return pill;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent align="end" className="max-w-[32ch]" sideOffset={8}>
        {lastSyncError ?? FALLBACK_ERROR}
      </TooltipContent>
    </Tooltip>
  );
};

export { SaveMindmap };
