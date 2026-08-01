import { ROOT_NODE_ID } from "../const";
import { FlowEdge, NodeTypes } from "../types";
import { getNodeTypeFromId } from "./createNode";
import { PartialBaseFlowEdge } from "./mindmapNodesToFlowNodes";

const EDGE_ID_PREFIX = "e";
const EDGE_ID_SEPARATOR = "@";

/**
 * Every mindmap edge is a stem.
 *
 * Registered in `Flow.tsx` as `edgeTypes.stem`. This is presentation only — the
 * Convex node projection has no edge rows, so nothing about the persisted data
 * model changes.
 */
const STEM_EDGE_TYPE = "stem";

const getNewEdgeID = (source: string, target: string) => {
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

function createEdge(source: string, target: string): FlowEdge {
  return {
    id: getNewEdgeID(source, target),
    source,
    target,
    type: STEM_EDGE_TYPE,
    ...getEdgeSourceHandle(source, target),
  };
}

function createFlowEdgeFromPartialBaseFlowEdge(
  edge: PartialBaseFlowEdge
): FlowEdge {
  return {
    ...edge,
    type: STEM_EDGE_TYPE,
    ...getEdgeSourceHandle(edge.source, edge.target),
  };
}

export {
  createEdge,
  createFlowEdgeFromPartialBaseFlowEdge,
  getNewEdgeID,
  STEM_EDGE_TYPE,
};
