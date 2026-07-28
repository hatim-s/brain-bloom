// @vitest-environment edge-runtime

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { NodeSnapshot } from "./lib/nodeOps";
import type { ImportArgs, ImportSummary } from "./migration";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts"]);
const importMindmap = makeFunctionReference<
  "mutation",
  ImportArgs,
  ImportSummary
>("migration:importMindmap");

const baseNodes: NodeSnapshot[] = [
  {
    nodeId: "root",
    parentId: null,
    type: "root",
    title: "Imported map",
    order: 0,
  },
  {
    nodeId: "left-1",
    parentId: "root",
    type: "left",
    title: "First child",
    order: 0,
  },
];

const baseArgs: ImportArgs = {
  ownerId: "clerk-owner",
  name: "Imported map",
  publicId: "legacy-42",
  nodes: baseNodes,
};

/** Creates a schema-aware Convex migration test harness. */
function createHarness() {
  return convexTest(schema, modules);
}

type Harness = ReturnType<typeof createHarness>;

describe("migration.importMindmap", () => {
  it("skips every write when the same payload is imported twice", async () => {
    const t = createHarness();

    const first = await t.mutation(importMindmap, baseArgs);
    const second = await t.mutation(importMindmap, baseArgs);

    expect(first).toEqual({
      status: "created",
      added: 2,
      changed: 0,
      removed: 0,
    });
    expect(second).toEqual({
      status: "unchanged",
      added: 0,
      changed: 0,
      removed: 0,
    });
    expect(await readImportedNodes(t)).toEqual(baseNodes);
  });

  it("updates a changed node in place", async () => {
    const t = createHarness();
    await t.mutation(importMindmap, baseArgs);

    const changedNodes = baseNodes.map((node) =>
      node.nodeId === "left-1" ? { ...node, title: "Changed child" } : node
    );
    const summary = await t.mutation(importMindmap, {
      ...baseArgs,
      nodes: changedNodes,
    });

    expect(summary).toEqual({
      status: "updated",
      added: 0,
      changed: 1,
      removed: 0,
    });
    expect((await readImportedNodes(t))[1].title).toBe("Changed child");
  });

  it("deletes nodes missing from the replacement payload", async () => {
    const t = createHarness();
    await t.mutation(importMindmap, baseArgs);

    const summary = await t.mutation(importMindmap, {
      ...baseArgs,
      nodes: [baseNodes[0]],
    });

    expect(summary).toEqual({
      status: "updated",
      added: 0,
      changed: 0,
      removed: 1,
    });
    expect(await readImportedNodes(t)).toEqual([baseNodes[0]]);
  });
});

/** Reads imported nodes without Convex system fields for stable assertions. */
async function readImportedNodes(t: Harness): Promise<NodeSnapshot[]> {
  return t.run(async (ctx) => {
    const mindmap = await ctx.db
      .query("mindmaps")
      .withIndex("by_publicId", (query) => query.eq("publicId", "legacy-42"))
      .unique();

    if (!mindmap) return [];

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (query) => query.eq("mindmapId", mindmap._id))
      .collect();

    return nodes
      .map((node) => ({
        nodeId: node.nodeId,
        parentId: node.parentId,
        type: node.type,
        title: node.title,
        ...(node.description === undefined
          ? {}
          : { description: node.description }),
        ...(node.link === undefined ? {} : { link: node.link }),
        order: node.order,
      }))
      .sort((left, right) => {
        const parentComparison = (left.parentId ?? "").localeCompare(
          right.parentId ?? ""
        );
        return parentComparison || left.order - right.order;
      });
  });
}
