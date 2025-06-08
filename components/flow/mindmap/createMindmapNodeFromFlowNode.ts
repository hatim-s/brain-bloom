import {
  BaseFlowNode,
  FlowEdge,
  FlowNode,
  MindmapNode,
  NodeTypes,
} from "../types";

export function createMindmapNodeFromFlowNode(
  node: FlowNode | BaseFlowNode, // using BaseFlowNode is okay, since we do not care about the node position
  parentNodeId: string | null
): MindmapNode {
  if (node.type === NodeTypes.ROOT || parentNodeId === null) {
    return {
      id: node.id,
      parentId: null,
      type: NodeTypes.ROOT,
      children: new Map(),
    };
  }

  return {
    id: node.id,
    parentId: parentNodeId,
    type: node.type,
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

export function getParentNodeIdFromFLow(node: BaseFlowNode, edges: FlowEdge[]) {
  const edge = edges.find((e) => e.target === node.id);
  return edge?.source ?? null;
}
