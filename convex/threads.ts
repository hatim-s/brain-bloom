import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireOwner, requireReadable } from "./lib/access";

/**
 * Creates a conversation thread attached to an owned mindmap.
 */
export const createThread = mutation({
  args: { mindmapId: v.id("mindmaps"), title: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.mindmapId);

    return ctx.db.insert("threads", {
      mindmapId: args.mindmapId,
      title: args.title,
    });
  },
});

/**
 * Lists all conversation threads for a readable mindmap.
 */
export const listThreads = query({
  args: { mindmapId: v.id("mindmaps") },
  handler: async (ctx, args) => {
    await requireReadable(ctx, args.mindmapId);

    return ctx.db
      .query("threads")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", args.mindmapId))
      .order("asc")
      .collect();
  },
});

/**
 * Adds a user or assistant message to a thread on an owned mindmap.
 */
export const addMessage = mutation({
  args: {
    threadId: v.id("threads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.any(),
    operationId: v.optional(v.id("operations")),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("threads", args.threadId);

    if (thread === null) {
      throw new Error("Not found");
    }

    await requireOwner(ctx, thread.mindmapId);

    return ctx.db.insert("messages", {
      threadId: args.threadId,
      role: args.role,
      content: args.content,
      operationId: args.operationId,
    });
  },
});

/**
 * Lists messages in creation order for a thread on a readable mindmap.
 */
export const listMessages = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("threads", args.threadId);

    if (thread === null) {
      throw new Error("Not found");
    }

    await requireReadable(ctx, thread.mindmapId);

    return ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();
  },
});
