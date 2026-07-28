import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireOwner, requireReadable } from "./lib/access";
import {
  invertOps,
  type NodeOp,
  type NodeSnapshot,
  type NodeUpdatePatch,
} from "./lib/nodeOps";

type MutableNodeState = {
  documentId?: Id<"nodes">;
  snapshot: NodeSnapshot;
};

const UPDATE_FIELDS = new Set([
  "title",
  "description",
  "parentId",
  "order",
  "type",
]);

/**
 * Throws a consistently prefixed validation error for an operation batch.
 */
function invalidOp(reason: string): never {
  throw new Error(`Invalid op: ${reason}`);
}

/**
 * Determines whether an opaque Convex value can be inspected as an object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses and validates the runtime shape of a node snapshot.
 */
function parseSnapshot(value: unknown): NodeSnapshot {
  if (!isRecord(value)) {
    return invalidOp("invalid node");
  }

  if (
    typeof value.nodeId !== "string" ||
    (typeof value.parentId !== "string" && value.parentId !== null) ||
    (value.type !== "root" &&
      value.type !== "left" &&
      value.type !== "right") ||
    typeof value.title !== "string" ||
    (value.description !== undefined &&
      typeof value.description !== "string") ||
    typeof value.order !== "number"
  ) {
    return invalidOp("invalid node");
  }

  return {
    nodeId: value.nodeId,
    parentId: value.parentId,
    type: value.type,
    title: value.title,
    ...(value.description === undefined
      ? {}
      : { description: value.description }),
    order: value.order,
  };
}

/**
 * Parses the supported fields of an update patch from an opaque value.
 */
function parseUpdatePatch(value: unknown): NodeUpdatePatch {
  if (!isRecord(value)) {
    return invalidOp("invalid update patch");
  }

  for (const field of Object.keys(value)) {
    if (!UPDATE_FIELDS.has(field)) {
      return invalidOp(`unsupported update field ${field}`);
    }
  }

  if (
    (value.title !== undefined && typeof value.title !== "string") ||
    (value.description !== undefined &&
      typeof value.description !== "string") ||
    (value.parentId !== undefined &&
      typeof value.parentId !== "string" &&
      value.parentId !== null) ||
    (value.order !== undefined && typeof value.order !== "number") ||
    (value.type !== undefined &&
      value.type !== "root" &&
      value.type !== "left" &&
      value.type !== "right")
  ) {
    return invalidOp("invalid update patch");
  }

  return { ...value } as NodeUpdatePatch;
}

/**
 * Parses the public v.any operation argument into the supported algebra.
 */
function parseOps(value: unknown): NodeOp[] {
  if (!Array.isArray(value)) {
    return invalidOp("ops must be an array");
  }

  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      return invalidOp("invalid operation");
    }

    if (candidate.kind === "create") {
      return { kind: "create", node: parseSnapshot(candidate.node) };
    }

    if (
      (candidate.kind === "update" || candidate.kind === "delete") &&
      typeof candidate.nodeId !== "string"
    ) {
      return invalidOp("invalid operation");
    }

    if (candidate.kind === "update") {
      return {
        kind: "update",
        nodeId: candidate.nodeId as string,
        patch: parseUpdatePatch(candidate.patch),
      };
    }

    if (candidate.kind === "delete") {
      return { kind: "delete", nodeId: candidate.nodeId as string };
    }

    return invalidOp("unknown kind");
  });
}

/**
 * Converts a database node document into the transport-independent snapshot.
 */
function toSnapshot(node: Doc<"nodes">): NodeSnapshot {
  return {
    nodeId: node.nodeId,
    parentId: node.parentId,
    type: node.type,
    title: node.title,
    ...(node.description === undefined
      ? {}
      : { description: node.description }),
    order: node.order,
  };
}

/**
 * Validates a batch against the state produced by each preceding operation.
 */
