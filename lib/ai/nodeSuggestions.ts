import type { GeneratedTreeNode } from "@/lib/ai/generatedTree";
import type { AIMindmap } from "@/types/AI";

/** Converts a generated nested suggestion tree into the legacy flat contract. */
function flattenSuggestions(
  nodes: GeneratedTreeNode[],
  activeNode: AIMindmap
): AIMindmap[] {
  let sequence = 0;
  const flattened: AIMindmap[] = [];

  /** Assigns internal relationship ids that are replaced by canvas ids later. */
  function visit(node: GeneratedTreeNode): string {
    sequence += 1;
    const nodeId = `suggestion-${sequence}`;
    const childrenNodes = node.children.map(visit);

    flattened.push({
      nodeId,
      title: node.title,
      description: node.description ?? null,
      link: node.link ?? null,
      childrenNodes,
    });

    return nodeId;
  }

  const childrenNodes = nodes.map(visit);

  return [
    {
      ...activeNode,
      nodeId: activeNode.nodeId,
      // Suggestions extend the selected branch; they must not erase siblings
      // already present in the canvas's flat tree.
      childrenNodes: [...(activeNode.childrenNodes ?? []), ...childrenNodes],
    },
    ...flattened,
  ];
}

export { flattenSuggestions };
