"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one shape a collapsed app-shell panel leaves behind on its viewport edge.
 *
 * Both floating panels reduce to this tab, which is why it is one component
 * rather than two lookalikes: identical size, radius, hairline-strong edge and
 * Raised shadow, seated at the same height on the screen (see
 * `panel-geometry.ts`). Only the side differs — the rounding, the dropped
 * border and the direction it slides away in are mirrored for the left edge.
 *
 * The tab is never unmounted. It cross-fades and slides out through its own
 * edge as the panel arrives, which is what makes the two read as one object
 * changing state instead of two controls swapping places. While hidden it is
 * removed from the accessibility tree and from the tab order, so a closed tab
 * can never take focus or be announced beside the panel it stands in for.
 */
function PanelEdgeNotch({
  children,
  className,
  isVisible,
  label,
  onClick,
  side,
  title,
}: {
  /** The icon (or status dot) the tab carries. */
  children: ReactNode;
  className?: string;
  /** False while the panel itself is open; the tab then settles out of view. */
  isVisible: boolean;
  /** Accessible name, sentence case — e.g. "Open sidebar". */
  label: string;
  onClick: () => void;
  /** Which viewport edge the tab hugs. */
  side: "left" | "right";
  /** Optional pointer hint, typically the keyboard shortcut. */
  title?: string;
}) {
  const isLeft = side === "left";

  return (
    <button
      aria-hidden={!isVisible}
      aria-label={label}
      className={cn(
        // Fallbacks restate `panel-geometry.ts` for the one surface that mounts
        // a panel outside the app shell (and for tests), where the shell's
        // custom properties have never been published.
        "fixed top-[var(--panel-notch-top,7rem)] z-20 flex items-center justify-center",
        "h-[var(--panel-notch-height,2.25rem)] w-[var(--panel-notch-width,2rem)]",
        "border border-line-strong bg-card text-muted-foreground shadow-raised",
        "hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // The counterpoint to the panel's own 300ms slide: the tab travels the
        // same curve, out through the edge the panel is arriving from.
        "transition-[opacity,transform,color] duration-300 ease-settle",
        "motion-reduce:transition-none",
        isLeft
          ? "left-0 rounded-l-none rounded-r-md border-l-0"
          : "right-0 rounded-l-md rounded-r-none border-r-0",
        isVisible
          ? "translate-x-0 opacity-100"
          : cn(
              "pointer-events-none opacity-0",
              isLeft ? "-translate-x-full" : "translate-x-full"
            ),
        className
      )}
      onClick={onClick}
      tabIndex={isVisible ? undefined : -1}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

export { PanelEdgeNotch };
