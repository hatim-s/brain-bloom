import { describe, expect, it } from "vitest";

import { buildMindmapFixture } from "../testing/fixtures";
import { MindmapNode } from "../types";
import { navigate, Operation } from "./navigate";

/** Characterization — pins directional canvas navigation before the P3 migrations. */
describe("navigate", () => {
  it("moving right from a left node goes to its parent", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.RIGHT,
      nodes.leftAGrandchild,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.leftA);
  });

  it("moving right from a right node goes to its first child", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.RIGHT,
      nodes.rightA,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.rightAGrandchild);
  });

  it("moving right from the root goes to its first right child", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.RIGHT,
      nodes.root,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.rightA);
  });

  it("moving left from a right node goes to its parent", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.LEFT,
      nodes.rightAGrandchild,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.rightA);
  });

  it("moving left from a left node goes to its first child", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.LEFT,
      nodes.leftA,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.leftAGrandchild);
  });

  it("moving left from the root goes to its first left child", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(Operation.LEFT, nodes.root, nodesMap, leveledNodes);

    expect(result).toBe(nodes.leftA);
  });

  it("moving up from a left node goes to the previous left sibling", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(Operation.UP, nodes.leftB, nodesMap, leveledNodes);

    expect(result).toBe(nodes.leftA);
  });

  it("moving down from a left node goes to the next left sibling", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.DOWN,
      nodes.leftA,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.leftB);
  });

  it("moving up from a right node goes to the previous right sibling", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(Operation.UP, nodes.rightB, nodesMap, leveledNodes);

    expect(result).toBe(nodes.rightA);
  });

  it("moving down from a right node goes to the next right sibling", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.DOWN,
      nodes.rightA,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.rightB);
  });

  it("moving down can cross parent branches within the same type and level", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.DOWN,
      nodes.leftAGrandchild,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.leftBGrandchild);
  });

  it("moving up from the root keeps the root active", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(Operation.UP, nodes.root, nodesMap, leveledNodes);

    expect(result).toBe(nodes.root);
  });

  it("moving down from the root keeps the root active", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(Operation.DOWN, nodes.root, nodesMap, leveledNodes);

    expect(result).toBe(nodes.root);
  });

  it("moving up from the first same-type sibling keeps it active", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(Operation.UP, nodes.leftA, nodesMap, leveledNodes);

    expect(result).toBe(nodes.leftA);
  });

  it("moving down from the last same-type sibling keeps it active", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.DOWN,
      nodes.rightB,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.rightB);
  });

  it("moving right from a right leaf keeps it active", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.RIGHT,
      nodes.rightAGrandchild,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.rightAGrandchild);
  });

  it("moving left from a left leaf keeps it active", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();

    const result = navigate(
      Operation.LEFT,
      nodes.leftAGrandchild,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(nodes.leftAGrandchild);
  });

  it("moving left from a root with no left children keeps it active", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();
    nodes.root.children = new Map([
      [nodes.rightA.id, nodes.rightA],
      [nodes.rightB.id, nodes.rightB],
    ]);

    const result = navigate(Operation.LEFT, nodes.root, nodesMap, leveledNodes);

    expect(result).toBe(nodes.root);
  });

  it("falling back from a dangling parent keeps the current node active", () => {
    const { leveledNodes, nodes, nodesMap } = buildMindmapFixture();
    const danglingParentNode: MindmapNode = {
      ...nodes.leftA,
      parentId: "left-missing",
    };

    const result = navigate(
      Operation.RIGHT,
      danglingParentNode,
      nodesMap,
      leveledNodes
    );

    expect(result).toBe(danglingParentNode);
  });
});
