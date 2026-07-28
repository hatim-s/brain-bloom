import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireOwner, requireUser } from "./lib/access";
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

type ApplyOpsArgs = {
  mindmapId: Id<"mindmaps">;
  ops: NodeOp[];
  actor: string;
  description: string;
  source: Doc<"operations">["source"];
};

const UPDATE_FIELDS = new Set([
  "title",
  "description",
  "link",
  "parentId",
  "order",
  "type",
]);

/**
 * Throws a consistently prefixed validation error for an operation batch.
 */
function invalidOp(reason: string): never {
  throw new ConvexError(`Invalid op: ${reason}`);
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
    (value.link !== undefined && typeof value.link !== "string") ||
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
    ...(value.link === undefined ? {} : { link: value.link }),
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

  const fields = Object.keys(value);

  if (fields.length === 0) {
    return invalidOp("empty patch");
  }

  for (const field of fields) {
    if (!UPDATE_FIELDS.has(field)) {
      return invalidOp(`unsupported update field ${field}`);
    }
  }

  if (
    (value.title !== undefined && typeof value.title !== "string") ||
    (value.description !== undefined &&
      value.description !== null &&
      typeof value.description !== "string") ||
    (value.link !== undefined &&
      value.link !== null &&
      typeof value.link !== "string") ||
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

  return {
    ...value,
    ...(value.description === null ? { description: undefined } : {}),
    ...(value.link === null ? { link: undefined } : {}),
  } as NodeUpdatePatch;
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
    ...(node.link === undefined ? {} : { link: node.link }),
    order: node.order,
  };
}

/**
 * Returns whether an update patch explicitly targets a field.
 */
function hasPatchField(
  patch: NodeUpdatePatch,
  field: keyof NodeUpdatePatch
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, field);
}

/**
 * Enforces the integer ordering contract shared by creates and order updates.
 */
function validateOrder(order: number): void {
  if (!Number.isFinite(order) || !Number.isInteger(order) || order < 0) {
    invalidOp("invalid order");
  }
}

/**
 * Validates a batch against the state produced by each preceding operation.
 *
 * Reordering siblings is represented by one batch containing every changed
 * order. Duplicate-order validation therefore runs against the final evolving
 * state, after all entries in that batch have been composed.
 */
