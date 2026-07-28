"use client";

import { useMutation } from "convex/react";
import { Check, Copy, Link2, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/convex/_generated/api";
import { useEventCallback } from "@/hooks/use-event-callback";
import { cn } from "@/lib/utils";

import { useMindmapFlow } from "../providers/MindmapFlowProvider";

/** How long the copy button stays in its confirmed state. */
const COPIED_RESET_MS = 2000;

type Visibility = "private" | "shared";

/**
 * Link sharing for the map's owner, from the canvas.
 *
 * Visibility is a server fact, so the control never pretends: the switch stays
 * in a visible pending state until Convex has actually written the change, and
 * a failure is reported next to the switch rather than swallowed. The trigger
 * carries the current state so the answer to "is this map out there?" is
 * readable without opening anything.
 */
const ShareMindmap = () => {
  const mindmapId = useMindmapFlow((state) => state.mindmapDB._id);
  const publicId = useMindmapFlow((state) => state.mindmapDB.publicId);
  const seededVisibility = useMindmapFlow(
    (state) => state.mindmapDB.visibility
  );
  const setVisibility = useMutation(api.mindmaps.setVisibility);

  const switchLabelId = useId();
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The canvas store is seeded from the server render and is not re-seeded by
  // this mutation, so the confirmed write becomes the local source of truth.
  const [visibility, setLocalVisibility] =
    useState<Visibility>(seededVisibility);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);
  // The origin is only knowable on the client; reading it during render would
  // make the prerendered markup and the first client render disagree.
  const [origin, setOrigin] = useState("");

  const isShared = visibility === "shared";
  const shareUrl = `${origin}/share/${publicId}`;

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    },
    []
  );

  const handleToggle = useEventCallback(async () => {
    if (isPending) {
      return;
    }

    const nextVisibility: Visibility = isShared ? "private" : "shared";

    setIsPending(true);
    setErrorMessage(null);

    try {
      await setVisibility({ mindmapId, visibility: nextVisibility });
      setLocalVisibility(nextVisibility);
      setHasCopied(false);
    } catch {
      setErrorMessage("Couldn't change sharing just now. Try again.");
    } finally {
      setIsPending(false);
    }
  });

  const handleCopy = useEventCallback(async () => {
    const clipboard = globalThis.navigator?.clipboard;

    if (clipboard === undefined) {
      setErrorMessage(
        "Copying isn't available here — select the link instead."
      );
      return;
    }

    try {
      await clipboard.writeText(shareUrl);
      setErrorMessage(null);
      setHasCopied(true);

      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(
        () => setHasCopied(false),
        COPIED_RESET_MS
      );
    } catch {
      setErrorMessage("Couldn't copy the link — select it instead.");
    }
  });

  const triggerLabel = isShared
    ? "Sharing: anyone with the link can view"
    : "Sharing: private";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={triggerLabel}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-line-strong bg-card px-2.5 py-1",
            "font-mono text-[11px] leading-none select-none",
            "transition-colors duration-200 ease-organic motion-reduce:transition-none",
            isShared
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          title={triggerLabel}
          type="button"
        >
          {isShared ? (
            <Link2 aria-hidden="true" className="size-3" />
          ) : (
            <Lock aria-hidden="true" className="size-3" />
          )}
          {isShared ? "Shared" : "Share"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" sideOffset={8}>
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <p
                className="text-sm font-medium text-foreground"
                id={switchLabelId}
              >
                Share this map
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Anyone with the link can view, without the conversation.
              </p>
            </div>
            <button
              aria-checked={isShared}
              aria-labelledby={switchLabelId}
              className={cn(
                "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border border-line-strong p-0.5",
                "transition-colors duration-200 ease-organic motion-reduce:transition-none",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isShared ? "bg-primary" : "bg-secondary"
              )}
              disabled={isPending}
              onClick={() => void handleToggle()}
              role="switch"
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-3.5 rounded-full bg-card",
                  "transition-transform duration-200 ease-organic motion-reduce:transition-none",
                  isShared ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>

          <p aria-live="polite" className="sr-only" role="status">
            {isPending ? "Updating sharing" : hasCopied ? "Link copied" : ""}
          </p>

          {isPending ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">
              Updating…
            </p>
          ) : null}

          {isShared && !isPending ? (
            <div className="flex items-center gap-2">
              <input
                aria-label="Public link to this map"
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-background px-2 py-1.5 font-mono text-[11px] text-muted-foreground"
                readOnly
                value={shareUrl}
              />
              <button
                aria-label={hasCopied ? "Link copied" : "Copy link"}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md border border-line-strong",
                  "text-muted-foreground hover:text-foreground",
                  "transition-colors duration-200 ease-organic motion-reduce:transition-none"
                )}
                onClick={() => void handleCopy()}
                title={hasCopied ? "Link copied" : "Copy link"}
                type="button"
              >
                {hasCopied ? (
                  <Check aria-hidden="true" className="size-3.5 text-primary" />
                ) : (
                  <Copy aria-hidden="true" className="size-3.5" />
                )}
              </button>
            </div>
          ) : null}

          {errorMessage ? (
            <p
              className="rounded-md border border-destructive px-2.5 py-2 text-xs font-medium text-destructive"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export { ShareMindmap };