async function validateOps(
  ctx: MutationCtx,
  mindmapId: Id<"mindmaps">,
  ops: NodeOp[]
): Promise<Map<string, NodeSnapshot>> {
  const referencedNodeIds = Array.from(
    new Set(ops.flatMap((op) => (op.kind === "create" ? [] : [op.nodeId])))
  );
  const referencedNodes = await Promise.all(
    referencedNodeIds.map((nodeId) =>
      ctx.db
        .query("nodes")
        .withIndex("by_mindmap_node", (q) =>
          q.eq("mindmapId", mindmapId).eq("nodeId", nodeId)
        )
        .unique()
    )
  );
  const existingNodes = await ctx.db
    .query("nodes")
    .withIndex("by_mindmap", (q) => q.eq("mindmapId", mindmapId))
    .collect();
  const state = new Map<string, MutableNodeState>(
    existingNodes.map((node) => [
      node.nodeId,
      { documentId: node._id, snapshot: toSnapshot(node) },
    ])
  );
  const preImage = new Map(
    referencedNodes.flatMap((node) =>
      node === null ? [] : [[node.nodeId, toSnapshot(node)]]
    )
  );

  for (const op of ops) {
    if (op.kind === "create") {
      if (state.has(op.node.nodeId)) {
        invalidOp("node already exists");
      }

      if (op.node.type === "root") {
        invalidOp("cannot create root");
      }

      if (op.node.parentId === null || !state.has(op.node.parentId)) {
        invalidOp("parent does not exist");
      }

      state.set(op.node.nodeId, { snapshot: { ...op.node } });
      continue;
    }

    const existing = state.get(op.nodeId);

    if (existing === undefined) {
      invalidOp("node does not exist");
    }

    if (op.kind === "update") {
      const targetsType = Object.prototype.hasOwnProperty.call(
        op.patch,
        "type"
      );

      if (
        existing.snapshot.type === "root" &&
        (Object.prototype.hasOwnProperty.call(op.patch, "parentId") ||
          targetsType)
      ) {
        invalidOp("cannot update root parentId or type");
      }

      if (targetsType) {
        invalidOp("unsupported update field type");
      }

      state.set(op.nodeId, {
        ...existing,
        snapshot: { ...existing.snapshot, ...op.patch },
      });
      continue;
    }

    if (existing.snapshot.type === "root") {
      invalidOp("cannot delete root");
    }

    const hasChildren = Array.from(state.values()).some(
      (node) => node.snapshot.parentId === op.nodeId
    );

    if (hasChildren) {
      invalidOp("node has children");
    }

    state.delete(op.nodeId);
  }

  return preImage;
}

/**
 * Applies an already validated operation list without creating history.
 */
async function writeOps(
  ctx: MutationCtx,
  mindmapId: Id<"mindmaps">,
  ops: NodeOp[]
): Promise<void> {
  const existingNodes = await ctx.db
    .query("nodes")
    .withIndex("by_mindmap", (q) => q.eq("mindmapId", mindmapId))
    .collect();
  const state = new Map<string, MutableNodeState>(
    existingNodes.map((node) => [
      node.nodeId,
      { documentId: node._id, snapshot: toSnapshot(node) },
    ])
  );

  for (const op of ops) {
    if (op.kind === "create") {
      const documentId = await ctx.db.insert("nodes", {
        mindmapId,
        ...op.node,
      });
      state.set(op.node.nodeId, {
        documentId,
        snapshot: { ...op.node },
      });
      continue;
    }

    const existing = state.get(op.nodeId);

    // validateOps has already established this invariant in the transaction.
    if (existing?.documentId === undefined) {
      throw new Error("Unknown node");
    }

    if (op.kind === "update") {
      await ctx.db.patch("nodes", existing.documentId, op.patch);
      state.set(op.nodeId, {
        ...existing,
        snapshot: { ...existing.snapshot, ...op.patch },
      });
      continue;
    }

    await ctx.db.delete("nodes", existing.documentId);
    state.delete(op.nodeId);
  }
}

/**
 * Encodes an undefined description so inverse patches remain Convex values.
 */
