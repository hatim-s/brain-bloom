"use client";

import React, { useCallback, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Edge,
  Node,
  NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProps,
  // useEdgesState,
  // useNodesState,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import { Stack } from "../ui/stack";
import { LeftNode, RootNode, RightNode } from "./nodes";

const nodeTypes: NodeTypes = {
  root: RootNode,
  left: LeftNode,
  right: RightNode,
};

const initialNodes: Node[] = [
  {
    id: "root",
    type: "root",
    data: { title: "Root Node" },
    position: { x: 0, y: 0 },
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
    position: { x: -500, y: 100 },
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
    position: { x: -500, y: -100 },
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
    position: { x: 500, y: 100 },
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
    position: { x: 500, y: -100 },
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

export default function Flow() {
  // const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  // const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  const onNodesChange = useCallback<
    NonNullable<ReactFlowProps["onNodesChange"]>
  >((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), [setNodes]);

  const onEdgesChange = useCallback<
    NonNullable<ReactFlowProps["onEdgesChange"]>
  >((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [setEdges]);

  const onConnect = useCallback<NonNullable<ReactFlowProps["onConnect"]>>(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  return (
    <Stack className="h-full w-full flex-1">
      <ReactFlow
        nodesDraggable={false}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
