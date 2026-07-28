import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOwner, requireReadable, requireUser } from "./lib/access";
import type { NodeOp, NodeSnapshot } from "./lib/nodeOps";
import { applyOps } from "./ops";

const PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PUBLIC_ID_LENGTH = 10;
const PURGE_BATCH_SIZE = 200;
/** Bounds generated trees so one atomic apply operation remains predictable. */
const MAX_GENERATED_NODE_COUNT = 200;
const visibilityValidator = v.union(v.literal("private"), v.literal("shared"));
const nodeSnapshotValidator = v.object({
  nodeId: v.string(),
  parentId: v.union(v.string(), v.null()),
  type: v.union(v.literal("root"), v.literal("left"), v.literal("right")),
  title: v.string(),
  description: v.optional(v.string()),
  link: v.optional(v.string()),
  order: v.number(),
});

/**
 * Generates an unbiased URL-safe identifier using rejection sampling.
 */
function generatePublicId(): string {
  let publicId = "";

  while (publicId.length < PUBLIC_ID_LENGTH) {
    const bytes = new Uint8Array(PUBLIC_ID_LENGTH - publicId.length);
    crypto.getRandomValues(bytes);

    for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
      const byte = bytes[byteIndex];

      // 252 is the largest multiple of the 36-character alphabet below 256.
      if (byte >= 252) {
        continue;
      }

      publicId += PUBLIC_ID_ALPHABET[byte % PUBLIC_ID_ALPHABET.length];

      if (publicId.length === PUBLIC_ID_LENGTH) {
        break;
      }
    }
  }

  return publicId;
}

/**
 * Sorts nodes deterministically by parent and then sibling order.
 */
function sortNodesByParentAndOrder<
  Node extends { parentId: string | null; order: number },
>(nodes: Node[]): Node[] {
  return nodes.sort((left, right) => {
    const parentComparison = (left.parentId ?? "").localeCompare(
      right.parentId ?? ""
    );
    return parentComparison || left.order - right.order;
  });
}

/**
 * Projects a mindmap for reads without exposing its owner's auth subject.
 */
function projectMindmap(
  mindmap: {
    _id: Id<"mindmaps">;
    publicId: string;
    name: string;
    ownerId: string;
    visibility: "private" | "shared";
    updatedAt: number;
  },
  subject: string | null
) {
  return {
    _id: mindmap._id,
    publicId: mindmap.publicId,
    name: mindmap.name,
    visibility: mindmap.visibility,
    updatedAt: mindmap.updatedAt,
    isOwner: subject === mindmap.ownerId,
  };
}

/** Keeps public node reads limited to fields the canvas can render. */
function projectRenderableNode(node: Doc<"nodes">): NodeSnapshot {
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

type SharedMindmapResult = {
  mindmap: ReturnType<typeof projectMindmap>;
  nodes: NodeSnapshot[];
};

/**
 * Inserts one private mindmap and its canonical root for an authenticated owner.
 */
async function insertOwnedMindmap(
  ctx: MutationCtx,
  ownerId: string,
  name: string
): Promise<{ mindmapId: Id<"mindmaps">; publicId: string }> {
  let publicId = generatePublicId();

  // Collisions are exceptionally unlikely, but the public route identifier
  // must remain unique even when random generation repeats.
  while (
    (await ctx.db
      .query("mindmaps")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique()) !== null
  ) {
    publicId = generatePublicId();
  }

  const updatedAt = Date.now();
  const mindmapId = await ctx.db.insert("mindmaps", {
    publicId,
    name,
    ownerId,
    visibility: "private",
    updatedAt,
  });

  await ctx.db.insert("nodes", {
    mindmapId,
    nodeId: "root",
    parentId: null,
    type: "root",
    title: name,
    order: 0,
  });

  return { mindmapId, publicId };
}

/**
 * Creates an owned private mindmap and seeds its root node.
 */
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireUser(ctx);
    return insertOwnedMindmap(ctx, ownerId, args.name);
  },
});

/**
 * Atomically creates an AI mindmap, applies its nodes, and records one history row.
 */
export const createWithNodes = mutation({
  args: {
    name: v.string(),
    nodes: v.array(nodeSnapshotValidator),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUser(ctx);

    if (args.nodes.length > MAX_GENERATED_NODE_COUNT) {
      throw new ConvexError("Invalid op: too many nodes");
    }

    const rootSnapshots = args.nodes.filter(
      (node) => node.nodeId === "root" || node.type === "root"
    );

    if (
      rootSnapshots.length > 1 ||
      rootSnapshots.some(
        (node) =>
          node.nodeId !== "root" ||
          node.type !== "root" ||
          node.parentId !== null
      )
    ) {
      throw new ConvexError("Invalid generated root node");
    }

    const created = await insertOwnedMindmap(ctx, ownerId, args.name);
    const ops: NodeOp[] = args.nodes.flatMap((node): NodeOp[] => {
      if (node.nodeId !== "root") {
        return [{ kind: "create", node: node as NodeSnapshot }];
      }

      const patch = {
        title: node.title,
        ...(node.description === undefined
          ? {}
          : { description: node.description }),
        ...(node.link === undefined ? {} : { link: node.link }),
      };
      return [{ kind: "update", nodeId: "root", patch }];
    });

    await applyOps(ctx, {
      mindmapId: created.mindmapId,
      ops,
      actor: ownerId,
      description: "Generated mindmap",
      source: "ai",
    });

    return created;
  },
});

/**
 * Returns an authenticated user's readable mindmap and all of its nodes.
 */
