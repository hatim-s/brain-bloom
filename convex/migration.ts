import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import type { NodeSnapshot } from "./lib/nodeOps";

const nodeSnapshotValidator = v.object({
  nodeId: v.string(),
  parentId: v.union(v.string(), v.null()),
  type: v.union(v.literal("root"), v.literal("left"), v.literal("right")),
  title: v.string(),
  description: v.optional(v.string()),
  link: v.optional(v.string()),
  order: v.number(),
});

const importArgs = {
  ownerId: v.string(),
  name: v.string(),
  publicId: v.string(),
  nodes: v.array(nodeSnapshotValidator),
};

type ImportArgs = {
  ownerId: string;
  name: string;
  publicId: string;
  nodes: NodeSnapshot[];
};

type SuccessfulImportSummary = {
  status: "created" | "updated" | "unchanged";
  added: number;
  changed: number;
  removed: number;
};

type ImportSummary =
  | SuccessfulImportSummary
  | {
      status: "rejected";
      error: string;
      offendingNodeIds: string[];
    };

type ReadCtx = Pick<QueryCtx | MutationCtx, "db">;

type ImportPlan = {
  mindmap: Doc<"mindmaps"> | null;
  existingNodes: Doc<"nodes">[];
  incomingNodes: Map<string, NodeSnapshot>;
  summary: SuccessfulImportSummary;
};

/** Validation failure that can be returned as one map's migration result. */
class MigrationValidationError extends Error {
  readonly offendingNodeIds: string[];

  constructor(message: string, offendingNodeIds: string[] = []) {
    super(message);
    this.name = "MigrationValidationError";
    this.offendingNodeIds = offendingNodeIds;
  }
}

/** Rejects one migration payload without aborting the surrounding CLI run. */
function invalidMigration(
  message: string,
  offendingNodeIds: string[] = []
): never {
  throw new MigrationValidationError(message, offendingNodeIds);
}

/** Converts a validation exception into the per-map report shape. */
function getRejectedSummary(error: unknown): ImportSummary | null {
  if (!(error instanceof MigrationValidationError)) {
    return null;
  }

  return {
    status: "rejected",
    error: error.message,
    offendingNodeIds: error.offendingNodeIds,
  };
}

/** Projects a stored node into the transport-independent migration shape. */
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

/** Compares every persisted node field, including optional-field presence. */
function snapshotsEqual(left: NodeSnapshot, right: NodeSnapshot): boolean {
  return (
    left.nodeId === right.nodeId &&
    left.parentId === right.parentId &&
    left.type === right.type &&
    left.title === right.title &&
    left.description === right.description &&
    left.link === right.link &&
    left.order === right.order
  );
}

/** Rejects payloads that cannot represent one deterministic rooted tree. */
function validateIncomingNodes(nodes: NodeSnapshot[]): void {
  const ids = new Set<string>();
  const nodesById = new Map<string, NodeSnapshot>();
  const occupiedSiblingOrders = new Set<string>();
  const roots = nodes.filter(
    (node) => node.type === "root" && node.parentId === null
  );

  if (roots.length !== 1 || roots[0].nodeId !== "root") {
    invalidMigration(
      "Migration payload must contain exactly one root node",
      roots.map((root) => root.nodeId)
    );
  }

  for (const node of nodes) {
    if (ids.has(node.nodeId)) {
      invalidMigration(`Duplicate migration node id: ${node.nodeId}`, [
        node.nodeId,
      ]);
    }
    ids.add(node.nodeId);
    nodesById.set(node.nodeId, node);

    if (!Number.isInteger(node.order) || node.order < 0) {
      invalidMigration(`Invalid migration order for ${node.nodeId}`, [
        node.nodeId,
      ]);
    }

    if (node.nodeId !== "root" && node.parentId === null) {
      invalidMigration(`Missing migration parent for ${node.nodeId}`, [
        node.nodeId,
      ]);
    }

    if (node.nodeId !== "root" && node.type === "root") {
      invalidMigration(`Unexpected migration root type for ${node.nodeId}`, [
        node.nodeId,
      ]);
    }

    if (node.parentId !== null) {
      const siblingOrder = `${node.parentId}\u0000${node.order}`;
      if (occupiedSiblingOrders.has(siblingOrder)) {
        invalidMigration(
          `Duplicate migration sibling order for ${node.parentId}`,
          [node.nodeId]
        );
      }
      occupiedSiblingOrders.add(siblingOrder);
    }
  }

  for (const node of nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) {
      invalidMigration(`Missing migration parent: ${node.parentId}`, [
        node.nodeId,
      ]);
    }

    const ancestors = new Set<string>();
    let ancestor: NodeSnapshot | undefined = node;

    while (ancestor.parentId !== null) {
      if (ancestors.has(ancestor.nodeId)) {
        invalidMigration(
          `Migration payload contains a cycle at ${node.nodeId}`,
          [node.nodeId]
        );
      }
      ancestors.add(ancestor.nodeId);
      ancestor = nodesById.get(ancestor.parentId);

      if (ancestor === undefined) {
        break;
      }
    }
  }

  const wrongSideNodeIds = nodes
    .filter((node) => {
      if (node.nodeId === "root" || node.parentId === null) return false;

      const parent = nodesById.get(node.parentId);
      return parent?.type !== "root" && parent?.type !== node.type;
    })
    .map((node) => node.nodeId);

  if (wrongSideNodeIds.length > 0) {
    invalidMigration(
      "Migration nodes must have a root or same-side parent",
      wrongSideNodeIds
    );
  }
}

