// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts"]);

/**
 * Creates a fresh operation-test harness with two authenticated users.
 */
function createHarness() {
  const t = convexTest(schema, modules);

  return {
    t,
    asAlice: t.withIdentity({ subject: "alice" }),
    asBob: t.withIdentity({ subject: "bob" }),
  };
}

type Harness = ReturnType<typeof createHarness>;

/**
 * Creates a mindmap through the public mutation for an operation test.
 */
async function createMindmap(
  asAlice: Harness["asAlice"],
  name = "Operation map"
) {
  return asAlice.mutation(api.mindmaps.create, { name });
}

/**
 * Reads stable application node fields without Convex system metadata.
 */
async function readNodeRows(t: Harness["t"], mindmapId: string) {
  return t.run(async (ctx) => {
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_mindmap", (q) => q.eq("mindmapId", mindmapId as never))
      .collect();

    return nodes
      .map(({ _id: _documentId, _creationTime: _createdAt, ...node }) => node)
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  });
}

describe("ops.apply", () => {
  it("applies create, update, and delete operations", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);

    const created = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-1",
            parentId: "root",
            type: "left",
            title: "Draft",
            order: 0,
          },
        },
      ],
      description: "Added a node",
      source: "user",
    });
    const updated = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-1",
          patch: {
            title: "Final",
            description: "Ready",
            order: 2,
          },
        },
      ],
      description: "Updated a node",
      source: "user",
    });
    const afterUpdate = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });

    expect(created.seq).toBe(1);
    expect(updated.seq).toBe(2);
    expect(
      afterUpdate.nodes.find((node) => node.nodeId === "left-1")
    ).toMatchObject({
      title: "Final",
      description: "Ready",
      order: 2,
    });

    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [{ kind: "delete", nodeId: "left-1" }],
      description: "Deleted a node",
      source: "user",
    });
    const afterDelete = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });

    expect(afterDelete.nodes.map((node) => node.nodeId)).toEqual(["root"]);
  });

  it("allows a node to parent another node created earlier in the batch", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);

    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-parent",
            parentId: "root",
            type: "left",
            title: "Parent",
            order: 0,
          },
        },
        {
          kind: "create",
          node: {
            nodeId: "left-child",
            parentId: "left-parent",
            type: "left",
            title: "Child",
            order: 0,
          },
        },
      ],
      description: "Added a branch",
      source: "user",
    });
    const result = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });

    expect(
      result.nodes.find((node) => node.nodeId === "left-child")
    ).toMatchObject({ parentId: "left-parent", title: "Child" });
  });

  it.each([
    {
      label: "an existing create node id",
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "root",
            parentId: "root",
            type: "left",
            title: "Duplicate",
            order: 0,
          },
        },
      ],
      message: "Invalid op: node already exists",
    },
    {
      label: "a missing create parent",
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "orphan",
            parentId: "missing",
            type: "left",
            title: "Orphan",
            order: 0,
          },
        },
      ],
      message: "Invalid op: parent does not exist",
    },
    {
      label: "another root",
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "root-2",
            parentId: "root",
            type: "root",
            title: "Root",
            order: 0,
          },
        },
      ],
      message: "Invalid op: cannot create root",
    },
    {
      label: "an update to a missing node",
      ops: [
        {
          kind: "update",
          nodeId: "missing",
          patch: { title: "Nope" },
        },
      ],
      message: "Invalid op: node does not exist",
    },
    {
      label: "an update to the root parent",
      ops: [
        {
          kind: "update",
          nodeId: "root",
          patch: { parentId: "other" },
        },
      ],
      message: "Invalid op: cannot update root parentId or type",
    },
    {
      label: "an update to the root type",
      ops: [
        {
          kind: "update",
          nodeId: "root",
          patch: { type: "left" },
        },
      ],
      message: "Invalid op: cannot update root parentId or type",
    },
    {
      label: "a delete of a missing node",
      ops: [{ kind: "delete", nodeId: "missing" }],
      message: "Invalid op: node does not exist",
    },
    {
      label: "a delete of the root",
      ops: [{ kind: "delete", nodeId: "root" }],
      message: "Invalid op: cannot delete root",
    },
  ])("rejects $label before writing", async ({ ops, message }) => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);

    await expect(
      asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops,
        description: "Invalid",
        source: "user",
      })
    ).rejects.toThrow(message);

    const result = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });
    expect(result.nodes.map((node) => node.nodeId)).toEqual(["root"]);
  });

  it("rejects deleting a node that still has children before any write", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);

    await expect(
      asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops: [
          {
            kind: "create",
            node: {
              nodeId: "parent",
              parentId: "root",
              type: "left",
              title: "Parent",
              order: 0,
            },
          },
          {
            kind: "create",
            node: {
              nodeId: "child",
              parentId: "parent",
              type: "left",
              title: "Child",
              order: 0,
            },
          },
          { kind: "delete", nodeId: "parent" },
        ],
        description: "Invalid branch delete",
        source: "user",
      })
    ).rejects.toThrow("Invalid op: node has children");

    const result = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });
    expect(result.nodes.map((node) => node.nodeId)).toEqual(["root"]);
  });

  it("requires ownership even when a mindmap is shared", async () => {
    const { t, asAlice, asBob } = createHarness();
    const map = await createMindmap(asAlice);
    await t.run(async (ctx) => {
      await ctx.db.patch("mindmaps", map.mindmapId, {
        visibility: "shared",
      });
    });

    await expect(
      asBob.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops: [],
        description: "Not allowed",
        source: "user",
      })
    ).rejects.toThrow("Forbidden");
  });
});