function serializeInverseOps(ops: NodeOp[]): unknown[] {
  return ops.map((op) => {
    if (
      op.kind === "update" &&
      Object.prototype.hasOwnProperty.call(op.patch, "description") &&
      op.patch.description === undefined
    ) {
      return {
        ...op,
        patch: { ...op.patch, description: null },
      };
    }

    return op;
  });
}

/**
 * Restores the in-memory undefined description represented in stored inverses.
 */
function deserializeInverseOps(value: unknown): NodeOp[] {
  if (!Array.isArray(value)) {
    return invalidOp("ops must be an array");
  }

  const restored = value.map((candidate) => {
    if (
      isRecord(candidate) &&
      candidate.kind === "update" &&
      isRecord(candidate.patch) &&
      Object.prototype.hasOwnProperty.call(candidate.patch, "description") &&
      candidate.patch.description === null
    ) {
      return {
        ...candidate,
        patch: { ...candidate.patch, description: undefined },
      };
    }

    return candidate;
  });

  return parseOps(restored);
}

/**
 * Applies a validated node-operation batch and records its inverse atomically.
 */
export const apply = mutation({
  args: {
    mindmapId: v.id("mindmaps"),
    ops: v.any(),
    description: v.string(),
    source: v.union(v.literal("user"), v.literal("ai")),
  },
  handler: async (ctx, args) => {
    const mindmap = await requireOwner(ctx, args.mindmapId);
    const ops = parseOps(args.ops);
    const preImage = await validateOps(ctx, args.mindmapId, ops);
    const inversePatch = invertOps(ops, preImage);
    const latestOperation = await ctx.db
      .query("operations")
      .withIndex("by_mindmap_seq", (q) => q.eq("mindmapId", args.mindmapId))
      .order("desc")
      .first();
    const seq = (latestOperation?.seq ?? 0) + 1;

    await writeOps(ctx, args.mindmapId, ops);
    const operationId = await ctx.db.insert("operations", {
      mindmapId: args.mindmapId,
      seq,
      description: args.description,
      patch: ops,
      inversePatch: serializeInverseOps(inversePatch),
      undone: false,
      actor: mindmap.ownerId,
      source: args.source,
    });
    await ctx.db.patch("mindmaps", args.mindmapId, {
      updatedAt: Date.now(),
    });

    return { operationId, seq };
  },
});

/**
 * Reverses the latest active operation and marks it undone atomically.
 */
export const undo = mutation({
  args: { operationId: v.id("operations") },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get("operations", args.operationId);

    if (operation === null) {
      throw new Error("Not found");
    }

    await requireOwner(ctx, operation.mindmapId);

    if (operation.undone) {
      throw new Error("Already undone");
    }

    const operations = await ctx.db
      .query("operations")
      .withIndex("by_mindmap_seq", (q) =>
        q.eq("mindmapId", operation.mindmapId)
      )
      .order("desc")
      .collect();
    const latestActive = operations.find((candidate) => !candidate.undone);

    if (latestActive?._id !== operation._id) {
      throw new Error("Undo out of order");
    }

    const inversePatch = deserializeInverseOps(operation.inversePatch);
    await validateOps(ctx, operation.mindmapId, inversePatch);
    await writeOps(ctx, operation.mindmapId, inversePatch);
    await ctx.db.patch("operations", operation._id, { undone: true });
    await ctx.db.patch("mindmaps", operation.mindmapId, {
      updatedAt: Date.now(),
    });

    return { seq: operation.seq };
  },
});

/**
 * Returns readable operation history in newest-first sequence order.
 */
export const history = query({
  args: { mindmapId: v.id("mindmaps") },
  handler: async (ctx, args) => {
    await requireReadable(ctx, args.mindmapId);
    const operations = await ctx.db
      .query("operations")
      .withIndex("by_mindmap_seq", (q) => q.eq("mindmapId", args.mindmapId))
      .order("desc")
      .collect();

    return operations.map(
      ({ seq, description, undone, source, _creationTime }) => ({
        seq,
        description,
        undone,
        source,
        _creationTime,
      })
    );
  },
});
