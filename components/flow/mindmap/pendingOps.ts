import type { NodeSnapshot } from "@/convex/lib/nodeOps";

type PendingNodePatch = Partial<
  Pick<NodeSnapshot, "title" | "parentId" | "order" | "type">
> & {
  description?: string | null;
  link?: string | null;
};

type PendingOpSource = "user" | "ai";

/**
 * One queued node operation with the actor that originated the local change.
 */
type NodeOp = (
  | { kind: "create"; node: NodeSnapshot }
  | { kind: "update"; nodeId: string; patch: PendingNodePatch }
  | { kind: "delete"; nodeId: string }
) & { source: PendingOpSource };

/**
 * Appends one operation while collapsing adjacent, unflushed edits to one node.
 *
 * The watermark protects the prefix already captured by an in-flight flush.
 * Appending across it could mutate data that commit-by-count later removes.
 */
function appendPendingOp(
  queue: NodeOp[],
  op: NodeOp,
  flushedWatermark = 0
): NodeOp[] {
  const previous = queue.at(-1);
  const previousIsProtected = queue.length <= flushedWatermark;

  if (
    op.kind !== "update" ||
    previous === undefined ||
    previousIsProtected ||
    previous.source !== op.source
  ) {
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

    return [
      ...queue.slice(0, -1),
      { kind: "create", node: nextNode, source: op.source },
    ];
  }

  return [...queue, op];
}

/** Produces the compact history description sent with one operation batch. */
function describePendingOps(ops: NodeOp[]): string {
  const nodeIdsByKind = {
    create: new Set<string>(),
    update: new Set<string>(),
    delete: new Set<string>(),
  };

  for (const op of ops) {
    nodeIdsByKind[op.kind].add(
      op.kind === "create" ? op.node.nodeId : op.nodeId
    );
  }

  const counts = {
    create: nodeIdsByKind.create.size,
    update: nodeIdsByKind.update.size,
    delete: nodeIdsByKind.delete.size,
  };
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
  type PendingOpSource,
};
