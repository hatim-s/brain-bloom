import pick from "lodash/pick";

import { MindmapNodeProjection } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { BaseFlowNode, FlowEdge, MindmapNode } from "../types";
import { createEdge } from "./createEdge";

type PartialBaseFlowNode = Pick<BaseFlowNode, "id" | "type" | "data">;

type PartialBaseFlowEdge = Pick<FlowEdge, "id" | "source" | "target">;

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

/**
 * Adapts sorted Convex node snapshots into the existing mindmap transform.
 */
function transformConvexNodesToFlowNodesAndEdges(
  snapshots: MindmapNodeProjection[]
) {
  const mindmapNodes = snapshots.reduce<Record<string, MindmapNode>>(
    (nodesById, snapshot) => {
      nodesById[snapshot.nodeId] = {
        id: snapshot.nodeId,
        type: snapshot.type,
        data: {
          title: snapshot.title,
          ...(snapshot.description === undefined
            ? {}
            : { description: snapshot.description }),
          ...(snapshot.link === undefined ? {} : { link: snapshot.link }),
        },
        parentId: snapshot.parentId,
        level: 0,
        children: new Map(),
      } as MindmapNode;
      return nodesById;
    },
    {}
  );

  // Build child maps after all nodes exist because parent-id sorting does not
  // guarantee that a non-root parent precedes every descendant globally.
  for (const snapshot of snapshots) {
    if (snapshot.parentId === null) continue;

    const parent = mindmapNodes[snapshot.parentId];
    const child = mindmapNodes[snapshot.nodeId];
    if (!parent || !child) continue;

    parent.children.set(child.id, child);
  }

  return transformMindmapNodesToFlowNodesAndEdges(mindmapNodes);
}

function transformMindmapNodesToFlowNodesAndEdges(
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

export {
  type PartialBaseFlowEdge,
  type PartialBaseFlowNode,
  transformConvexNodesToFlowNodesAndEdges,
  transformMindmapNodesToFlowNodesAndEdges,
};
