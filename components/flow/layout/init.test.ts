import { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { ROOT_NODE_ID } from "../const";
import { BaseFlowNode, FlowNode, NodeTypes } from "../types";
import {
  getNodeDimensions,
  initGraphs,
  initLayout,
  NODE_DIMENSIONS,
  ROOT_NODE_DIMENSIONS,
} from "./init";

/** Characterization — guards the dagre 3.0 upgrade in P3b. */
describe("initLayout and initGraphs", () => {
  it("keeps the exported node dimensions exact", () => {
    expect(NODE_DIMENSIONS).toEqual({ height: 60, width: 300 });
    expect(ROOT_NODE_DIMENSIONS).toEqual({ height: 120, width: 300 });
  });

  it("calculates the literal node height without a description", () => {
    const node = createFlowNode("right-a", NodeTypes.RIGHT);

    expect(getNodeDimensions(node)).toEqual({ height: 52, width: 300 });
  });

  it("calculates the literal node height with a description", () => {
    const node = createFlowNode(
      "right-a",
      NodeTypes.RIGHT,
      "Two lines of description"
    );

    expect(getNodeDimensions(node)).toEqual({ height: 100, width: 300 });
  });

  it("positions a root-only graph at the origin", () => {
    const root = createFlowNode(ROOT_NODE_ID, NodeTypes.ROOT);

    const result = roundNodePositions(initLayout(initGraphs(), [root], []));

    expect(result[0].position).toEqual({ x: 0, y: 0 });
    expect(result).toMatchSnapshot();
  });

  it("lays out a root with two right children", () => {
    const root = createFlowNode(ROOT_NODE_ID, NodeTypes.ROOT);
    const rightA = createFlowNode("right-a", NodeTypes.RIGHT);
    const rightB = createFlowNode("right-b", NodeTypes.RIGHT);
    const edges = [
      createFlowEdge(root.id, rightA.id),
      createFlowEdge(root.id, rightB.id),
    ];

    const result = roundNodePositions(
      initLayout(initGraphs(), [root, rightA, rightB], edges)
    );

    expect(result).toMatchSnapshot();
  });

  it("keeps bilateral branches on opposite sides of the root", () => {
    const root = createFlowNode(ROOT_NODE_ID, NodeTypes.ROOT);
    const leftA = createFlowNode("left-a", NodeTypes.LEFT);
    const leftB = createFlowNode("left-b", NodeTypes.LEFT);
    const leftGrandchild = createFlowNode("left-a-child", NodeTypes.LEFT);
    const rightA = createFlowNode("right-a", NodeTypes.RIGHT);
    const rightB = createFlowNode("right-b", NodeTypes.RIGHT);
    const rightGrandchild = createFlowNode("right-a-child", NodeTypes.RIGHT);
    const nodes = [
      root,
      leftA,
      leftB,
      leftGrandchild,
      rightA,
      rightB,
      rightGrandchild,
    ];
    const edges = [
      createFlowEdge(root.id, leftA.id),
      createFlowEdge(root.id, leftB.id),
      createFlowEdge(leftA.id, leftGrandchild.id),
      createFlowEdge(root.id, rightA.id),
      createFlowEdge(root.id, rightB.id),
      createFlowEdge(rightA.id, rightGrandchild.id),
    ];

    const result = roundNodePositions(initLayout(initGraphs(), nodes, edges));

    expect(
      result
        .filter((node) => node.type === NodeTypes.LEFT)
        .every((node) => node.position.x < 0)
    ).toBe(true);
    expect(
      result
        .filter((node) => node.type === NodeTypes.RIGHT)
        .every((node) => node.position.x > 0)
    ).toBe(true);
    expect(result).toMatchSnapshot();
  });

  it("increases sibling spacing when a child has a description", () => {
    const root = createFlowNode(ROOT_NODE_ID, NodeTypes.ROOT);
    const rightA = createFlowNode(
      "right-a",
      NodeTypes.RIGHT,
      "Two lines of description"
    );
    const rightB = createFlowNode("right-b", NodeTypes.RIGHT);
    const edges = [
      createFlowEdge(root.id, rightA.id),
      createFlowEdge(root.id, rightB.id),
    ];
    const baselineRoot = createFlowNode(ROOT_NODE_ID, NodeTypes.ROOT);
    const baselineRightA = createFlowNode("right-a", NodeTypes.RIGHT);
    const baselineRightB = createFlowNode("right-b", NodeTypes.RIGHT);
    const baselineEdges = [
      createFlowEdge(baselineRoot.id, baselineRightA.id),
      createFlowEdge(baselineRoot.id, baselineRightB.id),
    ];

    const result = roundNodePositions(
      initLayout(initGraphs(), [root, rightA, rightB], edges)
    );
    const baseline = roundNodePositions(
      initLayout(
        initGraphs(),
        [baselineRoot, baselineRightA, baselineRightB],
        baselineEdges
      )
    );
    const resultSpacing = Math.abs(result[1].position.y - result[2].position.y);
    const baselineSpacing = Math.abs(
      baseline[1].position.y - baseline[2].position.y
    );

    expect(resultSpacing).not.toBe(baselineSpacing);
    expect(result).toMatchSnapshot();
  });
});

/** Creates the minimum typed node shape consumed by the layout initializer. */
function createFlowNode(
  id: string,
  type: NodeTypes,
  description?: string
): BaseFlowNode {
  return {
    id,
    type,
    data: {
      title: id === ROOT_NODE_ID ? "Root" : id,
      ...(description ? { description } : {}),
    },
  };
}

/** Creates a deterministic edge for a layout fixture. */
function createFlowEdge(source: string, target: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
  };
}

/** Rounds only calculated coordinates so snapshots ignore floating-point noise. */
function roundNodePositions(nodes: FlowNode[]): FlowNode[] {
  return nodes.map((node) => ({
    ...node,
    position: {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    },
  }));
}
