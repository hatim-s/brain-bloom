import { ROOT_NODE_ID } from "../const";
import { MindmapNode, NodeTypes } from "../types";

export enum Operation {
  UP = "up",
  DOWN = "down",
  LEFT = "left",
  RIGHT = "right",
}

function getFirstChildId(childNode: MindmapNode): string | null {
  const children = Array.from(childNode.children.keys());
  return children[0] ?? null;
}

function getFirstRootChildId(
  nodesMap: Record<string, MindmapNode>,
  childType: NodeTypes.LEFT | NodeTypes.RIGHT
): string | null {
  const rootChildren = nodesMap[ROOT_NODE_ID].children.keys().toArray();

  // filter out the children in the other direction, only keep the ones that are of the same type
  const filteredChildren = rootChildren.filter(
    (childId) => nodesMap[childId].type === childType
  );

  if (filteredChildren.length === 0) return null;
  return nodesMap[filteredChildren[0]].id;
}

function getSiblingId(
  currentNode: MindmapNode,
  leveledNodes: MindmapNode[][],
  type: "prev" | "next"
) {
  let childLevelNodes = leveledNodes[currentNode.level] ?? [];

  /**
   * We need to filter out nodes in level 1 by type, since these include both
   * left and right nodes.
   *
   * This is because a left node cannot be the sibling of a right node, and vice versa.
   */
  if (currentNode.level === 1) {
    childLevelNodes = childLevelNodes.filter(
      (node) => node.type === currentNode.type
    );
  }

  const currentNodeIndex = childLevelNodes.findIndex(
    (node) => node.id === currentNode.id
  );

  // if the node is missing in the array or the node itself is the last node
  if (currentNodeIndex === -1) return null;

  return (
    // return the index of the previous/next sibling node
    childLevelNodes[currentNodeIndex + (type === "prev" ? -1 : 1)]?.id ?? null
  );
}

function goToNode(
  currentNode: MindmapNode,
  nodeId: string,
  nodesMap: Record<string, MindmapNode>
) {
  const node = nodesMap[nodeId];
  return node ?? currentNode;
}

function moveLeft(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>
) {
  // if the node is a right node, moving left will go to the parent
  if (currentNode.type === NodeTypes.RIGHT) {
    const parentNodeId = currentNode.parentId as string;
    return goToNode(currentNode, parentNodeId, nodesMap);
  }

  // if the node is a left node, moving left will go to the first child
  if (currentNode.type === NodeTypes.LEFT) {
    const firstChildId = getFirstChildId(currentNode);
    if (firstChildId) return goToNode(currentNode, firstChildId, nodesMap);
  }

  // if the node is a root node, moving left will go to the first child of the same type
  if (currentNode.type === NodeTypes.ROOT) {
    const firstRootChildId = getFirstRootChildId(nodesMap, NodeTypes.LEFT);
    if (firstRootChildId)
      return goToNode(currentNode, firstRootChildId, nodesMap);
  }

  // fallback cases, do nothing
  return currentNode;
}

function moveRight(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>
) {
  // if the node is a left node, moving right will go to the parent
  if (currentNode.type === NodeTypes.LEFT) {
    const parentNodeId = currentNode.parentId as string;
    return goToNode(currentNode, parentNodeId, nodesMap);
  }

  // if the node is a right node, moving right will go to the first child
  if (currentNode.type === NodeTypes.RIGHT) {
    const firstChildId = getFirstChildId(currentNode);
    if (firstChildId) return goToNode(currentNode, firstChildId, nodesMap);
  }

  // if the node is a root node, moving right will go to the first child of the same type
  if (currentNode.type === NodeTypes.ROOT) {
    const firstRootChildId = getFirstRootChildId(nodesMap, NodeTypes.RIGHT);
    if (firstRootChildId)
      return goToNode(currentNode, firstRootChildId, nodesMap);
  }

  // fallback cases, do nothing
  return currentNode;
}

function moveUp(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>,
  leveledNodes: MindmapNode[][]
) {
  // if node is a root node, do nothing for now
  if (currentNode.type === NodeTypes.ROOT) {
    return currentNode;
  }

  // for left and right nodes, moving up will go the previous sibling
  const prevSiblingId = getSiblingId(currentNode, leveledNodes, "prev");
  if (prevSiblingId) return goToNode(currentNode, prevSiblingId, nodesMap);

  // fallback cases, do nothing
  return currentNode;
}

function moveDown(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>,
  leveledNodes: MindmapNode[][]
) {
  // if node is a root node, do nothing for now
  if (currentNode.type === NodeTypes.ROOT) {
    return currentNode;
  }

  // for left and right nodes, moving down will go the next sibling
  const nextSiblingId = getSiblingId(currentNode, leveledNodes, "next");
  if (nextSiblingId) return goToNode(currentNode, nextSiblingId, nodesMap);

  // fallback cases, do nothing
  return currentNode;
}

export function navigate(
  operation: Operation,
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>,
  leveledNodes: MindmapNode[][]
) {
  switch (operation) {
    case Operation.UP:
      return moveUp(currentNode, nodesMap, leveledNodes);
    case Operation.DOWN:
      return moveDown(currentNode, nodesMap, leveledNodes);
    case Operation.LEFT:
      return moveLeft(currentNode, nodesMap);
    case Operation.RIGHT:
      return moveRight(currentNode, nodesMap);
    default:
      return currentNode;
  }
}