export const get = query({
  args: { mindmapId: v.id("mindmaps") },
  handler: async (ctx, args) => {
    const { mindmap, subject } = await requireReadable(ctx, args.mindmapId);
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .collect();

    return {
      mindmap: projectMindmap(mindmap, subject),
      nodes: sortNodesByParentAndOrder(nodes),
    };
  },
});

/**
 * Resolves a public route identifier to a readable mindmap and its nodes.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const subject = await requireUser(ctx);
    const resolvedMindmap = await ctx.db
      .query("mindmaps")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    if (resolvedMindmap === null) {
      throw new ConvexError("Not found");
    }

    // Private public IDs must not disclose whether another user's map exists.
    if (
      resolvedMindmap.ownerId !== subject &&
      resolvedMindmap.visibility !== "shared"
    ) {
      throw new ConvexError("Not found");
    }

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", resolvedMindmap._id))
      .collect();

    return {
      mindmap: projectMindmap(resolvedMindmap, subject),
      nodes: sortNodesByParentAndOrder(nodes),
    };
  },
});

/**
 * Resolves a shared public route without reading authentication state.
 */
export const getShared = query({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<SharedMindmapResult> => {
    const resolvedMindmap = await ctx.db
      .query("mindmaps")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    // Shared and absent IDs deliberately have one indistinguishable failure.
    if (resolvedMindmap === null || resolvedMindmap.visibility !== "shared") {
      throw new ConvexError("Not found");
    }

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", resolvedMindmap._id))
      .collect();

    return {
      mindmap: projectMindmap(resolvedMindmap, null),
      nodes: sortNodesByParentAndOrder(nodes.map(projectRenderableNode)),
    };
  },
});

/**
 * Lists the current user's mindmaps with the most recently changed first.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUser(ctx);
    const mindmaps = await ctx.db
      .query("mindmaps")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();

    return mindmaps
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((mindmap) => projectMindmap(mindmap, ownerId));
  },
});

/**
 * Renames an owned mindmap and records the root-title change as an operation.
 * Undo restores the root title but intentionally does not restore mindmaps.name.
 */
export const rename = mutation({
  args: { mindmapId: v.id("mindmaps"), name: v.string() },
  handler: async (ctx, args) => {
    const { subject } = await requireOwner(ctx, args.mindmapId);

    await applyOps(ctx, {
      mindmapId: args.mindmapId,
      ops: [{ kind: "update", nodeId: "root", patch: { title: args.name } }],
      actor: subject,
      description: "Renamed mindmap",
      source: "user",
    });
    await ctx.db.patch("mindmaps", args.mindmapId, {
      name: args.name,
    });
  },
});

/** Changes sharing visibility for an owned mindmap. */
export const setVisibility = mutation({
  args: {
    mindmapId: v.id("mindmaps"),
    visibility: visibilityValidator,
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.mindmapId);
    await ctx.db.patch("mindmaps", args.mindmapId, {
      visibility: args.visibility,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Removes an owned mindmap immediately and schedules bounded dependent cleanup.
 */
export const remove = mutation({
  args: { mindmapId: v.id("mindmaps") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.mindmapId);
    await ctx.db.delete("mindmaps", args.mindmapId);
    await ctx.scheduler.runAfter(0, internal.mindmaps.purgeBatch, {
      mindmapId: args.mindmapId,
    });
  },
});

/**
 * Deletes at most 200 dependent rows and reschedules while rows remain.
 */
export const purgeBatch = internalMutation({
  args: { mindmapId: v.id("mindmaps") },
  handler: async (ctx, args): Promise<void> => {
    let remaining = PURGE_BATCH_SIZE;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .take(remaining);

    for (const message of messages) {
      await ctx.db.delete("messages", message._id);
      remaining -= 1;
    }

    // Messages are independent of thread retention, so delete them first.
    if (remaining === 0) {
      if (await hasPurgeRows(ctx, args.mindmapId)) {
        await ctx.scheduler.runAfter(0, internal.mindmaps.purgeBatch, {
          mindmapId: args.mindmapId,
        });
      }
      return;
    }

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .take(remaining);

    for (const thread of threads) {
      await ctx.db.delete("threads", thread._id);
      remaining -= 1;

      if (remaining === 0) {
        break;
      }
    }

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .take(remaining);

    for (const node of nodes) {
      await ctx.db.delete("nodes", node._id);
      remaining -= 1;
    }

    const operations = await ctx.db
      .query("operations")
      .withIndex("by_mindmap_seq", (q) => q.eq("mindmapId", args.mindmapId))
      .take(remaining);

    for (const operation of operations) {
      await ctx.db.delete("operations", operation._id);
      remaining -= 1;
    }

    const hasRemainingRows = await hasPurgeRows(ctx, args.mindmapId);

    if (hasRemainingRows) {
      await ctx.scheduler.runAfter(0, internal.mindmaps.purgeBatch, {
        mindmapId: args.mindmapId,
      });
    }
  },
});

/**
 * Checks whether a deleted mindmap still has dependent rows to purge.
 */
async function hasPurgeRows(
  ctx: MutationCtx,
  mindmapId: Id<"mindmaps">
): Promise<boolean> {
  const [message, thread, node, operation] = await Promise.all([
    ctx.db
      .query("messages")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", mindmapId))
      .first(),
    ctx.db
      .query("threads")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", mindmapId))
      .first(),
    ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", mindmapId))
      .first(),
    ctx.db
      .query("operations")
      .withIndex("by_mindmap_seq", (q) => q.eq("mindmapId", mindmapId))
      .first(),
  ]);

  return (
    message !== null || thread !== null || node !== null || operation !== null
  );
}
