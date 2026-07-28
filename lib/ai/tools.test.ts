import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";

import { createMindmapTools, type MindmapToolConvexLayer } from "./tools";

const toolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
  context: {},
};

/** Creates a complete tool adapter with focused overrides for each test. */
function createConvexLayer(
  overrides: Partial<MindmapToolConvexLayer> = {}
): MindmapToolConvexLayer {
  return {
    getMindmap: vi.fn(async () => ({
      mindmap: { name: "Test map" },
      nodes: [
        {
          nodeId: "root",
          parentId: null,
          type: "root" as const,
          title: "Test map",
          order: 0,
        },
        {
          nodeId: "l-parent",
          parentId: "root",
          type: "left" as const,
          title: "Left parent",
          order: 0,
        },
        {
          nodeId: "r-parent",
          parentId: "root",
          type: "right" as const,
          title: "Right parent",
          order: 1,
        },
        {
          nodeId: "l-existing",
          parentId: "l-parent",
          type: "left" as const,
          title: "Existing child",
          order: 0,
        },
      ],
    })),
    applyOps: vi.fn(async () => ({ operationId: "operation-1", seq: 1 })),
    renameMindmap: vi.fn(async () => ({
      operationId: "operation-2",
      seq: 2,
    })),
    getHistory: vi.fn(async () => ({ page: [] })),
    getOperation: vi.fn(async () => ({
      mindmapId: "mindmap-1",
      seq: 1,
      undone: false,
    })),
    undoTo: vi.fn(async () => ({ undoneCount: 1, seq: 1 })),
    ...overrides,
  };
}

describe("createMindmapTools", () => {
  it("assigns create ids, sibling orders, root sides, and inherited sides", async () => {
    const convex = createConvexLayer();
    const generatedIds = ["l-new", "r-new", "l-child"];
    const tools = createMindmapTools({
      mindmapId: "mindmap-1",
      convex,
      createNodeId: () => generatedIds.shift()!,
    });

    const result = await tools.createNodes.execute(
      {
        nodes: [
          { parentId: "root", title: "Balanced default" },
          { parentId: "root", side: "right", title: "Explicit right" },
          {
            parentId: "l-parent",
            side: "right",
            title: "Inherits left",
          },
        ],
      },
      toolExecutionOptions
    );

    expect(result).toEqual({
      createdNodeIds: ["l-new", "r-new", "l-child"],
      operationId: "operation-1",
    });
    expect(convex.applyOps).toHaveBeenCalledWith({
      mindmapId: "mindmap-1",
      description: "Created 3 nodes",
      source: "ai",
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "l-new",
            parentId: "root",
            type: "left",
            title: "Balanced default",
            order: 2,
          },
        },
        {
          kind: "create",
          node: {
            nodeId: "r-new",
            parentId: "root",
            type: "right",
            title: "Explicit right",
            order: 3,
          },
        },
        {
          kind: "create",
          node: {
            nodeId: "l-child",
            parentId: "l-parent",
            type: "left",
            title: "Inherits left",
            order: 1,
          },
        },
      ],
    });
  });

  it("preserves null removal sentinels in update operations", async () => {
    const convex = createConvexLayer();
    const tools = createMindmapTools({
      mindmapId: "mindmap-1",
      convex,
    });

    await tools.updateNode.execute(
      {
        nodeId: "l-parent",
        description: null,
        link: null,
      },
      toolExecutionOptions
    );

    expect(convex.applyOps).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "ai",
        ops: [
          {
            kind: "update",
            nodeId: "l-parent",
            patch: { description: null, link: null },
          },
        ],
      })
    );
  });

  it("returns Convex mutation errors to the model", async () => {
    const convex = createConvexLayer({
      applyOps: vi.fn(async () => {
        throw new ConvexError("Invalid op: node has children");
      }),
    });
    const tools = createMindmapTools({
      mindmapId: "mindmap-1",
      convex,
    });

    await expect(
      tools.deleteNode.execute({ nodeId: "l-parent" }, toolExecutionOptions)
    ).resolves.toEqual({ error: "Invalid op: node has children" });
  });

  it("rejects a self-parent move before applying any operation", async () => {
    const convex = createConvexLayer();
    const tools = createMindmapTools({ mindmapId: "mindmap-1", convex });

    await expect(
      tools.moveNode.execute(
        { nodeId: "l-parent", newParentId: "l-parent" },
        toolExecutionOptions
      )
    ).resolves.toEqual({ error: "A node cannot be its own parent" });
    expect(convex.applyOps).not.toHaveBeenCalled();
  });

  it("passes the operation id through to undoTo", async () => {
    const undoTo = vi.fn(async () => ({ undoneCount: 3, seq: 4 }));
    const tools = createMindmapTools({
      mindmapId: "mindmap-1",
      convex: createConvexLayer({ undoTo }),
    });

    await expect(
      tools.undoOperation.execute(
        { operationId: "operation-4" },
        toolExecutionOptions
      )
    ).resolves.toEqual({ undoneCount: 3, seq: 4 });
    expect(undoTo).toHaveBeenCalledWith("operation-4");
  });

  it("rejects undoing an operation from another mindmap", async () => {
    const undoTo = vi.fn(async () => ({ undoneCount: 1, seq: 4 }));
    const tools = createMindmapTools({
      mindmapId: "mindmap-1",
      convex: createConvexLayer({
        getOperation: vi.fn(async () => ({
          mindmapId: "mindmap-2",
          seq: 4,
          undone: false,
        })),
        undoTo,
      }),
    });

    await expect(
      tools.undoOperation.execute(
        { operationId: "operation-4" },
        toolExecutionOptions
      )
    ).resolves.toEqual({
      error: "operation belongs to a different mindmap",
    });
    expect(undoTo).not.toHaveBeenCalled();
  });
});
