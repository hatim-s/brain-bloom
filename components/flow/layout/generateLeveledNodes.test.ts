import { describe, expect, it } from "vitest";

import { ROOT_NODE_ID } from "@/components/flow/const";
import { generateLeveledNodes } from "@/components/flow/layout/generateLeveledNodes";
import { MindmapNode, NodeTypes } from "@/components/flow/types";

/** Verifies breadth-first level grouping for complete and desynced node maps. */
describe("generateLeveledNodes", () => {
  it("groups a root and its left and right children by level", () => {
    const leftOne = createMindmapNode("l-one", NodeTypes.LEFT, ROOT_NODE_ID, 1);
    const leftTwo = createMindmapNode("l-two", NodeTypes.LEFT, ROOT_NODE_ID, 1);
    const rightOne = createMindmapNode(
      "r-one",
      NodeTypes.RIGHT,
      ROOT_NODE_ID,
      1
    );
    const rightTwo = createMindmapNode(
      "r-two",
      NodeTypes.RIGHT,
      ROOT_NODE_ID,
      1
    );
    const root = createRootNode([leftOne, leftTwo, rightOne, rightTwo]);
    const nodes = {
      [root.id]: root,
      [leftOne.id]: leftOne,
      [leftTwo.id]: leftTwo,
      [rightOne.id]: rightOne,
      [rightTwo.id]: rightTwo,
    };

    expect(generateLeveledNodes(nodes)).toEqual([
      [root],
      [leftOne, leftTwo, rightOne, rightTwo],
    ]);
  });

  it("assigns every node in a three-level branch to its depth", () => {
    const grandchild = createMindmapNode(
      "r-grandchild",
      NodeTypes.RIGHT,
      "r-child",
      2
    );
    const child = createMindmapNode(
      "r-child",
      NodeTypes.RIGHT,
      ROOT_NODE_ID,
      1,
      [grandchild]
    );
    const root = createRootNode([child]);
    const nodes = {
      [root.id]: root,
      [child.id]: child,
      [grandchild.id]: grandchild,
    };

    expect(generateLeveledNodes(nodes)).toEqual([
      [root],
      [child],
      [grandchild],
    ]);
  });

  it("returns an empty result for an empty node map", () => {
    expect(generateLeveledNodes({})).toEqual([]);
  });
});

function createRootNode(children: MindmapNode[]): MindmapNode {
  return {
    id: ROOT_NODE_ID,
    type: NodeTypes.ROOT,
    parentId: null,
    data: { title: "Root" },
    children: new Map(children.map((child) => [child.id, child])),
    level: 0,
  };
}

function createMindmapNode(
  id: string,
  type: NodeTypes.LEFT | NodeTypes.RIGHT,
  parentId: string,
  level: number,
  children: MindmapNode[] = []
): MindmapNode {
  return {
    id,
    type,
    parentId,
    data: { title: id },
    children: new Map(children.map((child) => [child.id, child])),
    level,
  };
}

/** Verifies bilateral insertion order across breadth-first levels. */
describe("generateLeveledNodes bilateral traversal", () => {
  it("groups three bilateral levels in child insertion order", () => {
    const leftAGrandchild = createMindmapNode(
      "l-a-child",
      NodeTypes.LEFT,
      "l-a",
      2
    );
    const rightAGrandchild = createMindmapNode(
      "r-a-child",
      NodeTypes.RIGHT,
      "r-a",
      2
    );
    const leftBGrandchild = createMindmapNode(
      "l-b-child",
      NodeTypes.LEFT,
      "l-b",
      2
    );
    const rightBGrandchild = createMindmapNode(
      "r-b-child",
      NodeTypes.RIGHT,
      "r-b",
      2
    );
    const leftA = createMindmapNode("l-a", NodeTypes.LEFT, ROOT_NODE_ID, 1, [
      leftAGrandchild,
    ]);
    const rightA = createMindmapNode("r-a", NodeTypes.RIGHT, ROOT_NODE_ID, 1, [
      rightAGrandchild,
    ]);
    const leftB = createMindmapNode("l-b", NodeTypes.LEFT, ROOT_NODE_ID, 1, [
      leftBGrandchild,
    ]);
    const rightB = createMindmapNode("r-b", NodeTypes.RIGHT, ROOT_NODE_ID, 1, [
      rightBGrandchild,
    ]);
    const root = createRootNode([leftA, rightA, leftB, rightB]);
    const nodes = {
      [root.id]: root,
      [leftA.id]: leftA,
      [rightA.id]: rightA,
      [leftB.id]: leftB,
      [rightB.id]: rightB,
      [leftAGrandchild.id]: leftAGrandchild,
      [rightAGrandchild.id]: rightAGrandchild,
      [leftBGrandchild.id]: leftBGrandchild,
      [rightBGrandchild.id]: rightBGrandchild,
    };

    expect(generateLeveledNodes(nodes)).toEqual([
      [root],
      [leftA, rightA, leftB, rightB],
      [leftAGrandchild, rightAGrandchild, leftBGrandchild, rightBGrandchild],
    ]);
  });

  it("skips a dangling child id and continues traversing valid children", () => {
    const leftChild = createMindmapNode(
      "l-child",
      NodeTypes.LEFT,
      ROOT_NODE_ID,
      1
    );
    const danglingChild = createMindmapNode(
      "r-missing",
      NodeTypes.RIGHT,
      ROOT_NODE_ID,
      1
    );
    const rightChild = createMindmapNode(
      "r-child",
      NodeTypes.RIGHT,
      ROOT_NODE_ID,
      1
    );
    const root = createRootNode([leftChild, danglingChild, rightChild]);
    const nodes = {
      [root.id]: root,
      [leftChild.id]: leftChild,
      [rightChild.id]: rightChild,
    };

    expect(generateLeveledNodes(nodes)).toEqual([
      [root],
      [leftChild, rightChild],
    ]);
  });
});
