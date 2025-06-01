"use client";

import React, { useState } from "react";
import {
  Background,
  Edge,
  NodeTypes,
  Position,
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
import { BaseFlowNode } from "./types";

const nodeTypes: NodeTypes = {
  root: RootNode,
  left: LeftNode,
  right: RightNode,
};

const initialNodes: BaseFlowNode[] = [
  {
    id: "root",
    type: "root",
    data: { title: "Root Node" },
    handles: [
      {
        position: Position.Left,
        type: "source",
        x: 0,
        y: 0,
        id: "root-left",
      },
      {
        position: Position.Right,
        type: "source",
        x: 0,
        y: 0,
        id: "root-right",
      },
    ],
  },
  {
    id: "left-1",
    type: "left",
    data: { title: "Left Node - 1" },
    handles: [
      {
        position: Position.Left,
        type: "source",
        x: 0,
        y: 0,
      },
    ],
    sourcePosition: Position.Left,
    targetPosition: Position.Right,
  },
  {
    id: "left-2",
    type: "left",
    data: { title: "Left Node - 2" },
    handles: [
      {
        position: Position.Left,
        type: "source",
        x: 0,
        y: 0,
      },
    ],
    sourcePosition: Position.Left,
    targetPosition: Position.Right,
  },
  {
    id: "right-1",
    type: "right",
    data: { title: "Right Node - 1" },
    handles: [
      {
        position: Position.Right,
        type: "source",
        x: 0,
        y: 0,
      },
    ],
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
  {
    id: "right-2",
    type: "right",
    data: { title: "Right Node - 2" },
    handles: [
      {
        position: Position.Right,
        type: "source",
        x: 0,
        y: 0,
      },
    ],
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
];

const initialEdges: Edge[] = [
  {
    id: "e@root@left-1",
    source: "root",
    target: "left-1",
    sourceHandle: "root-left",
  },
  {
    id: "e@root@left-2",
    source: "root",
    target: "left-2",
    sourceHandle: "root-left",
  },
  {
    id: "e@root@right-1",
    source: "root",
    target: "right-1",
    sourceHandle: "root-right",
  },
  {
    id: "e@root@right-2",
    source: "root",
    target: "right-2",
    sourceHandle: "root-right",
  },
];

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
          console.log("add node");
          setLeftCount((prev) => prev + 1);
          onAddNode("left", `left-${Math.floor(leftCount / 3) + 1}`);
        }}
      >
        add left node
      </Button>
      <Button
        className="absolute top-20 left-52 z-10"
        onClick={() => {
          console.log("add node");
          setRightCount((prev) => prev + 1);
          onAddNode("right", `right-${Math.floor(rightCount / 3) + 1}`);
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
        initialNodes={initialNodes}
        initialEdges={initialEdges}
      >
        <MindmapFlow />
      </MindmapFlowProvider>
    </ReactFlowProvider>
  );
}
