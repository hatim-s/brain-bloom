// @vitest-environment edge-runtime

import { describe, expect, it } from "vitest";

import { invertOps, type NodeOp, type NodeSnapshot } from "./nodeOps";

const root: NodeSnapshot = {
  nodeId: "root",
  parentId: null,
  type: "root",
  title: "Map",
  order: 0,
};

const child: NodeSnapshot = {
  nodeId: "left-1",
  parentId: "root",
  type: "left",
  title: "Child",
  description: "Before",
  order: 0,
};

/**
 * Applies the pure operation algebra to a snapshot map for round-trip tests.
 */
function applyPure(
  state: Map<string, NodeSnapshot>,
  ops: NodeOp[]
): Map<string, NodeSnapshot> {
  const next = new Map<string, NodeSnapshot>();

  state.forEach((node, nodeId) => {
    next.set(nodeId, { ...node });
  });

  for (const op of ops) {
    if (op.kind === "create") {
      next.set(op.node.nodeId, { ...op.node });
    } else if (op.kind === "update") {
      const existing = next.get(op.nodeId);
      if (existing === undefined) throw new Error("Unknown node");
      next.set(op.nodeId, { ...existing, ...op.patch });
    } else {
      next.delete(op.nodeId);
    }
  }

  return next;
}

describe("invertOps", () => {
  it("round-trips a create operation", () => {
    const preImage = new Map([["root", root]]);
    const ops: NodeOp[] = [{ kind: "create", node: child }];
    const changed = applyPure(preImage, ops);

    expect(applyPure(changed, invertOps(ops, preImage))).toEqual(preImage);
  });

  it("round-trips an update operation", () => {
    const preImage = new Map([
      ["root", root],
      ["left-1", child],
    ]);
    const ops: NodeOp[] = [
      {
        kind: "update",
        nodeId: "left-1",
        patch: { title: "After", order: 3 },
      },
    ];
    const changed = applyPure(preImage, ops);

    expect(applyPure(changed, invertOps(ops, preImage))).toEqual(preImage);
  });

  it("round-trips a delete operation with its full snapshot", () => {
    const preImage = new Map([
      ["root", root],
      ["left-1", child],
    ]);
    const ops: NodeOp[] = [{ kind: "delete", nodeId: "left-1" }];
    const changed = applyPure(preImage, ops);

    expect(invertOps(ops, preImage)).toEqual([{ kind: "create", node: child }]);
    expect(applyPure(changed, invertOps(ops, preImage))).toEqual(preImage);
  });

  it("reverses inverse order across a sequential batch", () => {
    const rightChild: NodeSnapshot = {
      nodeId: "right-1",
      parentId: "root",
      type: "right",
      title: "Right",
      order: 0,
    };
    const preImage = new Map([["root", root]]);
    const ops: NodeOp[] = [
      { kind: "create", node: child },
      { kind: "create", node: rightChild },
    ];

    expect(invertOps(ops, preImage)).toEqual([
      { kind: "delete", nodeId: "right-1" },
      { kind: "delete", nodeId: "left-1" },
    ]);
  });

  it("inverts only the exact update fields and removes an added description", () => {
    const childWithoutDescription = {
      ...child,
      description: undefined,
    };
    delete childWithoutDescription.description;
    const preImage = new Map([
      ["root", root],
      ["left-1", childWithoutDescription],
    ]);
    const inverse = invertOps(
      [
        {
          kind: "update",
          nodeId: "left-1",
          patch: { title: "After", description: "Added" },
        },
      ],
      preImage
    );

    expect(inverse).toEqual([
      {
        kind: "update",
        nodeId: "left-1",
        patch: { title: "Child", description: undefined },
      },
    ]);
    expect(Object.keys((inverse[0] as { patch: object }).patch)).toEqual([
      "title",
      "description",
    ]);
  });

  it("restores a removed description", () => {
    const preImage = new Map([
      ["root", root],
      ["left-1", child],
    ]);

    expect(
      invertOps(
        [
          {
            kind: "update",
            nodeId: "left-1",
            patch: { description: undefined },
          },
        ],
        preImage
      )
    ).toEqual([
      {
        kind: "update",
        nodeId: "left-1",
        patch: { description: "Before" },
      },
    ]);
  });

  it("throws for updates and deletes of unknown nodes", () => {
    const preImage = new Map([["root", root]]);

    expect(() =>
      invertOps(
        [{ kind: "update", nodeId: "missing", patch: { title: "Nope" } }],
        preImage
      )
    ).toThrow("Unknown node");
    expect(() =>
      invertOps([{ kind: "delete", nodeId: "missing" }], preImage)
    ).toThrow("Unknown node");
  });
});
