import { ROOT_NODE_ID } from "../const";
import { FlowEdge, NodeTypes } from "../types";
import { getNodeTypeFromId } from "./createNode";
import { PartialBaseFlowEdge } from "./mindmapNodesToFlowNodes";

const EDGE_ID_PREFIX = "e";
const EDGE_ID_SEPARATOR = "@";

export const getNewEdgeID = (source: string, target: string) => {
  return [EDGE_ID_PREFIX, source, target].join(EDGE_ID_SEPARATOR);
};

function getEdgeSourceHandle(
  source: string,
  target: string
): Pick<FlowEdge, "sourceHandle"> | null {
  if (source === ROOT_NODE_ID) {
    const targetNodeType = getNodeTypeFromId(target);
    return {
      sourceHandle:
        targetNodeType === NodeTypes.LEFT ? "root-left" : "root-right",
    };
  }

  return null;
}

export function createEdge(source: string, target: string) {
  return {
    id: getNewEdgeID(source, target),
    source,
    target,
    ...getEdgeSourceHandle(source, target),
  };
}

export function createFlowEdgeFromPartialBaseFlowEdge(
  edge: PartialBaseFlowEdge
): FlowEdge {
  return {
    ...edge,
    ...getEdgeSourceHandle(edge.source, edge.target),
  };
}
