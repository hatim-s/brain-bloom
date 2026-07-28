import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  mindmaps: defineTable({
    publicId: v.string(),
    name: v.string(),
    ownerId: v.string(),
    visibility: v.union(v.literal("private"), v.literal("shared")),
    updatedAt: v.number(),
  })
    .index("by_publicId", ["publicId"])
    .index("by_owner", ["ownerId"]),

  nodes: defineTable({
    mindmapId: v.id("mindmaps"),
    nodeId: v.string(),
    parentId: v.union(v.string(), v.null()),
    type: v.union(v.literal("root"), v.literal("left"), v.literal("right")),
    title: v.string(),
    description: v.optional(v.string()),
    link: v.optional(v.string()),
    order: v.number(),
  })
    .index("by_mindmap", ["mindmapId"])
    .index("by_mindmap_node", ["mindmapId", "nodeId"])
    // Reordering is an atomic batch update so sibling order stays unique.
    .index("by_mindmap_parent", ["mindmapId", "parentId"]),

  operations: defineTable({
    mindmapId: v.id("mindmaps"),
    seq: v.number(),
    description: v.string(),
    patch: v.any(),
    inversePatch: v.any(),
    undone: v.boolean(),
    actor: v.string(),
    source: v.union(v.literal("user"), v.literal("ai")),
  }).index("by_mindmap_seq", ["mindmapId", "seq"]),

  threads: defineTable({
    mindmapId: v.id("mindmaps"),
    title: v.string(),
  }).index("by_mindmap", ["mindmapId"]),

  messages: defineTable({
    mindmapId: v.id("mindmaps"),
    threadId: v.id("threads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.any(),
    operationId: v.optional(v.id("operations")),
  })
    .index("by_thread", ["threadId"])
    .index("by_mindmap", ["mindmapId"]),
});