async function validateOps(
  ctx: MutationCtx,
  mindmapId: Id<"mindmaps">,
  ops: NodeOp[]
): Promise<Map<string, NodeSnapshot>> {
  const state = new Map<string, MutableNodeState>();
  const missingNodeIds = new Set<string>();
  const deletedNodeIds = new Set<string>();
  const preImage = new Map<string, NodeSnapshot>();
  const affectedParents = new Set<string | null>();

  /**
   * Loads a node once, while respecting creates, updates, and prior deletes.
   */
  const getNode = async (
    nodeId: string
  ): Promise<MutableNodeState | undefined> => {
    if (deletedNodeIds.has(nodeId) || missingNodeIds.has(nodeId)) {
      return undefined;
    }

    const cached = state.get(nodeId);

    if (cached !== undefined) {
      return cached;
    }

    const document = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap_node", (q) =>
        q.eq("mindmapId", mindmapId).eq("nodeId", nodeId)
      )
      .unique();

    if (document === null) {
      missingNodeIds.add(nodeId);
      return undefined;
    }

    const snapshot = toSnapshot(document);
    const loaded = { documentId: document._id, snapshot };
    state.set(nodeId, loaded);
    preImage.set(nodeId, { ...snapshot });
    return loaded;
  };

  /**
   * Checks a candidate parent against the current batch state.
   */
  const validateParent = async (
    nodeId: string,
    nodeType: NodeSnapshot["type"],
    parentId: string | null
  ): Promise<void> => {
    if (parentId === null) {
      invalidOp("non-root parent cannot be null");
    }

    const parent = await getNode(parentId);

    if (parent === undefined) {
      invalidOp("parent does not exist");
    }

    if (parent.snapshot.type !== "root" && parent.snapshot.type !== nodeType) {
      invalidOp("parent is on another side");
    }

    const visited = new Set<string>();
    let ancestorId: string | null = parentId;

    // Walking parent pointers bounds cycle detection by the current tree depth.
    while (ancestorId !== null) {
      if (ancestorId === nodeId || visited.has(ancestorId)) {
        invalidOp("parent creates cycle");
      }

      visited.add(ancestorId);
      const ancestor = await getNode(ancestorId);

      if (ancestor === undefined) {
        invalidOp("parent does not exist");
      }

      ancestorId = ancestor.snapshot.parentId;
    }
  };

  /**
   * Finds live children using the parent index plus the batch overlay.
   */
  const hasLiveChildren = async (nodeId: string): Promise<boolean> => {
    const databaseChildren = ctx.db
      .query("nodes")
      .withIndex("by_mindmap_parent", (q) =>
        q.eq("mindmapId", mindmapId).eq("parentId", nodeId)
      );

    for await (const child of databaseChildren) {
      if (deletedNodeIds.has(child.nodeId)) {
        continue;
      }

      const evolvingChild = state.get(child.nodeId);

      if (
        evolvingChild === undefined ||
        evolvingChild.snapshot.parentId === nodeId
      ) {
        return true;
      }
    }

    return Array.from(state.values()).some(
      ({ snapshot }) =>
        !deletedNodeIds.has(snapshot.nodeId) && snapshot.parentId === nodeId
    );
  };

  for (const op of ops) {
    if (op.kind === "create") {
      if ((await getNode(op.node.nodeId)) !== undefined) {
        invalidOp("node already exists");
      }

      if (op.node.type === "root") {
        invalidOp("cannot create root");
      }

      validateOrder(op.node.order);
      await validateParent(op.node.nodeId, op.node.type, op.node.parentId);

      missingNodeIds.delete(op.node.nodeId);
      deletedNodeIds.delete(op.node.nodeId);
      state.set(op.node.nodeId, { snapshot: { ...op.node } });
      affectedParents.add(op.node.parentId);
      continue;
    }

    const existing = await getNode(op.nodeId);

    if (existing === undefined) {
      invalidOp("node does not exist");
    }

    if (op.kind === "update") {
      const targetsType = Object.prototype.hasOwnProperty.call(
        op.patch,
        "type"
      );
      const targetsParent = hasPatchField(op.patch, "parentId");
      const targetsOrder = hasPatchField(op.patch, "order");

      if (existing.snapshot.type === "root" && (targetsParent || targetsType)) {
        invalidOp("cannot update root parentId or type");
      }

      if (targetsType) {
        invalidOp("unsupported update field type");
      }

      if (targetsOrder) {
        validateOrder(op.patch.order as number);
      }

      if (targetsParent) {
        await validateParent(
          op.nodeId,
          existing.snapshot.type,
          op.patch.parentId as string | null
        );
      }

      const nextSnapshot = { ...existing.snapshot, ...op.patch };

      if (targetsOrder || targetsParent) {
        affectedParents.add(existing.snapshot.parentId);
        affectedParents.add(nextSnapshot.parentId);
      }

      state.set(op.nodeId, {
        ...existing,
        snapshot: nextSnapshot,
      });
      continue;
    }

    if (existing.snapshot.type === "root") {
      invalidOp("cannot delete root");
    }

    if (await hasLiveChildren(op.nodeId)) {
      invalidOp("node has children");
    }

    affectedParents.add(existing.snapshot.parentId);
    state.delete(op.nodeId);
    deletedNodeIds.add(op.nodeId);
  }

  for (const parentId of Array.from(affectedParents)) {
    const siblings = new Map<string, NodeSnapshot>();
    const databaseSiblings = ctx.db
      .query("nodes")
      .withIndex("by_mindmap_parent", (q) =>
        q.eq("mindmapId", mindmapId).eq("parentId", parentId)
      );

    for await (const document of databaseSiblings) {
      if (deletedNodeIds.has(document.nodeId)) {
        continue;
      }

      const evolving = state.get(document.nodeId);
      const snapshot = evolving?.snapshot ?? toSnapshot(document);

      if (snapshot.parentId === parentId) {
        siblings.set(snapshot.nodeId, snapshot);
      }
    }

    // Adds batch-created and reparented siblings not present in the DB range.
    for (const { snapshot } of Array.from(state.values())) {
      if (
        !deletedNodeIds.has(snapshot.nodeId) &&
        snapshot.parentId === parentId
      ) {
        siblings.set(snapshot.nodeId, snapshot);
      }
    }

    const occupiedOrders = new Set<number>();

    for (const sibling of Array.from(siblings.values())) {
      if (occupiedOrders.has(sibling.order)) {
        invalidOp("duplicate order");
      }

      occupiedOrders.add(sibling.order);
    }
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
  const state = new Map<string, MutableNodeState>();

  /**
   * Loads a write target lazily so large mindmaps do not enter the read set.
   */
  const getNode = async (
    nodeId: string
  ): Promise<MutableNodeState | undefined> => {
    const cached = state.get(nodeId);

    if (cached !== undefined) {
      return cached;
    }

    const document = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap_node", (q) =>
        q.eq("mindmapId", mindmapId).eq("nodeId", nodeId)
      )
      .unique();

    if (document === null) {
      return undefined;
    }

    const loaded = {
      documentId: document._id,
      snapshot: toSnapshot(document),
    };
    state.set(nodeId, loaded);
    return loaded;
  };

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

    const existing = await getNode(op.nodeId);

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
 * Encodes optional-field removals so operation patches remain Convex values.
 */
function serializeOps(ops: NodeOp[]): unknown[] {
  return ops.map((op) => {
    if (op.kind !== "update") {
      return op;
    }

    const patch = {
      ...op.patch,
      ...(hasPatchField(op.patch, "description") &&
      op.patch.description === undefined
        ? { description: null }
        : {}),
      ...(hasPatchField(op.patch, "link") && op.patch.link === undefined
        ? { link: null }
        : {}),
    };

    return { ...op, patch };
  });
}

/**
 * Restores in-memory undefined removals represented by stored null sentinels.
 */
