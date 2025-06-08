import { BaseFlowNode, FlowNode, MindmapNode, NodeTypes } from "../types";

export function createMindmapNodeFromFlowNode(
  node: FlowNode | BaseFlowNode // using BaseFlowNode is okay, since we do not care about the node position
): MindmapNode {
  if (node.type === NodeTypes.ROOT) {
    return {
      id: node.id,
      parentId: null,
      type: NodeTypes.ROOT,
      data: node.data,
      children: new Map(),
    };
  }

  return {
    id: node.id,
    parentId: node.parentId,
    type: node.type,
    data: node.data,
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
