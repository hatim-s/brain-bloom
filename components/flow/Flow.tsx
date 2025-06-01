"use client";

import React, { useState } from "react";
import {
  Background,
  NodeTypes as XYNodeTypes,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Stack } from "../ui/stack";
import { LeftNode, RootNode, RightNode } from "./nodes";
import {
  MindmapFlowProvider,
  useMindmapFlow,
} from "./providers/MindmapFlowProvider";
import { Button } from "../ui/button";
import { NodeTypes } from "./types";
import { INITIAL_EDGES, INITIAL_NODES } from "./initialNodesAndEdges";

const nodeTypes: XYNodeTypes = {
  root: RootNode,
  left: LeftNode,
  right: RightNode,
};

export function MindmapFlow() {
  const {
    nodes,
    edges,
    // actions: { onNodesChange, onEdgesChange, onConnect },
    actions: { onAddNode },
  } = useMindmapFlow();

  const [leftCount, setLeftCount] = useState(0);
  const [rightCount, setRightCount] = useState(0);

  return (
    <Stack className="h-full w-full flex-1">
      <Button
        className="absolute top-20 left-10 z-10"
        onClick={() => {
          setLeftCount((prev) => prev + 1);
          onAddNode(NodeTypes.LEFT, `left-${Math.floor(leftCount / 3) + 1}`);
        }}
      >
        add left node
      </Button>
      <Button
        className="absolute top-20 left-52 z-10"
        onClick={() => {
          setRightCount((prev) => prev + 1);
          onAddNode(NodeTypes.RIGHT, `right-${Math.floor(rightCount / 3) + 1}`);
        }}
      >
        add right node
      </Button>
      <ReactFlow
        nodesDraggable={false}
        nodes={nodes}
        edges={edges}
        // onNodesChange={onNodesChange}
        // onEdgesChange={onEdgesChange}
        // onConnect={onConnect}
        panOnDrag={false}
        panOnScroll
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
