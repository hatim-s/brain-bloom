export type NodeSnapshot = {
  nodeId: string;
  parentId: string | null;
  type: "root" | "left" | "right";
  title: string;
  description?: string;
  order: number;
};

export type NodeUpdatePatch = Partial<
  Pick<NodeSnapshot, "title" | "description" | "parentId" | "order">
>;

export type NodeOp =
  | { kind: "create"; node: NodeSnapshot }
  | { kind: "update"; nodeId: string; patch: NodeUpdatePatch }
  | { kind: "delete"; nodeId: string };

/**
 * Computes the reverse-ordered operations that restore a batch's pre-image.
 */
export function invertOps(
  ops: NodeOp[],
  preImage: Map<string, NodeSnapshot>
): NodeOp[] {
  const evolvingState = new Map<string, NodeSnapshot>();
  const inverses: NodeOp[] = [];

  preImage.forEach((node, nodeId) => {
    evolvingState.set(nodeId, { ...node });
  });

  for (const op of ops) {
    if (op.kind === "create") {
      evolvingState.set(op.node.nodeId, { ...op.node });
      inverses.push({ kind: "delete", nodeId: op.node.nodeId });
      continue;
    }

    const existingNode = evolvingState.get(op.nodeId);

    if (existingNode === undefined) {
      throw new Error("Unknown node");
    }

    if (op.kind === "update") {
      const inversePatch: NodeUpdatePatch = {};

      // Object.keys preserves field presence, including an explicit undefined
      // description used to remove that optional value.
      for (const field of Object.keys(op.patch) as Array<
        keyof NodeUpdatePatch
      >) {
        Object.assign(inversePatch, { [field]: existingNode[field] });
      }

      inverses.push({
        kind: "update",
        nodeId: op.nodeId,
        patch: inversePatch,
      });
      evolvingState.set(op.nodeId, { ...existingNode, ...op.patch });
      continue;
    }

    inverses.push({ kind: "create", node: { ...existingNode } });
    evolvingState.delete(op.nodeId);
  }

  return inverses.reverse();
}
