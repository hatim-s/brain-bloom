"use client";

import { useReactFlow, useViewport } from "@xyflow/react";
import { Minus, Plus, Scan } from "lucide-react";

import { useOptionalSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** How long a zoom step takes to settle, in ms. */
const ZOOM_STEP_DURATION_MS = 200;
/** Fitting the whole map travels further, so it gets a longer settle. */
const FIT_VIEW_DURATION_MS = 400;

/**
 * Shared tactile treatment for every key on the sheet.
 *
 * 32px hit areas on an 8px radius inside the sheet's 12px one, moss on hover
 * (the one voice of action), and a 2% press that settles on the shared curve so
 * the key feels taken rather than animated. Reduced motion drops both.
 */
const CONTROL_CLASS_NAME = cn(
  "flex h-8 items-center justify-center rounded-sm text-muted-foreground",
  "transition-[background-color,color,transform] duration-200 ease-settle",
  "hover:bg-accent hover:text-primary",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-card",
  "active:scale-[0.94]",
  "motion-reduce:transition-none motion-reduce:active:scale-100"
);

/**
 * The canvas's camera sheet: zoom out, a live zoom readout, zoom in, fit.
 *
 * Canon canvas chrome (FigJam/Miro seat it bottom-left) that is also the only
 * pointer-visible affordance for camera control, since panning is scroll-driven
 * and drag is reserved for future node work. One floating forest-raised sheet
 * on a hairline, three keys in a zoom group, a hairline divider, then fit — so
 * "change the zoom" and "frame the whole grove" read as different intents.
 *
 * The readout is a control, not a label: it prints the live viewport zoom in
 * tabular mono (a technical value, per the type scale) and clicking it returns
 * the camera to 1:1. `useViewport` re-renders this on every camera change, which
 * is what makes the percentage honest during scroll-zoom as well as clicks.
 */
function CanvasControls() {
  const { fitView, zoomIn, zoomOut, zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  const zoomPercent = Math.round(zoom * 100);
  // The navigation panel floats over this corner, so the sheet steps clear of
  // its whole track instead of being covered by it. Null on the public share
  // route, which has no panel to avoid.
  const isSidebarOpen = useOptionalSidebar()?.open ?? false;

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className={cn(
          "absolute bottom-[var(--panel-inset,1rem)] left-[var(--panel-inset,1rem)] z-10",
          "flex items-center gap-0.5 rounded-md border border-border bg-card p-1 shadow-floating",
          // Travels on the panel's own curve and duration, so the two move as
          // one gesture. Below `md` the panel is an overlay and displaces
          // nothing.
          "transition-[left] duration-300 ease-settle motion-reduce:transition-none",
          isSidebarOpen && "md:left-[var(--sidebar-width)]"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Zoom out"
              className={cn(CONTROL_CLASS_NAME, "w-8")}
              onClick={() => zoomOut({ duration: ZOOM_STEP_DURATION_MS })}
              type="button"
            >
              <Minus aria-hidden="true" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-[11px] font-medium" sideOffset={8}>
            Zoom out
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              // The visible text is the live value, so the name carries both it
              // and what pressing the key will do.
              aria-label={`Zoom ${zoomPercent}%. Reset zoom to 100%`}
              className={cn(
                CONTROL_CLASS_NAME,
                "min-w-[3.25rem] px-1.5 font-mono text-[11px] font-medium tabular-nums"
              )}
              onClick={() => zoomTo(1, { duration: ZOOM_STEP_DURATION_MS })}
              type="button"
            >
              {zoomPercent}%
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-[11px] font-medium" sideOffset={8}>
            Reset zoom
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Zoom in"
              className={cn(CONTROL_CLASS_NAME, "w-8")}
              onClick={() => zoomIn({ duration: ZOOM_STEP_DURATION_MS })}
              type="button"
            >
              <Plus aria-hidden="true" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-[11px] font-medium" sideOffset={8}>
            Zoom in
          </TooltipContent>
        </Tooltip>

        {/* Decorative grouping only, so the quiet hairline token. */}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Fit the map"
              className={cn(CONTROL_CLASS_NAME, "w-8")}
              onClick={() =>
                fitView({
                  duration: FIT_VIEW_DURATION_MS,
                  maxZoom: 1,
                  padding: 0.1,
                })
              }
              type="button"
            >
              <Scan aria-hidden="true" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-[11px] font-medium" sideOffset={8}>
            Fit the map
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export { CanvasControls };
