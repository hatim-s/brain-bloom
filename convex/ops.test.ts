// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts"]);
const firstHistoryPage = { numItems: 1, cursor: null };

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
  it("rejects batches larger than the transaction ceiling", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);

    await expect(
      asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops: Array.from({ length: 201 }, (_, index) => ({
          kind: "update",
          nodeId: "root",
          patch: { title: `Title ${index}` },
        })),
        description: "Oversized batch",
        source: "ai",
      })
    ).rejects.toThrow("Invalid op: too many operations");
  });

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

  it.each([
    {
      label: "a direct cycle",
      seed: [
        {
          kind: "create",
          node: {
            nodeId: "left-a",
            parentId: "root",
            type: "left",
            title: "A",
            order: 0,
          },
        },
      ],
      invalidOps: [
        {
          kind: "update",
          nodeId: "left-a",
          patch: { parentId: "left-a" },
        },
      ],
      message: "Invalid op: parent creates cycle",
    },
    {
      label: "a transitive cycle",
      seed: [
        {
          kind: "create",
          node: {
            nodeId: "left-a",
            parentId: "root",
            type: "left",
            title: "A",
            order: 0,
          },
        },
        {
          kind: "create",
          node: {
            nodeId: "left-b",
            parentId: "left-a",
            type: "left",
            title: "B",
            order: 0,
          },
        },
      ],
      invalidOps: [
        {
          kind: "update",
          nodeId: "left-a",
          patch: { parentId: "left-b" },
        },
      ],
      message: "Invalid op: parent creates cycle",
    },
    {
      label: "a cross-side create",
      seed: [
        {
          kind: "create",
          node: {
            nodeId: "right-parent",
            parentId: "root",
            type: "right",
            title: "Right",
            order: 0,
          },
        },
      ],
      invalidOps: [
        {
          kind: "create",
          node: {
            nodeId: "left-child",
            parentId: "right-parent",
            type: "left",
            title: "Left",
            order: 0,
          },
        },
      ],
      message: "Invalid op: parent is on another side",
    },
    {
      label: "a cross-side reparent",
      seed: [
        {
          kind: "create",
          node: {
            nodeId: "left-parent",
            parentId: "root",
            type: "left",
            title: "Left",
            order: 0,
          },
        },
        {
          kind: "create",
          node: {
            nodeId: "right-parent",
            parentId: "root",
            type: "right",
            title: "Right",
            order: 1,
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
      invalidOps: [
        {
          kind: "update",
          nodeId: "left-child",
          patch: { parentId: "right-parent" },
        },
      ],
      message: "Invalid op: parent is on another side",
    },
    {
      label: "a null non-root parent",
      seed: [
        {
          kind: "create",
          node: {
            nodeId: "left-a",
            parentId: "root",
            type: "left",
            title: "A",
            order: 0,
          },
        },
      ],
      invalidOps: [
        {
          kind: "update",
          nodeId: "left-a",
          patch: { parentId: null },
        },
      ],
      message: "Invalid op: non-root parent cannot be null",
    },
  ])("rejects $label", async ({ seed, invalidOps, message }) => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: seed,
      description: "Seed",
      source: "user",
    });

    await expect(
      asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops: invalidOps,
        description: "Invalid parent",
        source: "user",
      })
    ).rejects.toThrow(message);
  });

  it("treats a parent deleted earlier in the batch as nonexistent", async () => {
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
      ],
      description: "Seed",
      source: "user",
    });

    await expect(
      asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops: [
          { kind: "delete", nodeId: "left-parent" },
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
        description: "Invalid deleted parent",
        source: "user",
      })
    ).rejects.toThrow("Invalid op: parent does not exist");
  });

  it("accepts an atomic reorder within one parent", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-a",
            parentId: "root",
            type: "left",
            title: "A",
            order: 0,
          },
        },
        {
          kind: "create",
          node: {
            nodeId: "left-b",
            parentId: "root",
            type: "left",
            title: "B",
            order: 1,
          },
        },
        {
          kind: "create",
          node: {
            nodeId: "left-c",
            parentId: "root",
            type: "left",
            title: "C",
            order: 2,
          },
        },
      ],
      description: "Seed siblings",
      source: "user",
    });

    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        { kind: "update", nodeId: "left-a", patch: { order: 2 } },
        { kind: "update", nodeId: "left-c", patch: { order: 0 } },
      ],
      description: "Reorder siblings",
      source: "user",
    });
    const result = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });

    expect(
      result.nodes
        .filter((node) => node.parentId === "root")
        .map((node) => node.nodeId)
    ).toEqual(["left-c", "left-b", "left-a"]);
  });

  it("validates order updates against untouched database siblings", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-a",
            parentId: "root",
            type: "left",
            title: "A",
            order: 0,
          },
        },
        {
          kind: "create",
          node: {
            nodeId: "left-b",
            parentId: "root",
            type: "left",
            title: "B",
            order: 1,
          },
        },
      ],
      description: "Seed siblings",
      source: "user",
    });

    await expect(
      asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops: [{ kind: "update", nodeId: "left-b", patch: { order: 0 } }],
        description: "Duplicate order",
        source: "user",
      })
    ).rejects.toThrow("Invalid op: duplicate order");
    await expect(
      asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops: [{ kind: "update", nodeId: "left-b", patch: { order: 1.5 } }],
        description: "Fractional order",
        source: "user",
      })
    ).rejects.toThrow("Invalid op: invalid order");
  });

  it.each([
    {
      label: "a negative order",
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-a",
            parentId: "root",
            type: "left",
            title: "A",
            order: -1,
          },
        },
      ],
      message: "Invalid op: invalid order",
    },
    {
      label: "a fractional order",
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-a",
            parentId: "root",
            type: "left",
            title: "A",
            order: 0.5,
          },
        },
      ],
      message: "Invalid op: invalid order",
    },
    {
      label: "duplicate sibling orders",
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-a",
            parentId: "root",
            type: "left",
            title: "A",
            order: 0,
          },
        },
        {
          kind: "create",
          node: {
            nodeId: "left-b",
            parentId: "root",
            type: "left",
            title: "B",
            order: 0,
          },
        },
      ],
      message: "Invalid op: duplicate order",
    },
  ])("rejects $label", async ({ ops, message }) => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);

    await expect(
      asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops,
        description: "Invalid order",
        source: "user",
      })
    ).rejects.toThrow(message);
  });

  it("rejects an empty update patch", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);

    await expect(
      asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops: [{ kind: "update", nodeId: "root", patch: {} }],
        description: "Empty",
        source: "user",
      })
    ).rejects.toThrow("Invalid op: empty patch");
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

