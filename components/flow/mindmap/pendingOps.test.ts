import { describe, expect, it } from "vitest";

import { appendPendingOp, describePendingOps, type NodeOp } from "./pendingOps";

const createOp: NodeOp = {
  kind: "create",
  source: "user",
  node: {
    nodeId: "left-1",
    parentId: "root",
    type: "left",
    title: "Draft",
    description: "Remove me",
    order: 0,
  },
};

describe("appendPendingOp", () => {
  it("appends unrelated operations without mutating the source queue", () => {
    const queue: NodeOp[] = [createOp];
    const result = appendPendingOp(queue, {
      kind: "update",
      source: "user",
      nodeId: "right-1",
      patch: { title: "Other" },
    });

    expect(result).toHaveLength(2);
    expect(queue).toEqual([createOp]);
  });

  it("merges consecutive updates to the same node", () => {
    const result = appendPendingOp(
      [
        {
          kind: "update",
          source: "user",
          nodeId: "left-1",
          patch: { title: "First", description: "Detail" },
        },
      ],
      {
        kind: "update",
        source: "user",
        nodeId: "left-1",
        patch: { title: "Final", link: null },
      }
    );

    expect(result).toEqual([
      {
        kind: "update",
        source: "user",
        nodeId: "left-1",
        patch: { title: "Final", description: "Detail", link: null },
      },
    ]);
  });

  it("folds an update and null removal into the preceding create", () => {
    const result = appendPendingOp([createOp], {
      kind: "update",
      source: "user",
      nodeId: "left-1",
      patch: { title: "Final", description: null, link: "https://example.com" },
    });

    expect(result).toEqual([
      {
        kind: "create",
        source: "user",
        node: {
          nodeId: "left-1",
          parentId: "root",
          type: "left",
          title: "Final",
          link: "https://example.com",
          order: 0,
        },
      },
    ]);
  });

  it("does not coalesce across a flushed watermark or source boundary", () => {
    const protectedResult = appendPendingOp(
      [
        {
          kind: "update",
          source: "user",
          nodeId: "left-1",
          patch: { title: "In flight" },
        },
      ],
      {
        kind: "update",
        source: "user",
        nodeId: "left-1",
        patch: { title: "New edit" },
      },
      1
    );
    const mixedSourceResult = appendPendingOp(protectedResult, {
      kind: "update",
      source: "ai",
      nodeId: "left-1",
      patch: { description: "Generated" },
    });

    expect(protectedResult).toHaveLength(2);
    expect(mixedSourceResult).toHaveLength(3);
  });
});

describe("describePendingOps", () => {
  it("summarizes each operation kind with correct pluralization", () => {
    expect(describePendingOps([createOp])).toBe("Added 1 node");
    expect(describePendingOps([createOp, createOp])).toBe("Added 1 node");
    expect(
      describePendingOps([
        createOp,
        {
          kind: "update",
          source: "user",
          nodeId: "left-2",
          patch: { title: "Edited" },
        },
      ])
    ).toBe("Added 1 node, Edited 1 node");
  });
});
