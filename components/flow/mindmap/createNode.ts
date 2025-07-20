import { Position } from "@xyflow/react";

import { ROOT_NODE_ID } from "../const";
import { BaseFlowNode, FlowNode, NodeTypes } from "../types";
import { PartialBaseFlowNode } from "./mindmapNodesToFlowNodes";

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

export function getNodeSourceHandles(
  type: NodeTypes
): Pick<FlowNode, "handles" | "sourcePosition" | "targetPosition"> | null {
  if (type === NodeTypes.ROOT) {
    return {
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
    };
  }

  if (type === NodeTypes.LEFT) {
    return {
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

  if (type === NodeTypes.RIGHT) {
    return {
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
    };
  }

  return null;
}

function getAdditionalBaseFlowNodeProps(): Pick<BaseFlowNode, "selectable"> {
  return {
    selectable: true,
  };
}

export function createNode(
  type: NodeTypes.LEFT | NodeTypes.RIGHT,
  title: string,
  id?: string,
  data?: FlowNode["data"]
): BaseFlowNode {
  return {
    id: id ?? getNewNodeID(type),
    type: type,
    data: { title: title, ...data },
    ...getAdditionalBaseFlowNodeProps(),
    ...getNodeSourceHandles(type),
  };
}

export function createBaseFlowNodeFromPartialBaseFlowNode(
  node: PartialBaseFlowNode
): BaseFlowNode {
  return {
    ...node,
    ...getAdditionalBaseFlowNodeProps(),
    ...getNodeSourceHandles(node.type),
  };
}
