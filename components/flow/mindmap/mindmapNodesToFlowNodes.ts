import pick from "lodash/pick";

import { ROOT_NODE_ID } from "../const";
import { BaseFlowNode, FlowEdge, MindmapNode } from "../types";
import { createEdge } from "./createEdge";

export type PartialBaseFlowNode = Pick<BaseFlowNode, "id" | "type" | "data">;

export type PartialBaseFlowEdge = Pick<FlowEdge, "id" | "source" | "target">;

function createFlowNodeFromMindmapNode(
  mindmapNode: MindmapNode
): PartialBaseFlowNode {
  return pick(mindmapNode, ["id", "type", "data"]);
}

function dfsHelper(
  node: MindmapNode,
  mindmapNodes: Record<string, MindmapNode>,
  nodesAcc: PartialBaseFlowNode[],
  edgesAcc: FlowEdge[]
) {
  nodesAcc.push(createFlowNodeFromMindmapNode(node));

  if (node.children.size > 0) {
    node.children.forEach((child) => {
      edgesAcc.push(createEdge(node.id, child.id));
      const childNode = mindmapNodes[child.id];
      dfsHelper(childNode, mindmapNodes, nodesAcc, edgesAcc);
    });
  }
}

export function transformMindmapNodesToFlowNodesAndEdges(
  mindmapNodes: Record<string, MindmapNode>
) {
  const flowNodes: PartialBaseFlowNode[] = [];
  const flowEdges: FlowEdge[] = [];

  const rootMindmapNode = mindmapNodes[ROOT_NODE_ID];
  dfsHelper(rootMindmapNode, mindmapNodes, flowNodes, flowEdges);

  return {
    nodes: flowNodes,
    edges: flowEdges,
  };
}
