import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOwner, requireReadable, requireUser } from "./lib/access";

const PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PUBLIC_ID_LENGTH = 10;
const PURGE_BATCH_SIZE = 200;

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
 * Creates an owned private mindmap and seeds its root node.
 */
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireUser(ctx);
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
      name: args.name,
      ownerId,
      visibility: "private",
      updatedAt,
    });

    await ctx.db.insert("nodes", {
      mindmapId,
      nodeId: "root",
      parentId: null,
      type: "root",
      title: args.name,
      order: 0,
    });

    return { mindmapId, publicId };
  },
});

/**
 * Returns an authenticated user's readable mindmap and all of its nodes.
 */
export const get = query({
  args: { mindmapId: v.id("mindmaps") },
  handler: async (ctx, args) => {
    const { mindmap } = await requireReadable(ctx, args.mindmapId);
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .collect();

    return { mindmap, nodes: sortNodesByParentAndOrder(nodes) };
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
      throw new Error("Not found");
    }

    // Private public IDs must not disclose whether another user's map exists.
    if (
      resolvedMindmap.ownerId !== subject &&
      resolvedMindmap.visibility !== "shared"
    ) {
      throw new Error("Not found");
    }

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", resolvedMindmap._id))
      .collect();

    return {
      mindmap: resolvedMindmap,
      nodes: sortNodesByParentAndOrder(nodes),
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

    return mindmaps.sort((left, right) => right.updatedAt - left.updatedAt);
  },
});

/**
 * Renames an owned mindmap and records its latest mutation time.
 */
export const rename = mutation({
  args: { mindmapId: v.id("mindmaps"), name: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.mindmapId);
    const root = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap_node", (q) =>
        q.eq("mindmapId", args.mindmapId).eq("nodeId", "root")
      )
      .unique();

    if (root === null) {
      throw new Error("Not found");
    }

    await ctx.db.patch("mindmaps", args.mindmapId, {
      name: args.name,
      updatedAt: Date.now(),
    });
    await ctx.db.patch("nodes", root._id, { title: args.name });
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
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .take(remaining);

    for (const thread of threads) {
      const messageLimit = remaining;
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .take(messageLimit);

      for (const message of messages) {
        await ctx.db.delete("messages", message._id);
        remaining -= 1;
      }

      // A full message page consumes the batch; delete the thread next run.
      if (remaining === 0) {
        break;
      }

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
  const [thread, node, operation] = await Promise.all([
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

  return thread !== null || node !== null || operation !== null;
}
