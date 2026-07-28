import { ROOT_NODE_ID } from "../const";
import { MindmapNode, NodeTypes } from "../types";

/**
 * Builds the deterministic bilateral mindmap used to characterize canvas navigation.
 */
function buildMindmapFixture() {
  const leftAGrandchild: MindmapNode = {
    id: "left-a-child",
    type: NodeTypes.LEFT,
    parentId: "left-a",
    data: { title: "Left A child" },
    children: new Map(),
    level: 2,
  };
  const leftBGrandchild: MindmapNode = {
    id: "left-b-child",
    type: NodeTypes.LEFT,
    parentId: "left-b",
    data: { title: "Left B child" },
    children: new Map(),
    level: 2,
  };
  const rightAGrandchild: MindmapNode = {
    id: "right-a-child",
    type: NodeTypes.RIGHT,
    parentId: "right-a",
    data: { title: "Right A child" },
    children: new Map(),
    level: 2,
  };
  const rightBGrandchild: MindmapNode = {
    id: "right-b-child",
    type: NodeTypes.RIGHT,
    parentId: "right-b",
    data: { title: "Right B child" },
    children: new Map(),
    level: 2,
  };
  const leftA: MindmapNode = {
    id: "left-a",
    type: NodeTypes.LEFT,
    parentId: ROOT_NODE_ID,
    data: { title: "Left A" },
    children: new Map([[leftAGrandchild.id, leftAGrandchild]]),
    level: 1,
  };
  const rightA: MindmapNode = {
    id: "right-a",
    type: NodeTypes.RIGHT,
    parentId: ROOT_NODE_ID,
    data: { title: "Right A" },
    children: new Map([[rightAGrandchild.id, rightAGrandchild]]),
    level: 1,
  };
  const leftB: MindmapNode = {
    id: "left-b",
    type: NodeTypes.LEFT,
    parentId: ROOT_NODE_ID,
    data: { title: "Left B" },
    children: new Map([[leftBGrandchild.id, leftBGrandchild]]),
    level: 1,
  };
  const rightB: MindmapNode = {
    id: "right-b",
    type: NodeTypes.RIGHT,
    parentId: ROOT_NODE_ID,
    data: { title: "Right B" },
    children: new Map([[rightBGrandchild.id, rightBGrandchild]]),
    level: 1,
  };
  const root: MindmapNode = {
    id: ROOT_NODE_ID,
    type: NodeTypes.ROOT,
    parentId: null,
    data: { title: "Root" },
    children: new Map([
      [leftA.id, leftA],
      [rightA.id, rightA],
      [leftB.id, leftB],
      [rightB.id, rightB],
    ]),
    level: 0,
  };
  const nodesMap: Record<string, MindmapNode> = {
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

  return {
    nodes: {
      root,
      leftA,
      rightA,
      leftB,
      rightB,
      leftAGrandchild,
      rightAGrandchild,
      leftBGrandchild,
      rightBGrandchild,
    },
    nodesMap,
    leveledNodes: [
      [root],
      [leftA, rightA, leftB, rightB],
      [leftAGrandchild, rightAGrandchild, leftBGrandchild, rightBGrandchild],
      [],
    ],
  };
}

export { buildMindmapFixture };
