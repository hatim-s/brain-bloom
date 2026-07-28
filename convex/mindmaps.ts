import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireOwner, requireReadable, requireUser } from "./lib/access";

const PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PUBLIC_ID_LENGTH = 10;

/**
 * Generates a URL-safe random identifier using the runtime cryptography API.
 */
function generatePublicId(): string {
  const bytes = new Uint8Array(PUBLIC_ID_LENGTH);
  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    (byte) => PUBLIC_ID_ALPHABET[byte % PUBLIC_ID_ALPHABET.length]
  ).join("");
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
    const mindmap = await requireReadable(ctx, args.mindmapId);
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .collect();

    return { mindmap, nodes };
  },
});

/**
 * Resolves a public route identifier to a readable mindmap and its nodes.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const resolvedMindmap = await ctx.db
      .query("mindmaps")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    if (resolvedMindmap === null) {
      throw new Error("Not found");
    }

    const mindmap = await requireReadable(ctx, resolvedMindmap._id);
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", mindmap._id))
      .collect();

    return { mindmap, nodes };
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
    await ctx.db.patch("mindmaps", args.mindmapId, {
      name: args.name,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Removes an owned mindmap and all of its dependent records.
 */
export const remove = mutation({
  args: { mindmapId: v.id("mindmaps") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.mindmapId);

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .collect();
    const operations = await ctx.db
      .query("operations")
      .withIndex("by_mindmap_seq", (q) => q.eq("mindmapId", args.mindmapId))
      .collect();
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .collect();

    for (const thread of threads) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .collect();

      for (const message of messages) {
        await ctx.db.delete("messages", message._id);
      }

      await ctx.db.delete("threads", thread._id);
    }

    for (const node of nodes) {
      await ctx.db.delete("nodes", node._id);
    }

    for (const operation of operations) {
      await ctx.db.delete("operations", operation._id);
    }

    await ctx.db.delete("mindmaps", args.mindmapId);
  },
});
