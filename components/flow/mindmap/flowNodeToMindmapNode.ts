import {
  BaseFlowNode,
  FlowEdge,
  FlowNode,
  MindmapNode,
  NodeTypes,
} from "../types";

export function createMindmapNodeFromFlowNode(
  node: FlowNode | BaseFlowNode, // using BaseFlowNode is okay, since we do not care about the node position
  parentNodeId: string | null,
  parentNodeLevel: number
): MindmapNode {
  if (node.type === NodeTypes.ROOT || parentNodeId === null) {
    return {
      id: node.id,
      type: NodeTypes.ROOT,
      data: node.data,
      parentId: null,
      level: 0,
      children: new Map(),
    };
  }

  return {
    id: node.id,
    type: node.type,
    data: node.data,
    parentId: parentNodeId,
    level: parentNodeLevel + 1,
    children: new Map(),
  };
}

export function addChildToMindmapNode(
  parent: MindmapNode,
  child: MindmapNode
): MindmapNode {
  // do not mutate the parent, create a new one
  const newParent = {
    ...parent,
    children: new Map(parent.children).set(child.id, child),
  };
  return newParent;
}

export function getParentNodeIdFromFlow(node: BaseFlowNode, edges: FlowEdge[]) {
  const edge = edges.find((e) => e.target === node.id);
  return edge?.source ?? null;
}

export function transformFlowNodesAndEdgesToMindmapNodes(
  nodes: FlowNode[],
  edges: FlowEdge[]
) {
  return nodes.reduce<Record<string, MindmapNode>>((acc, node) => {
    const parentNodeId = getParentNodeIdFromFlow(node, edges);
    acc[node.id] = createMindmapNodeFromFlowNode(
      node,
      parentNodeId,
      parentNodeId ? acc[parentNodeId].level : 0
    );

    // if the node has a parent, add it to the parent's children
    if (parentNodeId) {
      acc[parentNodeId] = addChildToMindmapNode(
        acc[parentNodeId],
        acc[node.id]
      );
    }
    return acc;
  }, {});
}
