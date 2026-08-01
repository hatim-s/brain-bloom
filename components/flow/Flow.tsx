"use client";

// eslint-disable-next-line simple-import-sort/imports -- prettier and eslint conflict
import "@xyflow/react/dist/style.css";
import "./flow.css";

import {
  Background,
  EdgeTypes as XYEdgeTypes,
  Node,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  NodeTypes as XYNodeTypes,
} from "@xyflow/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { AI_TOUCH_DURATION_MS } from "@/components/ai-panel/constants";
import { cn } from "@/lib/utils";
import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";
import { Stack } from "../ui/stack";
import { CanvasControls } from "./components/CanvasControls";
import { SaveMindmap } from "./components/SaveMindmap";
import { ShareMindmap } from "./components/ShareMindmap";
import { StemEdge } from "./edges";
import { useMindmapLiveSync } from "./hooks/useMindmapLiveSync";
import { useMindmapNavigation } from "./hooks/useMindmapNavigation";
import { useMindmapSync } from "./hooks/useMindmapSync";
import { getNewEdgeID } from "./mindmap/createEdge";
import { LeftNode, RightNode, RootNode } from "./nodes";
import {
  MindmapFlowProvider,
  useMindmapFlow,
  useMindmapStoreApi,
} from "./providers/MindmapFlowProvider";

// Owners load the assistant graph on demand; read-only and share canvases never
// render this boundary and therefore keep the AI SDK out of their page chunk.
const AiPanelLayout = dynamic(
  () =>
    import("@/components/ai-panel/AiPanelLayout").then(
      (module) => module.AiPanelLayout
    ),
  { ssr: false }
);

const nodeTypes: XYNodeTypes = {
  root: RootNode,
  left: LeftNode,
  right: RightNode,
};

// Growth curves, not wires: every mindmap edge is created with `type: "stem"`.
const edgeTypes: XYEdgeTypes = {
  stem: StemEdge,
};

/** Marks the stems from the root down to the node the reader is standing on. */
const ACTIVE_STEM_CLASS = "sprig-stem-active";

/** Flow-space gap between two dots of the fine ground lattice, in px. */
const DOT_GAP = 38;

/**
 * How many fine cells apart the coarse lattice's dots sit.
 *
 * Must stay ODD. xyflow offsets each dot pattern by half its own cell, so only
 * an odd multiple leaves the coarse dots sitting on top of fine ones; an even
 * one would drop them exactly between, and the ground would read as two grids
 * fighting rather than as one with some accents.
 */
const COARSE_DOT_MULTIPLE = 5;

/**
 * How far the fit may zoom out.
 *
 * `fitView` clamps the zoom it computed to this floor, so a floor set too high
 * turns "fit the whole grove" into "show part of the grove": on a phone a wide
 * map needs roughly 10% zoom, and clamping there left the westmost cards a few
 * pixels off the left edge. 5% keeps the clamp out of the way at every viewport
 * we ship, and nothing reads at that zoom anyway — it is a floor, not a target.
 */
const MIN_ZOOM = 0.05;

/** Viewport width (px) at or below which the canvas counts as a small screen. */
const SMALL_VIEWPORT_MAX_WIDTH = 640;

/**
 * Padding the one-time initial fit leaves around the grove.
 *
 * A phone fits the map an order of magnitude smaller than a desktop does, so
 * the same fraction of the viewport buys far less real slack; small screens pay
 * a little more of it to keep the outermost cards clear of the edges. Desktop
 * keeps 0.1 so a large map still fits at its established zoom.
 */
const INITIAL_FIT_PADDING = { small: 0.15, default: 0.1 } as const;

/** How long the camera takes to settle on the node the reader moved to. */
const FOCUS_FIT_DURATION_MS = 600;

/**
 * The zoom band a focused node is framed in.
 *
 * Selection used to pin `minZoom` and `maxZoom` to the *current* zoom, so a
 * click at a 20% overview centred the card and left it just as unreadable as
 * before — which read as "focus was removed". The floor makes an overview click
 * arrive at a legible size; because it is a floor and not a target, a camera
 * already closer than `FOCUS_MAX_ZOOM` keeps its own zoom instead of being
 * yanked back out.
 */
const FOCUS_ZOOM = { min: 0.85, max: 1 } as const;

/** Mounts outbound autosave and inbound live reconciliation for an owner. */
function MindmapSynchronization() {
  useMindmapSync();
  useMindmapLiveSync();
  return null;
}

