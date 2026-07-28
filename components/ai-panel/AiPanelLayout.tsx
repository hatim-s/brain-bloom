"use client";

import { PanelRightOpen } from "lucide-react";
import {
  type PropsWithChildren,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import { useEventCallback } from "@/hooks/use-event-callback";

import { AiPanel } from "./AiPanel";
import {
  AI_PANEL_DEFAULT_WIDTH_PX,
  AI_PANEL_FALLBACK_CONSTRAINTS,
  AI_PANEL_MAX_WIDTH_PX,
  AI_PANEL_MIN_WIDTH_PX,
} from "./constants";
import {
  readAiPanelPreferences,
  writeAiPanelOpen,
  writeAiPanelWidth,
} from "./preferences";

/** Keeps the canvas from ever being squeezed out by the panel. */
const MAX_PANEL_PERCENT = 60;

type PanelConstraints = {
  defaultSize: number;
  minSize: number;
  maxSize: number;
};

/** Converts a pixel width into the percentage the panel group works in. */
function toPercent(widthPx: number, containerWidth: number): number {
  return (widthPx / containerWidth) * 100;
}

/**
 * Derives percentage constraints from the measured group width.
 *
 * A narrow viewport cannot honour a 320px floor and a 560px ceiling at the
 * same time, so the ceiling is clamped first and the floor is then held at or
 * below it. That keeps `min <= default <= max` true for react-resizable-panels
 * at every width instead of only on comfortable displays.
 */
function getPanelConstraints(
  containerWidth: number,
  restoredWidthPx: number | null
): PanelConstraints {
  if (containerWidth <= 0) {
    return { ...AI_PANEL_FALLBACK_CONSTRAINTS };
  }

  const maxSize = Math.min(
    toPercent(AI_PANEL_MAX_WIDTH_PX, containerWidth),
    MAX_PANEL_PERCENT
  );
  const minSize = Math.min(
    toPercent(AI_PANEL_MIN_WIDTH_PX, containerWidth),
    maxSize
  );
  const preferredSize = toPercent(
    restoredWidthPx ?? AI_PANEL_DEFAULT_WIDTH_PX,
    containerWidth
  );

  return {
    defaultSize: Math.min(Math.max(preferredSize, minSize), maxSize),
    maxSize,
    minSize,
  };
}

/**
 * Canvas on the left, Sprig on the right, with a draggable seam between them.
 *
 * Panel state is restored after mount rather than during the first render:
 * `localStorage` is unavailable while the page is prerendered, and reading it
 * during hydration would make the server and client markup disagree.
 */
function AiPanelLayout({ children }: PropsWithChildren) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<ImperativePanelHandle | null>(null);
  const restoredWidthRef = useRef<number | null>(null);
  const hasRestoredRef = useRef(false);
  const hasAppliedWidthRef = useRef(false);

  const [isOpen, setIsOpen] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    /** Re-reads the group width so the pixel constraints stay honest. */
    const measure = () =>
      setContainerWidth(container.getBoundingClientRect().width);

    measure();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // Reading storage is deferred to an effect so the prerendered markup and the
  // first client render agree; the panel then snaps to the stored state.
  useEffect(() => {
    const preferences = readAiPanelPreferences();

    restoredWidthRef.current = preferences.widthPx;
    hasRestoredRef.current = true;

    if (preferences.isOpen !== null) {
      setIsOpen(preferences.isOpen);
    }
  }, []);

  // The stored width is in pixels, so applying it has to wait for a measured
  // group. The panel group publishes its first layout from a layout effect, so
  // the imperative resize is deferred a frame; before that it has no size to
  // change and would throw.
  useEffect(() => {
    if (
      hasAppliedWidthRef.current ||
      !hasRestoredRef.current ||
      containerWidth <= 0
    ) {
      return;
    }

    const { defaultSize } = getPanelConstraints(
      containerWidth,
      restoredWidthRef.current
    );
    const frame = requestAnimationFrame(() => {
      panelRef.current?.resize(defaultSize);
      hasAppliedWidthRef.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [containerWidth]);

  const constraints = useMemo(
    () => getPanelConstraints(containerWidth, restoredWidthRef.current),
    [containerWidth]
  );

  const handleToggle = useEventCallback(() => {
    const nextIsOpen = !isOpen;

    setIsOpen(nextIsOpen);
    writeAiPanelOpen(nextIsOpen);
  });

  const handleResize = useEventCallback((size: number) => {
    // Before the stored width has been applied, `onResize` is only reporting
    // the provisional layout — persisting it would erase the writer's choice.
    if (!hasAppliedWidthRef.current || containerWidth <= 0) return;

    const widthPx = (size / 100) * containerWidth;

    restoredWidthRef.current = widthPx;
    writeAiPanelWidth(widthPx);
  });

  return (
    <div className="relative flex h-full w-full flex-1" ref={containerRef}>
      <PanelGroup className="h-full w-full" direction="horizontal">
        <Panel
          className="relative flex min-w-0"
          // Declared so the first paint matches the prerendered layout instead
          // of shifting once the group registers its panels.
          defaultSize={isOpen ? 100 - constraints.defaultSize : 100}
          id="sprig-canvas"
          order={1}
        >
          {children}
        </Panel>
        {isOpen ? (
          <>
            <PanelResizeHandle
              aria-label="Resize Sprig panel"
              className="relative w-px bg-line-strong outline-none transition-colors duration-200 ease-organic after:absolute after:-left-1.5 after:top-0 after:h-full after:w-3.5 after:content-[''] hover:bg-primary focus-visible:bg-primary data-[resize-handle-state=drag]:bg-primary motion-reduce:transition-none"
              id="sprig-panel-seam"
            />
            <Panel
              className="min-w-0 border-l border-line-strong"
              defaultSize={constraints.defaultSize}
              id="sprig-ai-panel"
              maxSize={constraints.maxSize}
              minSize={constraints.minSize}
              onResize={handleResize}
              order={2}
              ref={panelRef}
            >
              <AiPanel onCollapse={handleToggle} />
            </Panel>
          </>
        ) : null}
      </PanelGroup>
      {isOpen ? null : (
        /* A tab on the canvas edge, below the save pill's row, so it never
           collides with the floating header, theme switcher, or that pill. */
        <Button
          aria-label="Open Sprig panel"
          className="absolute right-0 top-28 z-10 h-9 w-8 rounded-l-md rounded-r-none border border-r-0 border-line-strong bg-card text-muted-foreground hover:text-foreground"
          onClick={handleToggle}
          size="icon"
          type="button"
          variant="ghost"
        >
          <PanelRightOpen aria-hidden="true" className="!size-4" />
        </Button>
      )}
    </div>
  );
}

export { AiPanelLayout, getPanelConstraints };
