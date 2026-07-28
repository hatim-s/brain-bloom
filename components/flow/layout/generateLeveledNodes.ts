import { ROOT_NODE_ID } from "../const";
import { MindmapNode } from "../types";

/** Groups every reachable mindmap node into breadth-first levels. */
export function generateLeveledNodes(
  mindmapNodesMap: Record<string, MindmapNode>
): MindmapNode[][] {
  const rootNode = mindmapNodesMap[ROOT_NODE_ID];
  if (!rootNode) return [];

  const leveledNodes: MindmapNode[][] = [];
  let currentLevel = [rootNode];

  while (currentLevel.length > 0) {
    leveledNodes.push(currentLevel);
    const nextLevel: MindmapNode[] = [];

    for (const currentNode of currentLevel) {
      for (const childId of Array.from(currentNode.children.keys())) {
        const childNode = mindmapNodesMap[childId];
        if (childNode) {
          nextLevel.push(childNode);
        }
      }
    }

    currentLevel = nextLevel;
  }

  return leveledNodes;
}