export function MindmapFlow() {
  const readOnly = useMindmapFlow((state) => state.readOnly);
  const nodes = useMindmapFlow((state) => state.nodes);
  const edges = useMindmapFlow((state) => state.edges);
  const mindmapNodesMap = useMindmapFlow((state) => state.mindmapNodesMap);
  const leveledNodes = useMindmapFlow((state) => state.leveledNodes);
  const activeNode = useMindmapFlow((state) => state.activeNode);
  const reseedCount = useMindmapFlow((state) => state.reseedCount);
  const setActiveNode = useMindmapFlow((state) => state.setActiveNode);
  const selectedNode = useMindmapFlow((state) => state.selectedNode);
  const aiEditNode = useMindmapFlow((state) => state.aiEditNode);
  const aiTouchedNodeIds = useMindmapFlow((state) => state.aiTouchedNodeIds);
  const setAiTouchedNodeIds = useMindmapFlow(
    (state) => state.setAiTouchedNodeIds
  );
  const setSelectedNode = useMindmapFlow((state) => state.setSelectedNode);
  const setAiEditNode = useMindmapFlow((state) => state.setAiEditNode);
  const setToolbarNode = useMindmapFlow((state) => state.setToolbarNode);
  const originalOnNodesChange = useMindmapFlow(
    (state) => state.actions.onNodesChange
  );
  const onAddNode = useMindmapFlow((state) => state.actions.onAddNode);
  // Read-at-call-time access to the canvas store. Subscribing to `toolbarNode`
  // here would rebuild `handleNodeChange` every time the toolbar opened, which
  // re-runs the selection-sync effect below for no reason.
  const storeApi = useMindmapStoreApi();

  useMindmapNavigation({
    readOnly,
    mindmapNodesMap,
    leveledNodes,
    activeNode,
    setActiveNode,
    onAddNode,
    setSelectedNode,
    setAiEditNode,
    setToolbarNode,
  });

  const handleNodeChange = useCallback<typeof originalOnNodesChange>(
    (changes) => {
      // Check for selection changes
      const selectionAdd = changes.find(
        (change) => change.type === "select" && change.selected
      );
      const selectionRemove = changes.find(
        (change) => change.type === "select" && !change.selected
      );

      if (selectionAdd && selectionAdd.type === "select") {
        setActiveNode(selectionAdd.id);
        // The toolbar belongs to exactly one node, so it closes when the
        // selection lands somewhere else and stays put when it does not.
        //
        // The distinction is load-bearing rather than cosmetic: a pointer click
        // opens the toolbar and moves the selection in the same React batch, so
        // the `activeNode` sync effect below replays that select change *after*
        // the click handler has run. Closing unconditionally therefore nulled
        // the toolbar the instant a click opened it. Keyboard moves land on a
        // different id and still close it.
        if (storeApi.getState().toolbarNode !== selectionAdd.id) {
          setToolbarNode(null);
        }
      } else if (selectionRemove) {
        setActiveNode(null);
        setToolbarNode(null);
      }

      // Apply the original changes
      originalOnNodesChange(changes);
    },
    [originalOnNodesChange, setActiveNode, setToolbarNode, storeApi]
  );

  // A click is the pointer's way of asking "what can I do here?", so it
  // surfaces the contextual toolbar. Keyboard users have the same verbs on
  // shortcuts and are never shown the toolbar uninvited.
  const handleNodeClick = useCallback(
    (_ev: unknown, node: Node) => {
      if (!readOnly) {
        setToolbarNode(node.id);
      }
    },
    [readOnly, setToolbarNode]
  );

  const handleNodeDoubleClick = useCallback(
    (_ev: unknown, _node: Node) => {
      if (!readOnly) {
        setToolbarNode(null);
        setSelectedNode(_node.id);
      }
    },
    [readOnly, setSelectedNode, setToolbarNode]
  );

  const handlePaneClick = useCallback(() => {
    setActiveNode(null);
    setSelectedNode(null);
    setAiEditNode(null);
    setToolbarNode(null);
  }, [setActiveNode, setSelectedNode, setAiEditNode, setToolbarNode]);

  // The glow is a pulse of attention, not a badge, so the class is removed
  // once the animation in flow.css has settled.
  useEffect(() => {
    if (aiTouchedNodeIds.length === 0) return;

    const timer = setTimeout(
      () => setAiTouchedNodeIds([]),
      AI_TOUCH_DURATION_MS
    );

    return () => clearTimeout(timer);
  }, [aiTouchedNodeIds, setAiTouchedNodeIds]);

  const renderedNodes = useMemo(() => {
    if (aiTouchedNodeIds.length === 0) return nodes;

    const touchedNodeIds = new Set(aiTouchedNodeIds);

    return nodes.map((node) =>
      touchedNodeIds.has(node.id)
        ? { ...node, className: cn(node.className, "sprig-ai-touched") }
        : node
    );
  }, [aiTouchedNodeIds, nodes]);

  // The path back to the root is the reader's trail through the grove: the
  // stems along it lift to moss so the branch they are on stays legible even
  // when the canvas is zoomed out.
  const activeStemIds = useMemo(() => {
    if (!activeNode) return null;

    const stemIds = new Set<string>();
    let current = mindmapNodesMap[activeNode];

    while (current?.parentId) {
      stemIds.add(getNewEdgeID(current.parentId, current.id));
      current = mindmapNodesMap[current.parentId];
    }

    return stemIds.size > 0 ? stemIds : null;
  }, [activeNode, mindmapNodesMap]);

  const renderedEdges = useMemo(() => {
    if (!activeStemIds) return edges;

    return edges.map((edge) =>
      activeStemIds.has(edge.id)
        ? { ...edge, className: cn(edge.className, ACTIVE_STEM_CLASS) }
        : edge
    );
  }, [activeStemIds, edges]);

  const prevActiveNode = useRef<string | null>(null);
  // True while the next selection dispatch is a replay of state the canvas
  // already had (mount, server reseed) rather than a move the reader made. The
  // reseed effect below re-arms it; the initial value covers mount.
  const isReplayedSelection = useRef(true);

  const reactflowInstance = useReactFlow();

  // The `fitView` prop only fits whatever nodes exist at ReactFlow's own init,
  // which runs before the store's laid-out nodes stream in — so a loaded map
  // mounted at default zoom with most of the tree off-screen. Fit exactly once
  // after the first non-empty layout is measured (dimensions ready); later
  // reseeds keep the user's camera.
  const nodesInitialized = useNodesInitialized();
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (didInitialFit.current || !nodesInitialized || nodes.length === 0)
      return;
    didInitialFit.current = true;

    // Measured at fit time rather than tracked: this runs exactly once, so a
    // media query listener would only be extra machinery for the same answer.
    const isSmallViewport =
      typeof window !== "undefined" &&
      window.innerWidth <= SMALL_VIEWPORT_MAX_WIDTH;

    reactflowInstance.fitView({
      padding: isSmallViewport
        ? INITIAL_FIT_PADDING.small
        : INITIAL_FIT_PADDING.default,
      maxZoom: 1,
    });
  }, [nodes.length, nodesInitialized, reactflowInstance]);

  // Server reseeds replace every XYFlow node object, including its transient
  // selected flag. Forget the prior dispatch so the active node is reselected,
  // and treat that replay as scenery rather than as the reader moving. With
  // nothing selected there is nothing to replay, so the next dispatch is a
  // genuine move and keeps its camera work.
  useEffect(() => {
    prevActiveNode.current = null;
    isReplayedSelection.current = storeApi.getState().activeNode !== null;
  }, [reseedCount, storeApi]);

  // sync active node with the flow
  useEffect(() => {
    if (activeNode) {
      if (prevActiveNode.current === activeNode) return;

      handleNodeChange([
        {
          id: activeNode,
          type: "select",
          selected: true,
        },
        ...(prevActiveNode.current
          ? [
              {
                id: prevActiveNode.current,
                type: "select" as const,
                selected: false,
              },
            ]
          : []),
      ]);

      prevActiveNode.current = activeNode;

      // Mount and reseed replay whatever was already selected. Neither is the
      // reader moving through the map, and the mount-time one would run before
      // the initial fit and lock the default zoom onto the root, leaving the
      // rest of the map off-screen.
      if (isReplayedSelection.current) {
        isReplayedSelection.current = false;
        return;
      }

      requestAnimationFrame(() => {
        // Never zoom *out* to focus: the floor only ever lifts a distant camera
        // to a readable size, and the ceiling rises with it so an already-close
        // camera keeps the framing the reader chose.
        const minZoom = Math.max(reactflowInstance.getZoom(), FOCUS_ZOOM.min);

        reactflowInstance.fitView({
          nodes: [
            {
              id: activeNode,
            },
          ],
          duration: FOCUS_FIT_DURATION_MS,
          minZoom,
          maxZoom: Math.max(minZoom, FOCUS_ZOOM.max),
        });
      });
      return;
    }

    if (prevActiveNode.current) {
      const deselected = prevActiveNode.current;
      // Cleared first: dropping the selection is a one-shot, so a re-run of
      // this effect must not dispatch the same change a second time.
      prevActiveNode.current = null;
      handleNodeChange([
        {
          id: deselected,
          type: "select" as const,
          selected: false,
        },
      ]);
    }
  }, [activeNode, handleNodeChange, reactflowInstance, reseedCount]);

  return (
    // The forest floor: `sprig-atmosphere` carries the canopy light and grain
    // (The Never Flat Rule), `sprig-canvas` adds the grove's own tonal pools and
    // vignette. The flow pane itself is transparent so both show through.
    <Stack
      className="sprig-atmosphere sprig-canvas h-full w-full flex-1"
      // A stem can style itself from its own class, but it cannot dim its
      // neighbours. Hoisting "a trail is lit" onto the ground gives flow.css
      // the one ancestor it needs to fade every stem that is not on the trail.
      data-trail-active={activeStemIds ? "true" : undefined}
    >
      {readOnly ? null : (
        <>
          <MindmapSynchronization />
          {/* One right rail, seated on the line where both floating panels
              start (`--panel-top-inset`) so it reads as part of the same
              chrome: clear of the header bar's band above it, and inset from
              the canvas edge by the panels' own inset. Sharing is an action,
              the save pill is ambient status, and they share a row so neither
              can drift as the pill's copy changes length. */}
          <div className="absolute top-[var(--panel-top-inset)] right-[var(--panel-inset)] z-10 flex items-center gap-2">
            <ShareMindmap />
            <SaveMindmap />
          </div>
        </>
      )}
      <ReactFlow
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={!readOnly}
        edgesFocusable={false}
        // Node deletion has no pending-op or backend path yet. Disable the
        // XYFlow default in every mode so Backspace cannot create local-only
        // destruction.
        deleteKeyCode={null}
        minZoom={MIN_ZOOM}
        disableKeyboardA11y
        nodes={renderedNodes}
        edges={renderedEdges}
        // disabling edge selection, node selection is enabled at the node level
        elementsSelectable={false}
        onNodesChange={handleNodeChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        // onEdgesChange={onEdgesChange}
        // onConnect={onConnect}
        panOnDrag={false}
        zoomOnDoubleClick={false}
        onPaneClick={handlePaneClick}
        panOnScroll={!(selectedNode || aiEditNode)}
        zoomOnScroll={false}
        zoomOnPinch={!(selectedNode || aiEditNode)}
        fitView
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
      >
        {/* Whisper-quiet: the dots exist only to give the ground a sense of
            scale. Wider gap and a single pixel keep them under the atmosphere
            rather than on top of it. */}
        <Background gap={DOT_GAP} size={1} />
        {/* A second lattice at five times the gap, so one dot in twenty-five
            reads slightly larger and slightly more present. xyflow auto-offsets
            each pattern by half a cell, and an *odd* multiple of the fine gap
            is what keeps that offset in phase — the coarse dots land on fine
            ones instead of between them, which is the difference between
            texture and visual buzz. */}
        <Background
          className="sprig-dots-coarse"
          gap={DOT_GAP * COARSE_DOT_MULTIPLE}
          id="coarse"
          size={2.4}
        />
      </ReactFlow>
      <CanvasControls />
    </Stack>
  );
}

export default function Flow({
  mindmap: mindmapDB,
  nodes,
  readOnly = false,
}: {
  mindmap: MindmapDB;
  nodes: MindmapNodeProjection[];
  readOnly?: boolean;
}) {
  return (
    <ReactFlowProvider>
      {/* This key remounts the prop-seeded store when client navigation loads another mindmap. */}
      <MindmapFlowProvider
        key={mindmapDB._id}
        readOnly={readOnly}
        mindmapDB={mindmapDB}
        serverNodes={nodes}
      >
        {/* Only an owner can edit, so only an owner gets the AI panel; a
            read-only canvas keeps the full width it had before P8. */}
        {readOnly ? (
          <MindmapFlow />
        ) : (
          <AiPanelLayout>
            <MindmapFlow />
          </AiPanelLayout>
        )}
      </MindmapFlowProvider>
    </ReactFlowProvider>
  );
}
