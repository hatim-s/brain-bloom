"use client";

// eslint-disable-next-line simple-import-sort/imports -- prettier and eslint conflict
import "@xyflow/react/dist/style.css";
import "./flow.css";

import {
  Background,
  Node,
  ReactFlow,
  ReactFlowProvider,
  NodeTypes as XYNodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";

import { Stack } from "../ui/stack";
import { useMindmapNavigation } from "./hooks/useMindmapNavigation";
import { INITIAL_EDGES, INITIAL_NODES } from "./initialNodesAndEdges";
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
    setSelectedNode,
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
  }, [setActiveNode, setSelectedNode]);

  const prevActiveNode = useRef<string | null>(null);

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
  }, [activeNode, handleNodeChange]);

  return (
    <Stack className="h-full w-full flex-1">
      <ReactFlow
        nodesDraggable={false}
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
        panOnScroll={!selectedNode}
        zoomOnScroll={false}
        zoomOnPinch={!selectedNode}
        fitView
        nodeTypes={nodeTypes}
      >
        <Background />
      </ReactFlow>
    </Stack>
  );
}

export default function Flow() {
  return (
    <ReactFlowProvider>
      <MindmapFlowProvider
        initialNodes={INITIAL_NODES}
        initialEdges={INITIAL_EDGES}
      >
        <MindmapFlow />
      </MindmapFlowProvider>
    </ReactFlowProvider>
  );
}