describe("ops.getOperation", () => {
  it("returns the bound mindmap, sequence, and undo state to its owner", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    const applied = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [],
      description: "Reviewed",
      source: "ai",
    });

    await expect(
      asAlice.query(api.ops.getOperation, {
        operationId: applied.operationId,
      })
    ).resolves.toEqual({
      mindmapId: map.mindmapId,
      seq: 1,
      undone: false,
    });
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
            order: 1,
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

    expect(undone).toEqual({
      seq: changed.seq,
      updatedAt: expect.any(Number),
    });
    expect(changed).toEqual({
      operationId: changed.operationId,
      seq: 2,
      updatedAt: expect.any(Number),
    });
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
            order: 1,
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

  it("removes a description through the mutation transport and restores it on undo", async () => {
    const { asAlice } = createHarness();
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
            title: "Child",
            order: 0,
          },
        },
      ],
      description: "Create",
      source: "user",
    });
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-1",
          patch: { description: "Restorable" },
        },
      ],
      description: "Set description",
      source: "user",
    });
    const removal = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-1",
          patch: { description: null },
        },
      ],
      description: "Remove description",
      source: "user",
    });
    const removed = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });

    expect(
      removed.nodes.find((node) => node.nodeId === "left-1")?.description
    ).toBeUndefined();

    await asAlice.mutation(api.ops.undo, {
      operationId: removal.operationId,
    });
    const restored = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });

    expect(
      restored.nodes.find((node) => node.nodeId === "left-1")?.description
    ).toBe("Restorable");
  });

  it("sets, removes, and inverts a node link", async () => {
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
            title: "Child",
            order: 0,
          },
        },
      ],
      description: "Create",
      source: "user",
    });
    const setLink = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-1",
          patch: { link: "https://example.com/child" },
        },
      ],
      description: "Set link",
      source: "user",
    });
    const removeLink = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-1",
          patch: { link: null },
        },
      ],
      description: "Remove link",
      source: "user",
    });
    let result = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });

    expect(
      result.nodes.find((node) => node.nodeId === "left-1")?.link
    ).toBeUndefined();

    await asAlice.mutation(api.ops.undo, {
      operationId: removeLink.operationId,
    });
    result = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });
    expect(result.nodes.find((node) => node.nodeId === "left-1")?.link).toBe(
      "https://example.com/child"
    );

    await asAlice.mutation(api.ops.undo, {
      operationId: setLink.operationId,
    });
    result = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });
    expect(
      result.nodes.find((node) => node.nodeId === "left-1")?.link
    ).toBeUndefined();

    await asAlice.mutation(api.ops.undo, {
      operationId: created.operationId,
    });
  });

  it("undoTo reverses a seq 5 AI operation and a later manual edit", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);

    for (let seq = 1; seq <= 4; seq += 1) {
      await asAlice.mutation(api.ops.apply, {
        mindmapId: map.mindmapId,
        ops: [],
        description: `History ${seq}`,
        source: "user",
      });
    }

    const aiOperation = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-ai",
            parentId: "root",
            type: "left",
            title: "AI",
            order: 0,
          },
        },
      ],
      description: "AI edit",
      source: "ai",
    });
    const manualOperation = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-ai",
          patch: { title: "Manual" },
        },
      ],
      description: "Manual edit",
      source: "user",
    });

    expect([aiOperation.seq, manualOperation.seq]).toEqual([5, 6]);

    const undone = await asAlice.mutation(api.ops.undoTo, {
      operationId: aiOperation.operationId,
    });
    const result = await asAlice.query(api.mindmaps.get, {
      mindmapId: map.mindmapId,
    });

    expect(undone).toEqual({
      undoneCount: 2,
      seq: 5,
      updatedAt: expect.any(Number),
    });
    expect(result.nodes.map((node) => node.nodeId)).toEqual(["root"]);
  });

  it("undoTo rejects an already-undone target", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    const operation = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [],
      description: "Empty history",
      source: "user",
    });
    await asAlice.mutation(api.ops.undo, {
      operationId: operation.operationId,
    });

    await expect(
      asAlice.mutation(api.ops.undoTo, {
        operationId: operation.operationId,
      })
    ).rejects.toThrow("Already undone");
  });

  it("undoTo skips interleaved already-undone operations", async () => {
    const { asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    const target = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-1",
            parentId: "root",
            type: "left",
            title: "One",
            order: 0,
          },
        },
      ],
      description: "Target",
      source: "ai",
    });
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-1",
          patch: { title: "Two" },
        },
      ],
      description: "Second",
      source: "user",
    });
    const third = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-1",
          patch: { title: "Three" },
        },
      ],
      description: "Third",
      source: "user",
    });
    await asAlice.mutation(api.ops.undo, {
      operationId: third.operationId,
    });
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "update",
          nodeId: "left-1",
          patch: { description: "Fourth" },
        },
      ],
      description: "Fourth",
      source: "user",
    });

    const result = await asAlice.mutation(api.ops.undoTo, {
      operationId: target.operationId,
    });

    expect(result).toEqual({
      undoneCount: 3,
      seq: 1,
      updatedAt: expect.any(Number),
    });
    expect(
      (
        await asAlice.query(api.mindmaps.get, {
          mindmapId: map.mindmapId,
        })
      ).nodes.map((node) => node.nodeId)
    ).toEqual(["root"]);
  });

  it("round-trips a composed evolving-state batch through undoTo", async () => {
    const { t, asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "other",
            parentId: "root",
            type: "right",
            title: "Other",
            order: 0,
          },
        },
      ],
      description: "Seed other",
      source: "user",
    });
    const before = await readNodeRows(t, map.mindmapId);
    const composed = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "left-parent",
            parentId: "root",
            type: "left",
            title: "Parent",
            order: 1,
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
        {
          kind: "update",
          nodeId: "left-child",
          patch: { title: "Updated child" },
        },
        { kind: "delete", nodeId: "other" },
      ],
      description: "Compose state",
      source: "ai",
    });

    await asAlice.mutation(api.ops.undoTo, {
      operationId: composed.operationId,
    });

    expect(await readNodeRows(t, map.mindmapId)).toEqual(before);
  });

  it("authenticates before probing operation ids in undo and undoTo", async () => {
    const { t, asAlice } = createHarness();
    const map = await createMindmap(asAlice);
    const operation = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [],
      description: "Probe",
      source: "user",
    });

    await expect(
      t.mutation(api.ops.undo, { operationId: operation.operationId })
    ).rejects.toThrow("Unauthenticated");
    await expect(
      t.mutation(api.ops.undoTo, { operationId: operation.operationId })
    ).rejects.toThrow("Unauthenticated");
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

  it("returns newest-first paginated history and records AI source", async () => {
    const { t, asAlice, asBob } = createHarness();
    const map = await createMindmap(asAlice);
    const firstOperation = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [],
      description: "User edit",
      source: "user",
    });
    const secondOperation = await asAlice.mutation(api.ops.apply, {
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

    await expect(
      asBob.query(api.ops.history, {
        mindmapId: map.mindmapId,
        paginationOpts: firstHistoryPage,
      })
    ).rejects.toThrow("Forbidden");

    const firstPage = await asAlice.query(api.ops.history, {
      mindmapId: map.mindmapId,
      paginationOpts: firstHistoryPage,
    });
    const secondPage = await asAlice.query(api.ops.history, {
      mindmapId: map.mindmapId,
      paginationOpts: {
        numItems: 1,
        cursor: firstPage.continueCursor,
      },
    });

    expect(
      [...firstPage.page, ...secondPage.page].map(
        ({ _id, seq, description, source, undone }) => ({
          _id,
          seq,
          description,
          source,
          undone,
        })
      )
    ).toEqual([
      {
        _id: secondOperation.operationId,
        seq: 2,
        description: "AI edit",
        source: "ai",
        undone: false,
      },
      {
        _id: firstOperation.operationId,
        seq: 1,
        description: "User edit",
        source: "user",
        undone: false,
      },
    ]);
    expect(firstPage.isDone).toBe(false);
    expect(secondPage.isDone).toBe(true);
    expect(
      [...firstPage.page, ...secondPage.page].every(
        (entry) => entry._creationTime > 0
      )
    ).toBe(true);
  });
});
