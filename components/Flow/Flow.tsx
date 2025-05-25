"use client";

import React, { useCallback, useMemo, useState } from "react";
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
import { layout, graphlib } from "@dagrejs/dagre";

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

// Initialize the graph with rank settings
const leftGraph = new graphlib.Graph({
  directed: true,
  compound: true, // Optional: for nested nodes
  multigraph: false,
});

const rightGraph = new graphlib.Graph({
  directed: true,
  compound: true, // Optional: for nested nodes
  multigraph: false,
});

// Set rank direction and spacing
leftGraph.setGraph({
  rankdir: "RL", // Left-to-right layout
  ranksep: 100, // 100px between ranks
  nodesep: 30, // 30px between nodes in the same rank
});

rightGraph.setGraph({
  rankdir: "LR", // Left-to-right layout
  ranksep: 100, // 100px between ranks
  nodesep: 30, // 30px between nodes in the same rank
});

// Default to assigning a new object as a label for each new edge.
leftGraph.setDefaultEdgeLabel(function () {
  return {};
});

rightGraph.setDefaultEdgeLabel(function () {
  return {};
});

// Add nodes to the graph. The first argument is the node id. The second is
// metadata about the node. In this case we're going to add labels to each of
// our nodes.
initialNodes.forEach((node) => {
  if (node.type === "left") {
    leftGraph.setNode(node.id, { ...node.data, height: 30, width: 300 });
  } else {
    rightGraph.setNode(node.id, { ...node.data, height: 30, width: 300 });
  }
});

// Add edges to the graph.
initialEdges.forEach((edge) => {
  if (edge.source === "root") {
    leftGraph.setEdge(edge.source, edge.target);
  } else {
    rightGraph.setEdge(edge.source, edge.target);
  }
});

layout(leftGraph); // Assigns ranks and positions
layout(rightGraph); // Assigns ranks and positions

const initialNodesWithPositions = initialNodes.map((node) => {
  const nodeWithPosition =
    node.type === "left" ? leftGraph.node(node.id) : rightGraph.node(node.id);
  return {
    ...node,
    position: { x: nodeWithPosition.x, y: nodeWithPosition.y },
  };
});

export default function Flow() {
  const [nodes, setNodes] = useState(initialNodesWithPositions);
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
