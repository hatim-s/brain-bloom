"use client";

import { PanelRightOpen } from "lucide-react";
import {
  type PropsWithChildren,
  useCallback,
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

import { PanelEdgeNotch } from "@/components/app-shell/panel-edge-notch";
import { useEventCallback } from "@/hooks/use-event-callback";

import { useMindmapFlow } from "../flow/providers/MindmapFlowProvider";
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

/**
 * How long the panel takes to slide open or closed, in ms.
 *
 * Matches the navigation panel's own `duration-300` on the opposite edge, so
 * the two floating cards travel the shared settle curve at the same speed.
 */
const PANEL_TRAVEL_MS = 300;

/**
 * The travelling classes, applied only while a toggle is in flight.
 *
 * react-resizable-panels lays the group out with `flex-grow`, so that is what
 * has to animate. It is not left on permanently: a transition on `flex-grow`
 * would put the panel a third of a second behind the pointer during a drag of
 * the seam, which is the one place the panel must feel directly held.
 */
const PANEL_TRAVEL_CLASS =
  "lg:transition-[flex-grow] lg:duration-300 lg:ease-settle motion-reduce:transition-none";

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
  const isOpenRef = useRef(true);
  const persistWidthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const travelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isOpen, setIsOpen] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);
  // True only for the length of one open/close journey; see PANEL_TRAVEL_CLASS.
  const [isTravelling, setIsTravelling] = useState(false);

  const aiPromptRequest = useMindmapFlow((state) => state.aiPromptRequest);
  const aiStreaming = useMindmapFlow((state) => state.aiStreaming);

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
      isOpenRef.current = preferences.isOpen;
      setIsOpen(preferences.isOpen);

      if (!preferences.isOpen) {
        requestAnimationFrame(() => {
          try {
            panelRef.current?.collapse();
          } catch {
            // The stored visual state still applies while registration settles.
          }
        });
      }
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
      const panel = panelRef.current;

      // The panel can become hidden before this deferred layout frame runs.
      // Avoid calling an imperative handle that has since unregistered.
      if (panel === null || !isOpenRef.current) {
        return;
      }

      try {
        panel.resize(defaultSize);
        hasAppliedWidthRef.current = true;
      } catch {
        // The panel can unregister between this frame and StrictMode cleanup.
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [containerWidth]);

  useEffect(
    () => () => {
      if (persistWidthTimerRef.current !== null) {
        clearTimeout(persistWidthTimerRef.current);
      }
      if (travelTimerRef.current !== null) {
        clearTimeout(travelTimerRef.current);
      }
    },
    []
  );

  const constraints = useMemo(
    () => getPanelConstraints(containerWidth, restoredWidthRef.current),
    [containerWidth]
  );

  const handleToggle = useEventCallback(() => {
    const nextIsOpen = !isOpen;

    isOpenRef.current = nextIsOpen;
    setIsOpen(nextIsOpen);
    writeAiPanelOpen(nextIsOpen);

    // Arm the travelling transition for exactly this journey, then disarm it so
    // a later drag of the seam is not animated.
    setIsTravelling(true);
    if (travelTimerRef.current !== null) {
      clearTimeout(travelTimerRef.current);
    }
    travelTimerRef.current = setTimeout(() => {
      travelTimerRef.current = null;
      setIsTravelling(false);
    }, PANEL_TRAVEL_MS);

    if (!nextIsOpen) {
      requestAnimationFrame(() => {
        try {
          panelRef.current?.collapse();
        } catch {
          // Registration may still be settling on the first interactive frame.
        }
      });
      return;
    }

    const measuredWidth =
      containerRef.current?.getBoundingClientRect().width ?? containerWidth;
    const { defaultSize } = getPanelConstraints(
      measuredWidth,
      restoredWidthRef.current
    );

    // Recompute at expansion time so a collapsed panel never restores against
    // stale viewport constraints.
    requestAnimationFrame(() => {
      try {
        panelRef.current?.expand(defaultSize);
        panelRef.current?.resize(defaultSize);
      } catch {
        // Visibility state remains correct even if the layout is unregistering.
      }
    });
  });

  // A canvas-dispatched instruction means the writer wants to see the answer.
  // On desktop the panel opens itself; on small screens it stays collapsed
  // (opening a full overlay would cover the very node being grown) and the
  // edge tab's clay dot carries the "Sprig is working" signal instead.
  useEffect(() => {
    if (
      aiPromptRequest === null ||
      isOpenRef.current ||
      typeof window === "undefined" ||
      !window.matchMedia("(min-width: 1024px)").matches
    ) {
      return;
    }

    handleToggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleToggle is a stable event callback
  }, [aiPromptRequest]);

  // react-resizable-panels can report a new size while its parent is rendering,
  // so this callback cannot use the event-only hook that rejects render calls.
  const handleResize = useCallback(
    (size: number) => {
      // Before the stored width has been applied, `onResize` is only reporting
      // the provisional layout — persisting it would erase the writer's choice.
      if (
        !hasAppliedWidthRef.current ||
        !isOpenRef.current ||
        containerWidth <= 0 ||
        size <= 0
      ) {
        return;
      }

      const widthPx = (size / 100) * containerWidth;

      restoredWidthRef.current = widthPx;

      if (persistWidthTimerRef.current !== null) {
        clearTimeout(persistWidthTimerRef.current);
      }
      persistWidthTimerRef.current = setTimeout(() => {
        writeAiPanelWidth(widthPx);
        persistWidthTimerRef.current = null;
      }, 300);
    },
    [containerWidth]
  );

  return (
    <div className="relative flex h-full w-full flex-1" ref={containerRef}>
      <PanelGroup className="h-full w-full" direction="horizontal">
        <Panel
          className={
            "relative flex min-w-0 max-lg:!w-full max-lg:!flex-[1_1_100%] " +
            // The canvas widens on the same curve the panel narrows on, so the
            // seam between them is one moving line rather than two.
            (isTravelling ? PANEL_TRAVEL_CLASS : "")
          }
          // Declared so the first paint matches the prerendered layout instead
          // of shifting once the group registers its panels.
          defaultSize={isOpen ? 100 - constraints.defaultSize : 100}
          id="sprig-canvas"
          order={1}
        >
          {children}
        </Panel>
        <PanelResizeHandle
          aria-label="Resize Sprig panel"
          className={
            "group relative w-1.5 outline-none " +
            "after:absolute after:-left-1.5 after:top-0 after:h-full after:w-4 after:content-[''] " +
            "before:absolute before:inset-y-14 before:left-1/2 before:w-px before:-translate-x-1/2 before:rounded-full before:content-[''] " +
            "before:bg-transparent hover:before:bg-primary focus-visible:before:bg-primary " +
            "data-[resize-handle-state=drag]:before:bg-primary " +
            "before:transition-colors before:duration-200 before:ease-settle motion-reduce:before:transition-none " +
            (isOpen ? "max-lg:hidden" : "hidden")
          }
          id="sprig-panel-seam"
        />
        <Panel
          aria-hidden={!isOpen}
          className={
            "min-w-0 max-lg:fixed! max-lg:inset-y-0 max-lg:right-0 " +
            "max-lg:z-30 max-lg:w-[min(90vw,35rem)]! max-lg:max-w-[90vw]! " +
            // Below `lg` the panel is a fixed-width overlay, so it leaves by
            // sliding through the right edge instead of by narrowing.
            "max-lg:transition-transform max-lg:duration-300 max-lg:ease-settle " +
            "motion-reduce:transition-none " +
            (isTravelling ? PANEL_TRAVEL_CLASS + " " : "") +
            (isOpen ? "" : "pointer-events-none max-lg:translate-x-full")
          }
          collapsedSize={0}
          collapsible
          defaultSize={constraints.defaultSize}
          id="sprig-ai-panel"
          inert={!isOpen}
          maxSize={constraints.maxSize}
          minSize={constraints.minSize}
          onResize={handleResize}
          order={2}
          ref={panelRef}
        >
          {/* The shared app-shell panel frame (panel-geometry.ts): the same
              width, the same edge inset and the same clearance under the
              chrome band as the navigation panel on the other edge, so the two
              floating cards start and end on the same lines. The left gutter
              is a hairline instead — the drag seam lives there. */}
          <div className="h-full pb-[var(--panel-inset)] pl-1 pr-[var(--panel-inset)] pt-[var(--panel-top-inset)] max-lg:pl-[var(--panel-inset)]">
            <AiPanel onCollapse={handleToggle} />
          </div>
        </Panel>
      </PanelGroup>
      {/* A tab on the canvas edge, below the save pill's row, so it never
          collides with the floating header, theme switcher, or that pill — the
          mirror of the navigation panel's tab on the left edge. While a turn
          streams, its clay dot (`--glow`) is the collapsed panel's only tell
          that the model is working — the sole clay on the canvas chrome, so it
          cannot be mistaken for ordinary decoration. */}
      <PanelEdgeNotch
        isVisible={!isOpen}
        label={
          aiStreaming
            ? "Open Sprig panel — Sprig is working"
            : "Open Sprig panel"
        }
        onClick={handleToggle}
        side="right"
      >
        {aiStreaming ? (
          <span aria-hidden="true" className="sprig-glow-dot" />
        ) : (
          <PanelRightOpen aria-hidden="true" className="size-4" />
        )}
      </PanelEdgeNotch>
    </div>
  );
}

export { AiPanelLayout, getPanelConstraints };
