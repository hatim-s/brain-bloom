import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireOwner, requireUser } from "./lib/access";

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
 * Lists all conversation threads for an owned mindmap.
 */
export const listThreads = query({
  args: { mindmapId: v.id("mindmaps") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.mindmapId);

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
    const subject = await requireUser(ctx);
    const thread = await ctx.db.get("threads", args.threadId);

    if (thread === null) {
      throw new ConvexError("Not found");
    }

    await requireOwner(ctx, thread.mindmapId, subject);

    if (args.operationId !== undefined) {
      const operation = await ctx.db.get("operations", args.operationId);

      if (operation === null) {
        throw new ConvexError("Not found");
      }

      if (operation.mindmapId !== thread.mindmapId) {
        throw new ConvexError(
          "Invalid op: operation belongs to another mindmap"
        );
      }
    }

    return ctx.db.insert("messages", {
      mindmapId: thread.mindmapId,
      threadId: args.threadId,
      role: args.role,
      content: args.content,
      operationId: args.operationId,
    });
  },
});

/**
 * Lists messages in creation order for a thread on an owned mindmap.
 */
export const listMessages = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const subject = await requireUser(ctx);
    const thread = await ctx.db.get("threads", args.threadId);

    if (thread === null) {
      throw new ConvexError("Not found");
    }

    await requireOwner(ctx, thread.mindmapId, subject);

    return ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();
  },
});