/** Computes an idempotent node and metadata diff for one public identifier. */
async function buildImportPlan(
  ctx: ReadCtx,
  args: ImportArgs
): Promise<ImportPlan> {
  validateIncomingNodes(args.nodes);
  const mindmap = await ctx.db
    .query("mindmaps")
    .withIndex("by_publicId", (query) => query.eq("publicId", args.publicId))
    .unique();
  const incomingNodes = new Map(
    args.nodes.map((node) => [node.nodeId, node] as const)
  );

  if (mindmap === null) {
    return {
      mindmap,
      existingNodes: [],
      incomingNodes,
      summary: {
        status: "created",
        added: args.nodes.length,
        changed: 0,
        removed: 0,
      },
    };
  }

  const existingNodes = await ctx.db
    .query("nodes")
    .withIndex("by_mindmap", (query) => query.eq("mindmapId", mindmap._id))
    .collect();
  const existingById = new Map(
    existingNodes.map((node) => [node.nodeId, node] as const)
  );
  let added = 0;
  let changed = 0;

  for (const node of args.nodes) {
    const existing = existingById.get(node.nodeId);
    if (existing === undefined) {
      added += 1;
    } else if (!snapshotsEqual(toSnapshot(existing), node)) {
      changed += 1;
    }
  }

  const removed = existingNodes.filter(
    (node) => !incomingNodes.has(node.nodeId)
  ).length;
  const metadataChanged =
    mindmap.name !== args.name || mindmap.ownerId !== args.ownerId;
  const hasChanges = added + changed + removed > 0 || metadataChanged;

  return {
    mindmap,
    existingNodes,
    incomingNodes,
    summary: {
      status: hasChanges ? "updated" : "unchanged",
      added,
      changed,
      removed,
    },
  };
}

/**
 * Reports the import diff without changing data. This is internal so only an
 * administrator using the Convex CLI can invoke the migration surface.
 */
const previewMindmapImport = internalQuery({
  args: importArgs,
  handler: async (ctx, args): Promise<ImportSummary> => {
    try {
      const plan = await buildImportPlan(ctx, args);
      return plan.summary;
    } catch (error) {
      const rejected = getRejectedSummary(error);
      if (rejected !== null) return rejected;
      throw error;
    }
  },
});

/**
 * Idempotently imports one legacy mindmap by publicId.
 *
 * Clerk auth is bypassed by design: internal mutations are not callable from
 * the public client API and this one is reserved for administrator CLI runs.
 */
const importMindmap = internalMutation({
  args: importArgs,
  handler: async (ctx, args): Promise<ImportSummary> => {
    let plan: ImportPlan;

    try {
      plan = await buildImportPlan(ctx, args);
    } catch (error) {
      const rejected = getRejectedSummary(error);
      if (rejected !== null) return rejected;
      throw error;
    }

    if (plan.summary.status === "unchanged") {
      return plan.summary;
    }

    if (plan.mindmap === null) {
      const mindmapId = await ctx.db.insert("mindmaps", {
        publicId: args.publicId,
        name: args.name,
        ownerId: args.ownerId,
        visibility: "private",
        updatedAt: Date.now(),
      });

      for (const node of args.nodes) {
        await ctx.db.insert("nodes", { mindmapId, ...node });
      }

      return plan.summary;
    }

    const mindmapId: Id<"mindmaps"> = plan.mindmap._id;
    const existingById = new Map(
      plan.existingNodes.map((node) => [node.nodeId, node] as const)
    );

    for (const node of args.nodes) {
      const existing = existingById.get(node.nodeId);

      if (existing === undefined) {
        await ctx.db.insert("nodes", { mindmapId, ...node });
      } else if (!snapshotsEqual(toSnapshot(existing), node)) {
        // replace omits description/link when the incoming snapshot removed it.
        await ctx.db.replace(existing._id, { mindmapId, ...node });
      }
    }

    for (const existing of plan.existingNodes) {
      if (!plan.incomingNodes.has(existing.nodeId)) {
        await ctx.db.delete(existing._id);
      }
    }

    await ctx.db.patch("mindmaps", mindmapId, {
      name: args.name,
      ownerId: args.ownerId,
      updatedAt: Date.now(),
    });

    return plan.summary;
  },
});

export {
  type ImportArgs,
  importMindmap,
  type ImportSummary,
  previewMindmapImport,
};
