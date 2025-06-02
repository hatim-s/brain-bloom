import { Edge, Position } from "@xyflow/react";
import { BaseFlowNode, NodeTypes } from "./types";
import { getNewNodeID } from "./mindmap/createNode";
import { ROOT_NODE_ID } from "./const";
import { getNewEdgeID } from "./mindmap/createEdge";

// const LEFT_NODE_1 = getNewNodeID(NodeTypes.LEFT);
// const LEFT_NODE_2 = getNewNodeID(NodeTypes.LEFT);
// const RIGHT_NODE_1 = getNewNodeID(NodeTypes.RIGHT);
// const RIGHT_NODE_2 = getNewNodeID(NodeTypes.RIGHT);

// temp for testing, will need to generate randomly again
// once we add active node id support
const LEFT_NODE_1 = "left-1";
const LEFT_NODE_2 = "left-2";
const RIGHT_NODE_1 = "right-1";
const RIGHT_NODE_2 = "right-2";

export const INITIAL_NODES: BaseFlowNode[] = [
  {
    id: ROOT_NODE_ID,
    type: NodeTypes.ROOT,
    data: { title: "Root Node" },
    selectable: true,
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
    id: LEFT_NODE_1,
    type: NodeTypes.LEFT,
    data: { title: "Left Node - 1" },
    selectable: true,
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
    id: LEFT_NODE_2,
    type: NodeTypes.LEFT,
    data: { title: "Left Node - 2" },
    selectable: true,
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
    id: RIGHT_NODE_1,
    type: NodeTypes.RIGHT,
    data: { title: "Right Node - 1" },
    selectable: true,
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
    id: RIGHT_NODE_2,
    type: NodeTypes.RIGHT,
    data: { title: "Right Node - 2" },
    selectable: true,
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

export const INITIAL_EDGES: Edge[] = [
  {
    id: getNewEdgeID(ROOT_NODE_ID, LEFT_NODE_1),
    source: ROOT_NODE_ID,
    target: LEFT_NODE_1,
    sourceHandle: "root-left",
  },
  {
    id: getNewEdgeID(ROOT_NODE_ID, LEFT_NODE_2),
    source: ROOT_NODE_ID,
    target: LEFT_NODE_2,
    sourceHandle: "root-left",
  },
  {
    id: getNewEdgeID(ROOT_NODE_ID, RIGHT_NODE_1),
    source: ROOT_NODE_ID,
    target: RIGHT_NODE_1,
    sourceHandle: "root-right",
  },
  {
    id: getNewEdgeID(ROOT_NODE_ID, RIGHT_NODE_2),
    source: ROOT_NODE_ID,
    target: RIGHT_NODE_2,
    sourceHandle: "root-right",
  },
];
