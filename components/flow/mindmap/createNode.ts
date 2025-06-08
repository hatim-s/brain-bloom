import { Position } from "@xyflow/react";

import { ROOT_NODE_ID } from "../const";
import { BaseFlowNode, NodeTypes } from "../types";

const NODE_ID_SEPARATOR = "-";
const LEFT_NODE_ID_PREFIX = "l";
const RIGHT_NODE_ID_PREFIX = "r";

export function getNewNodeID(type: NodeTypes) {
  return [
    type === NodeTypes.LEFT ? LEFT_NODE_ID_PREFIX : RIGHT_NODE_ID_PREFIX,
    Math.random().toString(36).substring(2, 7),
  ].join(NODE_ID_SEPARATOR); // need 5 characters for node id
}

export function getNodeTypeFromId(id: string) {
  if (id === ROOT_NODE_ID) {
    return NodeTypes.ROOT;
  } else if (id.startsWith(LEFT_NODE_ID_PREFIX)) {
    return NodeTypes.LEFT;
  } else if (id.startsWith(RIGHT_NODE_ID_PREFIX)) {
    return NodeTypes.RIGHT;
  }
  return null;
}

export function createNode(
  type: NodeTypes.LEFT | NodeTypes.RIGHT,
  title: string,
  parentId: string
): BaseFlowNode {
  return {
    id: getNewNodeID(type),
    type: type,
    data: { title: title },
    selectable: true,
    parentId: parentId,
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
  };
}
