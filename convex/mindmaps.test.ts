// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts"]);

/**
 * Creates an isolated Convex harness with owner and non-owner identities.
 */
function createHarness() {
  const t = convexTest(schema, modules);

  return {
    t,
    asAlice: t.withIdentity({ subject: "alice" }),
    asBob: t.withIdentity({ subject: "bob" }),
  };
}

describe("mindmaps", () => {
  it("creates a private mindmap with a URL-safe public id and root node", async () => {
    const { asAlice } = createHarness();
    const created = await asAlice.mutation(api.mindmaps.create, {
      name: "Launch plan",
    });
    const result = await asAlice.query(api.mindmaps.get, {
      mindmapId: created.mindmapId,
    });

    expect(created.publicId).toMatch(/^[a-z0-9]{10}$/);
    expect(result.mindmap).toMatchObject({
      name: "Launch plan",
      ownerId: "alice",
      publicId: created.publicId,
      visibility: "private",
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      mindmapId: created.mindmapId,
      nodeId: "root",
      parentId: null,
      type: "root",
      title: "Launch plan",
      order: 0,
    });
  });

  it("gets a mindmap by its public id", async () => {
    const { asAlice } = createHarness();
    const created = await asAlice.mutation(api.mindmaps.create, {
      name: "Public route",
    });

    const result = await asAlice.query(api.mindmaps.getByPublicId, {
      publicId: created.publicId,
    });

    expect(result.mindmap._id).toBe(created.mindmapId);
    expect(result.nodes.map((node) => node.nodeId)).toEqual(["root"]);
  });

  it("lists only the owner's mindmaps newest-updated first", async () => {
    const { t, asAlice, asBob } = createHarness();
    const older = await asAlice.mutation(api.mindmaps.create, {
      name: "Older",
    });
    const newer = await asAlice.mutation(api.mindmaps.create, {
      name: "Newer",
    });
    await asBob.mutation(api.mindmaps.create, { name: "Bob's map" });
    await t.run(async (ctx) => {
      await ctx.db.patch("mindmaps", older.mindmapId, { updatedAt: 1 });
      await ctx.db.patch("mindmaps", newer.mindmapId, { updatedAt: 2 });
    });

    const mine = await asAlice.query(api.mindmaps.listMine, {});

    expect(mine.map((mindmap) => mindmap.name)).toEqual(["Newer", "Older"]);
  });

  it("renames an owned mindmap and bumps its updated time", async () => {
    const { asAlice } = createHarness();
    const created = await asAlice.mutation(api.mindmaps.create, {
      name: "Before",
    });
    const before = await asAlice.query(api.mindmaps.get, {
      mindmapId: created.mindmapId,
    });

    await asAlice.mutation(api.mindmaps.rename, {
      mindmapId: created.mindmapId,
      name: "After",
    });
    const after = await asAlice.query(api.mindmaps.get, {
      mindmapId: created.mindmapId,
    });

    expect(after.mindmap.name).toBe("After");
    expect(after.mindmap.updatedAt).toBeGreaterThanOrEqual(
      before.mindmap.updatedAt
    );
  });

  it("requires authentication", async () => {
    const { t, asAlice } = createHarness();
    const created = await asAlice.mutation(api.mindmaps.create, {
      name: "Private",
    });

    await expect(
      t.query(api.mindmaps.get, { mindmapId: created.mindmapId })
    ).rejects.toThrow("Unauthenticated");
    await expect(t.query(api.mindmaps.listMine, {})).rejects.toThrow(
      "Unauthenticated"
    );
    await expect(
      t.mutation(api.mindmaps.create, { name: "Anonymous" })
    ).rejects.toThrow("Unauthenticated");
  });

  it("forbids a non-owner from reading or mutating a private mindmap", async () => {
    const { asAlice, asBob } = createHarness();
    const created = await asAlice.mutation(api.mindmaps.create, {
      name: "Private",
    });

    await expect(
      asBob.query(api.mindmaps.get, { mindmapId: created.mindmapId })
    ).rejects.toThrow("Forbidden");
    await expect(
      asBob.mutation(api.mindmaps.rename, {
        mindmapId: created.mindmapId,
        name: "Hijacked",
      })
    ).rejects.toThrow("Forbidden");
    await expect(
      asBob.mutation(api.mindmaps.remove, {
        mindmapId: created.mindmapId,
      })
    ).rejects.toThrow("Forbidden");
  });

  it("allows authenticated shared reads but still forbids non-owner writes", async () => {
    const { t, asAlice, asBob } = createHarness();
    const created = await asAlice.mutation(api.mindmaps.create, {
      name: "Shared",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("mindmaps", created.mindmapId, {
        visibility: "shared",
      });
    });

    const byId = await asBob.query(api.mindmaps.get, {
      mindmapId: created.mindmapId,
    });
    const byPublicId = await asBob.query(api.mindmaps.getByPublicId, {
      publicId: created.publicId,
    });

    expect(byId.mindmap._id).toBe(created.mindmapId);
    expect(byPublicId.mindmap._id).toBe(created.mindmapId);
    await expect(
      asBob.mutation(api.mindmaps.rename, {
        mindmapId: created.mindmapId,
        name: "Not allowed",
      })
    ).rejects.toThrow("Forbidden");
  });

  it("removes the mindmap and cascades every dependent table", async () => {
    const { t, asAlice } = createHarness();
    const created = await asAlice.mutation(api.mindmaps.create, {
      name: "Disposable",
    });
    const operation = await asAlice.mutation(api.ops.apply, {
      mindmapId: created.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-1",
            parentId: "root",
            type: "left",
            title: "Child",
            order: 0,
          },
        },
      ],
      description: "Added a node",
      source: "user",
    });
    const threadId = await asAlice.mutation(api.threads.createThread, {
      mindmapId: created.mindmapId,
      title: "Ideas",
    });
    const messageId = await asAlice.mutation(api.threads.addMessage, {
      threadId,
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      operationId: operation.operationId,
    });
    const nodeIds = await t.run(async (ctx) => {
      const nodes = await ctx.db
        .query("nodes")
        .withIndex("by_mindmap", (q) => q.eq("mindmapId", created.mindmapId))
        .collect();
      return nodes.map((node) => node._id);
    });

    await asAlice.mutation(api.mindmaps.remove, {
      mindmapId: created.mindmapId,
    });

    const remaining = await t.run(async (ctx) => ({
      mindmap: await ctx.db.get("mindmaps", created.mindmapId),
      nodes: await Promise.all(
        nodeIds.map((nodeId) => ctx.db.get("nodes", nodeId))
      ),
      operation: await ctx.db.get("operations", operation.operationId),
      thread: await ctx.db.get("threads", threadId),
      message: await ctx.db.get("messages", messageId),
    }));
    expect(remaining).toEqual({
      mindmap: null,
      nodes: nodeIds.map(() => null),
      operation: null,
      thread: null,
      message: null,
    });
  });
});