describe("ops.undo and history", () => {
  it("restores the exact application node rows after apply and undo", async () => {
    const { t, asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-1",
            parentId: "root",
            type: "left",
            title: "Existing",
            order: 0,
          },
        },
      ],
      description: "Seeded a node",
      source: "user",
    });
    const before = await readNodeRows(t, map.mindmapId);
    const changed = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-1",
          patch: { title: "Changed", description: "New details" },
        },
        {
          kind: "create",
          node: {
            nodeId: "right-1",
            parentId: "root",
            type: "right",
            title: "Temporary",
            order: 0,
          },
        },
      ],
      description: "Changed the map",
      source: "user",
    });

    const undone = await asAlice.mutation(api.ops.undo, {
      operationId: changed.operationId,
    });
    const after = await readNodeRows(t, map.mindmapId);

    expect(undone.seq).toBe(changed.seq);
    expect(after).toEqual(before);
  });

  it("rejects undoing a non-latest active operation", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    const first = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-1",
            parentId: "root",
            type: "left",
            title: "First",
            order: 0,
          },
        },
      ],
      description: "First",
      source: "user",
    });
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "right-1",
            parentId: "root",
            type: "right",
            title: "Second",
            order: 0,
          },
        },
      ],
      description: "Second",
      source: "user",
    });

    await expect(
      asAlice.mutation(api.ops.undo, { operationId: first.operationId })
    ).rejects.toThrow("Undo out of order");
  });

  it("rejects undoing the same operation twice", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    const operation = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-1",
            parentId: "root",
            type: "left",
            title: "First",
            order: 0,
          },
        },
      ],
      description: "First",
      source: "user",
    });

    await asAlice.mutation(api.ops.undo, {
      operationId: operation.operationId,
    });

    await expect(
      asAlice.mutation(api.ops.undo, {
        operationId: operation.operationId,
      })
    ).rejects.toThrow("Already undone");
  });

  it("increments sequence numbers independently per mindmap", async () => {
    const { asAlice } = createHarness();
    const firstMap = await createMindmap(asAlice, "First map");
    const secondMap = await createMindmap(asAlice, "Second map");
    const firstMapOne = await asAlice.mutation(api.ops.apply, {
      mindmapId: firstMap.mindmapId,
      ops: [],
      description: "First map one",
      source: "user",
    });
    const firstMapTwo = await asAlice.mutation(api.ops.apply, {
      mindmapId: firstMap.mindmapId,
      ops: [],
      description: "First map two",
      source: "user",
    });
    const secondMapOne = await asAlice.mutation(api.ops.apply, {
      mindmapId: secondMap.mindmapId,
      ops: [],
      description: "Second map one",
      source: "user",
    });

    expect([firstMapOne.seq, firstMapTwo.seq, secondMapOne.seq]).toEqual([
      1, 2, 1,
    ]);
  });

  it("returns newest-first history and records AI source", async () => {
    const { t, asAlice, asBob } = createHarness();
    const map = await createMindmap(asAlice);
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [],
      description: "User edit",
      source: "user",
    });
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [],
      description: "AI edit",
      source: "ai",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("mindmaps", map.mindmapId, {
        visibility: "shared",
      });
    });

    const history = await asBob.query(api.ops.history, {
      mindmapId: map.mindmapId,
    });

    expect(history).toHaveLength(2);
    expect(
      history.map(({ seq, description, source, undone }) => ({
        seq,
        description,
        source,
        undone,
      }))
    ).toEqual([
      {
        seq: 2,
        description: "AI edit",
        source: "ai",
        undone: false,
      },
      {
        seq: 1,
        description: "User edit",
        source: "user",
        undone: false,
      },
    ]);
    expect(history.every((entry) => entry._creationTime > 0)).toBe(true);
  });
});
