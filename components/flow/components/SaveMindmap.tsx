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
 * The word the pill shows for each non-error sync state.
 *
 * `dirty` and `saving` deliberately collapse into one label so a keystroke
 * burst remains an ambient status instead of flickering between phases.
 */
const SYNC_LABELS: Record<Exclude<SyncState, "error">, string> = {
  idle: "Saved",
  dirty: "Saving…",
  saving: "Saving…",
};

/** Shown when the store recorded a failure without a usable server message. */
const FALLBACK_ERROR = "The latest save attempt failed.";

const TRANSIENT_ERROR_COPY = "Not saved — retrying. Click to retry now.";
const REJECTION_ERROR_COPY =
  "Some changes couldn't be saved and live only on this screen. Reload to resync.";

/** Shared visual treatment for the healthy div and interactive error button. */
const PILL_CLASS_NAME = [
  "sprig-sync-pill flex items-center gap-2 rounded-full border bg-card px-2.5 py-1",
  "font-mono text-[11px] leading-none select-none",
  "transition-colors duration-200 ease-organic motion-reduce:transition-none",
].join(" ");

/**
 * Ambient autosave status with an explicit retry control only after failure.
 *
 * The live-region wrapper announces the concise state copy. The error button
 * remains focusable so Radix exposes the server detail to keyboard users too,
 * without making that described trigger a second status live region.
 */
const SaveMindmap = () => {
  const syncState = useMindmapFlow((state) => state.syncState);
  const lastSyncError = useMindmapFlow((state) => state.lastSyncError);
  const desyncedSinceRejection = useMindmapFlow(
    (state) => state.desyncedSinceRejection
  );
  const retrySync = useMindmapFlow((state) => state.actions.retrySync);
  const isError = syncState === "error" || desyncedSinceRejection;
  const errorCopy = desyncedSinceRejection
    ? REJECTION_ERROR_COPY
    : TRANSIENT_ERROR_COPY;

  return (
    <div
      className="absolute top-16 right-[var(--theme-switcher-inset)] z-10"
      data-sync-state={isError ? "error" : syncState}
      role="status"
    >
      {isError ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn(
                PILL_CLASS_NAME,
                "border-destructive text-destructive"
              )}
              onClick={retrySync}
              type="button"
            >
              <span aria-hidden="true" className="sprig-sync-dot" />
              {errorCopy}
            </button>
          </TooltipTrigger>
          <TooltipContent align="end" className="max-w-[32ch]" sideOffset={8}>
            {lastSyncError ?? FALLBACK_ERROR}
          </TooltipContent>
        </Tooltip>
      ) : (
        <div
          className={cn(
            PILL_CLASS_NAME,
            "border-line-strong text-muted-foreground pointer-events-none"
          )}
        >
          <span aria-hidden="true" className="sprig-sync-dot" />
          {SYNC_LABELS[syncState]}
        </div>
      )}
    </div>
  );
};

export { SaveMindmap };
