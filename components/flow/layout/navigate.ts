import { ROOT_NODE_ID } from "../const";
import { MindmapNode, NodeTypes } from "../types";

export enum Operation {
  UP = "up",
  DOWN = "down",
  LEFT = "left",
  RIGHT = "right",
}

function goToParent(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>
) {
  if (currentNode.parentId) return nodesMap[currentNode.parentId];
  return currentNode;
}

function goToFirstChild(currentNode: MindmapNode) {
  const firstChildId = currentNode.children.keys().next().value;
  if (firstChildId)
    return currentNode.children.get(firstChildId) ?? currentNode;
  return currentNode;
}

function goToFirstRootChild(
  nodesMap: Record<string, MindmapNode>,
  childType: NodeTypes.LEFT | NodeTypes.RIGHT
) {
  const rootChildren = nodesMap[ROOT_NODE_ID].children.keys().toArray();

  // filter out the children in the other direction, only keep the ones that are of the same type
  const filteredChildren = rootChildren.filter(
    (childId) => nodesMap[childId].type === childType
  );
  if (filteredChildren.length === 0) return nodesMap[ROOT_NODE_ID];

  return nodesMap[filteredChildren[0]];
}

function getPreviousSiblingId(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>
) {
  const parentId = currentNode.parentId;
  if (!parentId) return null;

  const parentNode = nodesMap[parentId];
  if (!parentNode) return null;

  const siblings = parentNode.children.keys().toArray();
  const currentIndex = siblings.indexOf(currentNode.id);

  if (currentIndex === -1 || currentIndex === 0) return null;
  return siblings[currentIndex - 1];
}

function getNextSiblingId(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>
) {
  const parentId = currentNode.parentId;
  if (!parentId) return null;

  const parentNode = nodesMap[parentId];
  if (!parentNode) return null;

  const siblings = parentNode.children.keys().toArray();
  const currentIndex = siblings.indexOf(currentNode.id);

  if (currentIndex === -1 || currentIndex === siblings.length - 1) return null;
  return siblings[currentIndex + 1];
}

function goToSibiling(
  currentNode: MindmapNode,
  siblingId: string,
  nodesMap: Record<string, MindmapNode>
) {
  const siblingNode = nodesMap[siblingId];
  if (!siblingNode) return currentNode;

  return siblingNode;
}

function moveLeft(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>
) {
  // if the node is a right node, moving left will go to the parent
  if (currentNode.type === NodeTypes.RIGHT) {
    return goToParent(currentNode, nodesMap);
  }

  // if the node is a left node, moving left will go to the first child
  if (currentNode.type === NodeTypes.LEFT) {
    return goToFirstChild(currentNode);
  }

  // if the node is a root node, moving left will go to the first child of the same type
  if (currentNode.type === NodeTypes.ROOT) {
    return goToFirstRootChild(nodesMap, NodeTypes.LEFT);
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
    return goToParent(currentNode, nodesMap);
  }

  // if the node is a right node, moving right will go to the first child
  if (currentNode.type === NodeTypes.RIGHT) {
    return goToFirstChild(currentNode);
  }

  // if the node is a root node, moving right will go to the first child of the same type
  if (currentNode.type === NodeTypes.ROOT) {
    return goToFirstRootChild(nodesMap, NodeTypes.RIGHT);
  }

  // fallback cases, do nothing
  return currentNode;
}

function moveUp(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>
) {
  // if node is a root node, do nothing for now
  if (currentNode.type === NodeTypes.ROOT) {
    return currentNode;
  }

  // for left and right nodes, moving up will go the previous sibling
  if (
    currentNode.type === NodeTypes.LEFT ||
    currentNode.type === NodeTypes.RIGHT
  ) {
    const previousSiblingId = getPreviousSiblingId(currentNode, nodesMap);
    if (previousSiblingId)
      return goToSibiling(currentNode, previousSiblingId, nodesMap);
  }

  // fallback cases, do nothing
  return currentNode;
}

function moveDown(
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>
) {
  // if node is a root node, do nothing for now
  if (currentNode.type === NodeTypes.ROOT) {
    return currentNode;
  }

  // for left and right nodes, moving down will go the next sibling
  if (
    currentNode.type === NodeTypes.LEFT ||
    currentNode.type === NodeTypes.RIGHT
  ) {
    const nextSiblingId = getNextSiblingId(currentNode, nodesMap);
    if (nextSiblingId)
      return goToSibiling(currentNode, nextSiblingId, nodesMap);
  }

  // fallback cases, do nothing
  return currentNode;
}

export function navigate(
  operation: Operation,
  currentNode: MindmapNode,
  nodesMap: Record<string, MindmapNode>
) {
  switch (operation) {
    case Operation.UP:
      return moveUp(currentNode, nodesMap);
    case Operation.DOWN:
      return moveDown(currentNode, nodesMap);
    case Operation.LEFT:
      return moveLeft(currentNode, nodesMap);
    case Operation.RIGHT:
      return moveRight(currentNode, nodesMap);
    default:
      return currentNode;
  }
}
