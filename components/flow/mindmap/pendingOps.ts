import type { NodeSnapshot } from "@/convex/lib/nodeOps";

type PendingNodePatch = Partial<
  Pick<NodeSnapshot, "title" | "parentId" | "order" | "type">
> & {
  description?: string | null;
  link?: string | null;
};

type NodeOp =
  | { kind: "create"; node: NodeSnapshot }
  | { kind: "update"; nodeId: string; patch: PendingNodePatch }
  | { kind: "delete"; nodeId: string };

/**
 * Appends one wire operation while collapsing adjacent edits to one node.
 */
function appendPendingOp(queue: NodeOp[], op: NodeOp): NodeOp[] {
  const previous = queue.at(-1);

  if (op.kind !== "update" || previous === undefined) {
    return [...queue, op];
  }

  if (previous.kind === "update" && previous.nodeId === op.nodeId) {
    return [
      ...queue.slice(0, -1),
      { ...previous, patch: { ...previous.patch, ...op.patch } },
    ];
  }

  if (previous.kind === "create" && previous.node.nodeId === op.nodeId) {
    const nextNode = { ...previous.node };

    // Null is a wire-only removal sentinel. A not-yet-persisted create can
    // represent the same result by omitting the optional field entirely.
    for (const [field, value] of Object.entries(op.patch) as Array<
      [keyof PendingNodePatch, PendingNodePatch[keyof PendingNodePatch]]
    >) {
      if ((field === "description" || field === "link") && value === null) {
        delete nextNode[field];
      } else {
        Object.assign(nextNode, { [field]: value });
      }
    }

    return [...queue.slice(0, -1), { kind: "create", node: nextNode }];
  }

  return [...queue, op];
}

/** Produces the compact history description sent with one operation batch. */
function describePendingOps(ops: NodeOp[]): string {
  const counts = ops.reduce(
    (summary, op) => ({ ...summary, [op.kind]: summary[op.kind] + 1 }),
    { create: 0, update: 0, delete: 0 }
  );
  const descriptions = [
    counts.create > 0
      ? `Added ${counts.create} ${counts.create === 1 ? "node" : "nodes"}`
      : null,
    counts.update > 0
      ? `Edited ${counts.update} ${counts.update === 1 ? "node" : "nodes"}`
      : null,
    counts.delete > 0
      ? `Deleted ${counts.delete} ${counts.delete === 1 ? "node" : "nodes"}`
      : null,
  ].filter((description): description is string => description !== null);

  return descriptions.join(", ");
}

export {
  appendPendingOp,
  describePendingOps,
  type NodeOp,
  type PendingNodePatch,
};
