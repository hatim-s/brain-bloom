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

import { MindmapDB } from "@/types/Mindmap";
import { Stack } from "../ui/stack";
import { SaveMindmap } from "./components/SaveMindmap";
import { useMindmapNavigation } from "./hooks/useMindmapNavigation";
import { INITIAL_EDGES, INITIAL_NODES } from "./initialNodesAndEdges";
import { createFlowEdgeFromPartialBaseFlowEdge } from "./mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "./mindmap/createNode";
import {
  PartialBaseFlowEdge,
  PartialBaseFlowNode,
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

export function MindmapFlow() {
  const {
    nodes,
    edges,
    mindmapNodesMap,
    leveledNodes,
    activeNode,
    setActiveNode,
    selectedNode,
    aiEditNode,
    setSelectedNode,
    setAiEditNode,
    actions: {
      // onEdgesChange, onConnect,
      onNodesChange: originalOnNodesChange,
      onAddNode,
    },
  } = useMindmapFlow();

  useMindmapNavigation({
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
      setSelectedNode(_node.id);
    },
    [setSelectedNode]
  );

  const handlePaneClick = useCallback(() => {
    setActiveNode(null);
    setSelectedNode(null);
    setAiEditNode(null);
  }, [setActiveNode, setSelectedNode, setAiEditNode]);

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
      <SaveMindmap />
      <ReactFlow
        nodesDraggable={false}
        minZoom={0.1}
        disableKeyboardA11y
        nodes={nodes}
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
        <Background gap={20} />
      </ReactFlow>
    </Stack>
  );
}

export default function Flow({ mindmap: mindmapDB }: { mindmap: MindmapDB }) {
  const initialNodes = useMemo(
    () =>
      mindmapDB.nodes.map((node) =>
        createBaseFlowNodeFromPartialBaseFlowNode(node as PartialBaseFlowNode)
      ),
    [mindmapDB.nodes]
  );

  const initialEdges = useMemo(() => {
    return mindmapDB.edges.map((edge) =>
      createFlowEdgeFromPartialBaseFlowEdge(edge as PartialBaseFlowEdge)
    );
  }, [mindmapDB.edges]);

  return (
    <ReactFlowProvider>
      <MindmapFlowProvider
        mindmapDB={mindmapDB}
        initialNodes={initialNodes.length ? initialNodes : INITIAL_NODES}
        initialEdges={initialEdges.length ? initialEdges : INITIAL_EDGES}
      >
        <MindmapFlow />
      </MindmapFlowProvider>
    </ReactFlowProvider>
  );
}
