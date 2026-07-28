"use client";

// eslint-disable-next-line simple-import-sort/imports -- prettier and eslint conflict
import "@xyflow/react/dist/style.css";
import "./flow.css";

import {
  Background,
  Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  NodeTypes as XYNodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { AiPanelLayout } from "@/components/ai-panel/AiPanelLayout";
import { AI_TOUCH_DURATION_MS } from "@/components/ai-panel/constants";
import { cn } from "@/lib/utils";
import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";
import { Stack } from "../ui/stack";
import { SaveMindmap } from "./components/SaveMindmap";
import { useMindmapNavigation } from "./hooks/useMindmapNavigation";
import { useMindmapSync } from "./hooks/useMindmapSync";
import { INITIAL_EDGES, INITIAL_NODES } from "./initialNodesAndEdges";
import { createFlowEdgeFromPartialBaseFlowEdge } from "./mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "./mindmap/createNode";
import {
  PartialBaseFlowEdge,
  PartialBaseFlowNode,
  transformConvexNodesToFlowNodesAndEdges,
} from "./mindmap/mindmapNodesToFlowNodes";
import { LeftNode, RightNode, RootNode } from "./nodes";
import {
  MindmapFlowProvider,
  useMindmapFlow,
} from "./providers/MindmapFlowProvider";

const nodeTypes: XYNodeTypes = {
  root: RootNode,
  left: LeftNode,
  right: RightNode,
};

/** Mounts autosave only for an editable canvas. */
function MindmapAutosave() {
  useMindmapSync();
  return null;
}

export function MindmapFlow() {
  const readOnly = useMindmapFlow((state) => state.readOnly);
  const nodes = useMindmapFlow((state) => state.nodes);
  const edges = useMindmapFlow((state) => state.edges);
  const mindmapNodesMap = useMindmapFlow((state) => state.mindmapNodesMap);
  const leveledNodes = useMindmapFlow((state) => state.leveledNodes);
  const activeNode = useMindmapFlow((state) => state.activeNode);
  const setActiveNode = useMindmapFlow((state) => state.setActiveNode);
  const selectedNode = useMindmapFlow((state) => state.selectedNode);
  const aiEditNode = useMindmapFlow((state) => state.aiEditNode);
  const aiTouchedNodeIds = useMindmapFlow((state) => state.aiTouchedNodeIds);
  const setAiTouchedNodeIds = useMindmapFlow(
    (state) => state.setAiTouchedNodeIds
  );
  const setSelectedNode = useMindmapFlow((state) => state.setSelectedNode);
  const setAiEditNode = useMindmapFlow((state) => state.setAiEditNode);
  const originalOnNodesChange = useMindmapFlow(
    (state) => state.actions.onNodesChange
  );
  const onAddNode = useMindmapFlow((state) => state.actions.onAddNode);

  useMindmapNavigation({
    readOnly,
    mindmapNodesMap,
    leveledNodes,
    activeNode,
    setActiveNode,
    onAddNode,
    setSelectedNode,
    setAiEditNode,
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
      } else if (selectionRemove) {
        setActiveNode(null);
      }

      // Apply the original changes
      originalOnNodesChange(changes);
    },
    [originalOnNodesChange, setActiveNode]
  );

  const handleNodeDoubleClick = useCallback(
    (_ev: unknown, _node: Node) => {
      if (!readOnly) {
        setSelectedNode(_node.id);
      }
    },
    [readOnly, setSelectedNode]
  );

  const handlePaneClick = useCallback(() => {
    setActiveNode(null);
    setSelectedNode(null);
    setAiEditNode(null);
  }, [setActiveNode, setSelectedNode, setAiEditNode]);

  // The bloom is a pulse of attention, not a badge, so the class is removed
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

  const prevActiveNode = useRef<string | null>(null);

  const reactflowInstance = useReactFlow();

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

      requestAnimationFrame(() => {
        reactflowInstance.fitView({
          nodes: [
            {
              id: activeNode,
            },
          ],
          duration: 700,
          minZoom: reactflowInstance.getZoom(), // maintain the current zoom level
          maxZoom: reactflowInstance.getZoom(), // maintain the current zoom level
        });
      });
      return;
    }

    if (prevActiveNode.current)
      handleNodeChange([
        {
          id: prevActiveNode.current,
          type: "select" as const,
          selected: false,
        },
      ]);
  }, [activeNode, handleNodeChange, reactflowInstance]);

  return (
    <Stack className="h-full w-full flex-1">
      {readOnly ? null : (
        <>
          <MindmapAutosave />
          <SaveMindmap />
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
        minZoom={0.1}
        disableKeyboardA11y
        nodes={renderedNodes}
        edges={edges}
        // disabling edge selection, node selection is enabled at the node level
        elementsSelectable={false}
        onNodesChange={handleNodeChange}
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
      >
        {/* Sparse and soft: the grid should register as paper texture at a
            glance and only resolve into dots when you look for it. */}
        <Background gap={28} size={1.5} />
      </ReactFlow>
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
  const initialGraph = useMemo(
    () => transformConvexNodesToFlowNodesAndEdges(nodes),
    [nodes]
  );
  const initialNodes = useMemo(
    () =>
      initialGraph.nodes.map((node) =>
        createBaseFlowNodeFromPartialBaseFlowNode(node as PartialBaseFlowNode)
      ),
    [initialGraph.nodes]
  );

  const initialEdges = useMemo(() => {
    return initialGraph.edges.map((edge) =>
      createFlowEdgeFromPartialBaseFlowEdge(edge as PartialBaseFlowEdge)
    );
  }, [initialGraph.edges]);

  return (
    <ReactFlowProvider>
      {/* This key remounts the prop-seeded store when client navigation loads another mindmap. */}
      <MindmapFlowProvider
        key={mindmapDB._id}
        readOnly={readOnly}
        mindmapDB={mindmapDB}
        initialNodes={initialNodes.length ? initialNodes : INITIAL_NODES}
        initialEdges={initialEdges.length ? initialEdges : INITIAL_EDGES}
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