function deserializeInverseOps(value: unknown): NodeOp[] {
  if (!Array.isArray(value)) {
    return invalidOp("ops must be an array");
  }

  const restored = value.map((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.kind !== "update" ||
      !isRecord(candidate.patch)
    ) {
      return candidate;
    }

    return {
      ...candidate,
      patch: {
        ...candidate.patch,
        ...(candidate.patch.description === null
          ? { description: undefined }
          : {}),
        ...(candidate.patch.link === null ? { link: undefined } : {}),
      },
    };
  });

  return parseOps(restored);
}

/**
 * Validates, applies, and records an operation batch atomically for an actor.
 * Reorder = batch update: submit every changed sibling order together.
 */
export async function applyOps(
  ctx: MutationCtx,
  { mindmapId, ops, actor, description, source }: ApplyOpsArgs
): Promise<{ operationId: Id<"operations">; seq: number }> {
  const preImage = await validateOps(ctx, mindmapId, ops);
  const inversePatch = invertOps(ops, preImage);
  const latestOperation = await ctx.db
    .query("operations")
    .withIndex("by_mindmap_seq", (q) => q.eq("mindmapId", mindmapId))
    .order("desc")
    .first();
  const seq = (latestOperation?.seq ?? 0) + 1;

  await writeOps(ctx, mindmapId, ops);
  const operationId = await ctx.db.insert("operations", {
    mindmapId,
    seq,
    description,
    patch: serializeOps(ops),
    inversePatch: serializeOps(inversePatch),
    undone: false,
    actor,
    source,
  });
  await ctx.db.patch("mindmaps", mindmapId, {
    updatedAt: Date.now(),
  });

  return { operationId, seq };
}

/**
 * Applies a caller-provided node-operation batch and records its inverse.
 */
export const apply = mutation({
  args: {
    mindmapId: v.id("mindmaps"),
    ops: v.any(),
    description: v.string(),
    source: v.union(v.literal("user"), v.literal("ai")),
  },
  handler: async (ctx, args) => {
    const { subject } = await requireOwner(ctx, args.mindmapId);
    const ops = parseOps(args.ops);

    return applyOps(ctx, {
      mindmapId: args.mindmapId,
      ops,
      actor: subject,
      description: args.description,
      source: args.source,
    });
  },
});

/**
 * Reverses the latest active operation and marks it undone atomically.
 */
export const undo = mutation({
  args: { operationId: v.id("operations") },
  handler: async (ctx, args) => {
    const subject = await requireUser(ctx);
    const operation = await ctx.db.get("operations", args.operationId);

    if (operation === null) {
      throw new ConvexError("Not found");
    }

    await requireOwner(ctx, operation.mindmapId, subject);

    if (operation.undone) {
      throw new ConvexError("Already undone");
    }

    const operations = ctx.db
      .query("operations")
      .withIndex("by_mindmap_seq", (q) =>
        q.eq("mindmapId", operation.mindmapId)
      )
      .order("desc");
    let latestActive: Doc<"operations"> | undefined;

    for await (const candidate of operations) {
      if (!candidate.undone) {
        latestActive = candidate;
        break;
      }
    }

    if (latestActive?._id !== operation._id) {
      throw new ConvexError("Undo out of order");
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
 * Reverses a target operation and every later active operation atomically.
 *
 * This walks all later active operations in one transaction. Autosave-sized
 * history makes a deep undoTo increasingly expensive; that bound is acceptable
 * for P8's per-message undo of recent operations, but must be revisited before
 * any history-wide undo surface ships.
 */
export const undoTo = mutation({
  args: { operationId: v.id("operations") },
  handler: async (ctx, args) => {
    const subject = await requireUser(ctx);
    const target = await ctx.db.get("operations", args.operationId);

    if (target === null) {
      throw new ConvexError("Not found");
    }

    await requireOwner(ctx, target.mindmapId, subject);

    if (target.undone) {
      throw new ConvexError("Already undone");
    }

    const operations = ctx.db
      .query("operations")
      .withIndex("by_mindmap_seq", (q) =>
        q.eq("mindmapId", target.mindmapId).gte("seq", target.seq)
      )
      .order("desc");
    let undoneCount = 0;

    for await (const operation of operations) {
      if (operation.undone) {
        continue;
      }

      const inversePatch = deserializeInverseOps(operation.inversePatch);
      await validateOps(ctx, target.mindmapId, inversePatch);
      await writeOps(ctx, target.mindmapId, inversePatch);
      await ctx.db.patch("operations", operation._id, { undone: true });
      undoneCount += 1;
    }

    await ctx.db.patch("mindmaps", target.mindmapId, {
      updatedAt: Date.now(),
    });

    return { undoneCount, seq: target.seq };
  },
});

/**
 * Returns owner-only operation history in newest-first paginated order.
 */
export const history = query({
  args: {
    mindmapId: v.id("mindmaps"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.mindmapId);
    const result = await ctx.db
      .query("operations")
      .withIndex("by_mindmap_seq", (q) => q.eq("mindmapId", args.mindmapId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map(
        ({ _id, seq, description, undone, source, _creationTime }) => ({
          _id,
          seq,
          description,
          undone,
          source,
          _creationTime,
        })
      ),
    };
  },
});
