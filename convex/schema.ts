import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  aiConnections: defineTable({
    ownerId: v.string(),
    provider: v.literal("codex"),
    label: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("connected"),
      v.literal("error"),
      v.literal("expired"),
      v.literal("revoking"),
      v.literal("revoked"),
      v.literal("deleted")
    ),
    authenticationMethod: v.literal("device_code"),
    gatewayCredentialId: v.optional(v.string()),
    accountHint: v.optional(v.string()),
    planLabel: v.optional(v.string()),
    isDefault: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastValidationAt: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
    lifecycleVersion: v.optional(v.literal(1)),
    lifecycleRevision: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_provider_status", ["ownerId", "provider", "status"]),

  aiConnectionLifecycleReceipts: defineTable({
    connectionId: v.id("aiConnections"),
    ownerId: v.string(),
    provider: v.literal("codex"),
    evidenceId: v.string(),
    requestId: v.string(),
    revision: v.number(),
    version: v.literal(1),
    status: v.union(
      v.literal("pending"),
      v.literal("connected"),
      v.literal("error"),
      v.literal("expired"),
      v.literal("revoking"),
      v.literal("revoked"),
      v.literal("deleted")
    ),
    fingerprint: v.string(),
    appliedAt: v.number(),
  })
    .index("by_evidence", ["evidenceId"])
    .index("by_request", ["requestId"])
    .index("by_connection_revision", ["connectionId", "revision"]),

  aiConnectionRateBudgets: defineTable({
    scope: v.union(v.literal("owner"), v.literal("global")),
    scopeKey: v.string(),
    endpoint: v.union(
      v.literal("createPendingCodex"),
      v.literal("selectDefaultCodex"),
      v.literal("list"),
      v.literal("getStatus")
    ),
    windowStartedAt: v.number(),
    windowMs: v.number(),
    limit: v.number(),
    consumed: v.number(),
  }).index("by_scope_endpoint", ["scope", "scopeKey", "endpoint"]),

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
    messageId: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.any(),
    operationId: v.optional(v.id("operations")),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_message", ["threadId", "messageId"])
    .index("by_mindmap", ["mindmapId"]),
});
