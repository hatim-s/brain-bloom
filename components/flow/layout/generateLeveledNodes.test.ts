import { describe, expect, it } from "vitest";

import { ROOT_NODE_ID } from "@/components/flow/const";
import { generateLeveledNodes } from "@/components/flow/layout/generateLeveledNodes";
import { MindmapNode, NodeTypes } from "@/components/flow/types";

/** Characterization — pins breadth-first level grouping before the P3 migrations. */
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

    // KNOWN BUG (P3): the algorithm pushes a level before testing for termination, so
    // every result carries a trailing empty level. Asserted here to pin today's behavior;
    // when P3 removes it, delete the trailing `[]` instead of reverting the fix.
    expect(generateLeveledNodes(nodes)).toEqual([
      [root],
      [leftOne, leftTwo, rightOne, rightTwo],
      [],
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

    // KNOWN BUG (P3): the algorithm pushes a level before testing for termination, so
    // every result carries a trailing empty level. Asserted here to pin today's behavior;
    // when P3 removes it, delete the trailing `[]` instead of reverting the fix.
    expect(generateLeveledNodes(nodes)).toEqual([
      [root],
      [child],
      [grandchild],
      [],
    ]);
  });

  // generateLeveledNodes currently loops forever on an empty map: the root lookup yields
  // `undefined`, which is indistinguishable from the `null` level sentinel, so the queue
  // never drains. Fixing that is P3's job (canvas hardening); this records the contract.
  // P3d will make this input terminate safely.
  it.todo(
    "returns an empty result for an empty node map instead of looping forever"
  );
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

/** Characterization — pins bilateral insertion order and the P3d trailing-level bug. */
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
      [],
    ]);
  });

  // P3d will make a missing child id terminate safely instead of looping forever.
  it.todo(
    "handles a dangling child id without entering an infinite traversal loop"
  );
});
