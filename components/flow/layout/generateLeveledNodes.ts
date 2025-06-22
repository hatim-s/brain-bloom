import { ROOT_NODE_ID } from "../const";
import { MindmapNode } from "../types";

export function generateLeveledNodes(
  mindmapNodesMap: Record<string, MindmapNode>
): MindmapNode[][] {
  const queue: (MindmapNode | null)[] = [mindmapNodesMap[ROOT_NODE_ID], null];

  const leveledNodes: MindmapNode[][] = [[]];

  while (queue.length > 0) {
    const currentNode = queue.shift();
    if (!currentNode) {
      // we have reached the end of the current level
      // and we use `null` to indicate the end of the current level
      leveledNodes.push([]);

      if (queue.length === 0) {
        // we have reached the end of the last level
        break;
      }

      // else we put a `null` to indicate the end of the current level
      queue.push(null);
      continue;
    }

    const children = Array.from(currentNode.children.keys());

    queue.push(...children.map((childId) => mindmapNodesMap[childId]));
    leveledNodes[leveledNodes.length - 1].push(currentNode);
  }

  return leveledNodes;
}
