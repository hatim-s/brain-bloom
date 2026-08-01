// @vitest-environment node

import { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { ROOT_NODE_ID } from "../const";
import { createEdge } from "../mindmap/createEdge";
import { BaseFlowNode, FlowNode, NodeTypes } from "../types";
import {
  layoutGrove,
  MAX_BRANCH_PROMOTION,
  POLE_CLEARANCE,
  RADIUS_JITTER_LIMIT,
  RADIUS_JITTER_RATIO,
  ringHeight,
  ringRadius,
  ringVerticalReach,
} from "./grove";
import { estimateNodeSize, type NodeSize } from "./nodeSize";

/** The clearance every pair of cards must keep, in px. */
const REQUIRED_MARGIN = 24;

/**
 * The largest card that can land on one ring.
 *
 * Cards are sized by tree depth, and radial relief lifts a branch outward by at
 * most `MAX_BRANCH_PROMOTION` rings — so ring `r` carries depths
 * `r - MAX_BRANCH_PROMOTION .. r`, and the shallowest of those is the widest
 * and tallest card the ring has to make room for. The root never leaves the
 * origin, so depth 1 is the floor.
 */
function widestCardOnRing(ring: number): NodeSize {
  return estimateNodeSize(
    { data: { description: "Two lines of body copy." } },
    Math.max(1, ring - MAX_BRANCH_PROMOTION)
  );
}

/**
 * Inner/outer ring expansion pairs the clearance certificate is proved over.
 *
 * `measureRingScales` widens a crowded ring on its own and keeps the scales
 * non-decreasing outward, so the outer ring is never expanded less than the
 * inner one — the certificate only has to hold for that half of the plane.
 */
const RING_EXPANSIONS = [
  [1, 1],
  [1, 1.5],
  [1.5, 1.5],
  [1.5, 2.5],
  [2.5, 2.5],
  [1, 3.5],
] as const;

describe("layoutGrove", () => {
  it("plants the root at the origin", () => {
    const graph = buildGrove(1);

    const [root] = layoutGrove(graph.nodes, graph.edges);
    const size = estimateNodeSize(root, 0);

    expect(centerOf(root, 0)).toEqual({ x: 0, y: 0 });
    expect(root.position).toEqual({ x: -size.width / 2, y: -size.height / 2 });
  });

  it("returns nothing for an empty graph", () => {
    expect(layoutGrove([], [])).toEqual([]);
  });

  it("is bit-identical across independent runs", () => {
    const graph = buildGrove(30);

    const first = layoutGrove(graph.nodes, graph.edges);
    const second = layoutGrove(graph.nodes, graph.edges);

    expect(positionsOf(second)).toEqual(positionsOf(first));
  });

  it("ignores the order of the node array", () => {
    const graph = buildGrove(30);
    const shuffled = shuffleDeterministically(graph.nodes);

    const laidOut = layoutGrove(graph.nodes, graph.edges);
    const reordered = layoutGrove(shuffled, graph.edges);

    // Sibling order lives in the edges; the node array is just a bag of cards.
    expect(new Map(positionsOf(reordered))).toEqual(
      new Map(positionsOf(laidOut))
    );
  });

  it("keeps each hemisphere on its own side of the root", () => {
    const graph = buildGrove(30);
    const depths = depthsOf(graph.edges);

    const laidOut = layoutGrove(graph.nodes, graph.edges);

    for (const node of laidOut) {
      const center = centerOf(node, depths.get(node.id) ?? 0);
      if (node.type === NodeTypes.LEFT) {
        expect(center.x).toBeLessThan(0);
        expect(node.position.x).toBeLessThan(0);
      }
      if (node.type === NodeTypes.RIGHT) {
        expect(center.x).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every card clear of the corridor between the hemispheres", () => {
    const graph = buildGrove(60);
    const depths = depthsOf(graph.edges);
    // The corridor is the one thing the hemispheres may not enter: a card
    // wobbled toward the axis still has to leave room for its mirror twin.
    const corridor = POLE_CLEARANCE * (1 - RADIUS_JITTER_RATIO);

    const laidOut = layoutGrove(graph.nodes, graph.edges);

    for (const node of laidOut) {
      if (node.type === NodeTypes.ROOT) continue;
      const center = centerOf(node, depths.get(node.id) ?? 0);

      expect(Math.abs(center.x)).toBeGreaterThanOrEqual(corridor);
    }
  });

  it("lets a branch climb to the top of its ring, not just out sideways", () => {
    const graph = buildGrove(60);
    const depths = depthsOf(graph.edges);

    const laidOut = layoutGrove(graph.nodes, graph.edges);
    // A ring's reach is its whole half-circle minus the pole corridor, so a
    // card at the end of its span sits nearly straight above (or below) the
    // root. Anything materially short of that is the old bowtie coming back.
    const reachRatios = laidOut
      .filter((node) => node.type !== NodeTypes.ROOT)
      .map((node) => {
        const depth = depths.get(node.id) ?? 1;
        const center = centerOf(node, depth);
        return Math.abs(center.y) / ringVerticalReach(depth);
      });

    expect(Math.max(...reachRatios)).toBeGreaterThan(0.85);
    // Steeper than 45deg: the grove genuinely occupies the space above and
    // below the root rather than fanning out along the horizontal.
    expect(
      laidOut.filter((node) => {
        const center = centerOf(node, depths.get(node.id) ?? 1);
        return Math.abs(center.y) > Math.abs(center.x);
      }).length
    ).toBeGreaterThan(0);
  });

  it("grows above and below the root on both hemispheres", () => {
    const graph = buildGrove(60);
    const depths = depthsOf(graph.edges);

    const laidOut = layoutGrove(graph.nodes, graph.edges);

    for (const type of [NodeTypes.LEFT, NodeTypes.RIGHT]) {
      const ys = laidOut
        .filter((node) => node.type === type)
        .map((node) => centerOf(node, depths.get(node.id) ?? 1).y);

      expect(Math.min(...ys)).toBeLessThan(0);
      expect(Math.max(...ys)).toBeGreaterThan(0);
    }
  });

  it("puts cards in the column directly above and below the root", () => {
    const graph = buildGrove(60);
    const depths = depthsOf(graph.edges);
    // The column the old +-48deg sectors could never reach: past the first ring
    // a card had to be at least 0.67 of its radius out in x, so everything
    // straight above and below the root stayed empty however large the map got.
    const column = 3 * POLE_CLEARANCE;

    const laidOut = layoutGrove(graph.nodes, graph.edges);
    const inColumn = laidOut
      .filter((node) => node.type !== NodeTypes.ROOT)
      .map((node) => centerOf(node, depths.get(node.id) ?? 1))
      .filter((center) => Math.abs(center.x) < column);

    expect(inColumn.filter((center) => center.y < 0).length).toBeGreaterThan(0);
    expect(inColumn.filter((center) => center.y > 0).length).toBeGreaterThan(0);
  });

  it("keeps every pair of rings clear at every bearing and expansion", () => {
    // A certificate rather than a spot check: for two cards on different rings,
    // walk the inner ring, wobble it outward, and let the outer card sit
    // anywhere that y alone would not already separate them. One of the two
    // axes has to clear at every sample, or a grown map overlaps somewhere the
    // fixtures never happened to land.
    //
    // Both cards are measured as the *widest and tallest* card that can sit on
    // their ring rather than as the card that matches the ring index: radial
    // relief promotes a shallow (and therefore large) card outward onto a ring
    // that would otherwise only ever carry the next tier down.
    //
    // The scan is repeated across ring expansions, always with the outer ring
    // expanded at least as much as the inner one — the invariant
    // `measureRingScales` maintains by accumulating a running maximum.
    const wobbleOut = (x: number) =>
      x + Math.min(RADIUS_JITTER_RATIO * x, RADIUS_JITTER_LIMIT);
    const wobbleIn = (x: number) =>
      x - Math.min(RADIUS_JITTER_RATIO * x, RADIUS_JITTER_LIMIT);
    const ringX = (depth: number, y: number, scale: number) =>
      ringRadius(depth) *
      scale *
      Math.sqrt(Math.max(1 - (y / (ringHeight(depth) * scale)) ** 2, 0));

    for (const [innerScale, outerScale] of RING_EXPANSIONS) {
      for (let inner = 1; inner <= 5; inner += 1) {
        for (let outer = inner + 1; outer <= 6; outer += 1) {
          const requiredX =
            (widestCardOnRing(inner).width + widestCardOnRing(outer).width) /
              2 +
            REQUIRED_MARGIN;
          const requiredY =
            (widestCardOnRing(inner).height + widestCardOnRing(outer).height) /
              2 +
            REQUIRED_MARGIN;
          const innerReach = ringVerticalReach(inner, innerScale);
          const outerReach = ringVerticalReach(outer, outerScale);
          let worstSlack = Infinity;

          for (let step = 0; step <= 240; step += 1) {
            const y = (innerReach * step) / 240;
            const x = wobbleOut(ringX(inner, y, innerScale));

            for (let offset = -20; offset <= 20; offset += 1) {
              const otherY = y + (requiredY * offset) / 20;
              if (Math.abs(otherY) > outerReach) continue;

              const slack = Math.max(
                wobbleIn(ringX(outer, otherY, outerScale)) - x - requiredX,
                Math.abs(otherY - y) - requiredY
              );
              worstSlack = Math.min(worstSlack, slack);
            }
          }

          expect(
            worstSlack,
            `rings ${inner}->${outer} at ${innerScale}/${outerScale}`
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("grows outward from the root with every level", () => {
    const graph = buildGrove(60);
    const depths = depthsOf(graph.edges);
    const parents = parentsOf(graph.edges);

    const laidOut = layoutGrove(graph.nodes, graph.edges);
    const radiusById = new Map(
      laidOut.map((node) => {
        const center = centerOf(node, depths.get(node.id) ?? 0);
        return [node.id, Math.hypot(center.x, center.y)];
      })
    );

    for (const node of laidOut) {
      const parentId = parents.get(node.id);
      if (parentId === undefined) continue;

      expect(radiusById.get(node.id)!).toBeGreaterThan(
        radiusById.get(parentId)!
      );
    }
  });

  it.each([10, 30, 60, 120])(
    "never overlaps two cards at %i nodes",
    (count) => {
      const graph = buildGrove(count);
      const depths = depthsOf(graph.edges);

      const laidOut = layoutGrove(graph.nodes, graph.edges);
      const boxes = laidOut.map((node) => ({
        id: node.id,
        ...inflatedBox(node, depths.get(node.id) ?? 0),
      }));

      expect(laidOut).toHaveLength(count);
      expect(findOverlap(boxes)).toBeNull();
    }
  );

  it("never overlaps two cards when every card carries a description", () => {
    const graph = buildGrove(60, { describeEvery: 1 });
    const depths = depthsOf(graph.edges);

    const laidOut = layoutGrove(graph.nodes, graph.edges);
    const boxes = laidOut.map((node) => ({
      id: node.id,
      ...inflatedBox(node, depths.get(node.id) ?? 0),
    }));

    expect(findOverlap(boxes)).toBeNull();
  });

  it("re-lays out one branch without disturbing the other hemisphere", () => {
    const graph = buildGrove(30);
    const before = new Map(positionsOf(layoutGrove(graph.nodes, graph.edges)));

    // Growing a right-hand leaf must not move a single left-hand card: the two
    // sectors are packed independently.
    const grown = {
      nodes: [
        ...graph.nodes,
        makeNode("r-grown", NodeTypes.RIGHT, "Grown", false),
      ],
      edges: [...graph.edges, createEdge(firstOfType(graph, "r"), "r-grown")],
    };
    const after = new Map(positionsOf(layoutGrove(grown.nodes, grown.edges)));

    const leftIds = graph.nodes
      .filter((node) => node.type === NodeTypes.LEFT)
      .map((node) => node.id);

    expect(leftIds.length).toBeGreaterThan(0);
    for (const id of leftIds) {
      expect(after.get(id)).toEqual(before.get(id));
    }
  });

  it("gives uneven hemispheres comparable breathing room", () => {
    // Mirrors generated maps: two first-level branches on the left and four
    // on the right, each carrying the same three-by-three fan below it.
    const graph = buildUnevenHemisphereGrove();
    const depths = depthsOf(graph.edges);
    const laidOut = layoutGrove(graph.nodes, graph.edges);
    const boxes = laidOut.map((node) => ({
      id: node.id,
      ...inflatedBox(node, depths.get(node.id) ?? 0),
    }));
    const clearances = nearestNeighbourClearances(boxes);
    const medianFor = (type: NodeTypes) =>
      median(
        laidOut
          .filter((node) => node.type === type)
          .map((node) => clearances.get(node.id) ?? 0)
      );
    const left = medianFor(NodeTypes.LEFT);
    const right = medianFor(NodeTypes.RIGHT);

    expect(Math.max(left, right) / Math.min(left, right)).toBeLessThan(1.5);
  });

  it("keeps uneven hemispheres' branch stems comparably compact", () => {
    // Clearance alone misses the visual defect this fixture used to expose:
    // every card could be collision-free while one hemisphere stretched its
    // parent-child stems several times farther than the other. Root lanes must
    // absorb the extra first-level branches without elongating the whole side.
    const graph = buildUnevenHemisphereGrove();
    const depths = depthsOf(graph.edges);
    const laidOut = layoutGrove(graph.nodes, graph.edges);
    const byId = new Map(laidOut.map((node) => [node.id, node]));
    const medianFor = (type: NodeTypes) =>
      median(
        graph.edges
          .filter((edge) => byId.get(edge.target)?.type === type)
          .map((edge) => {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (!source || !target) return 0;

            const sourceCenter = centerOf(source, depths.get(source.id) ?? 0);
            const targetCenter = centerOf(target, depths.get(target.id) ?? 0);

            return Math.hypot(
              targetCenter.x - sourceCenter.x,
              targetCenter.y - sourceCenter.y
            );
          })
      );
    const left = medianFor(NodeTypes.LEFT);
    const right = medianFor(NodeTypes.RIGHT);

    expect(Math.max(left, right) / Math.min(left, right)).toBeLessThan(1.5);
  });

  it.each([40, 80, 120])(
    "never overlaps two cards in a skewed tree at %i nodes",
    (count) => {
      const graph = buildSkewedGrove(count);
      const depths = depthsOf(graph.edges);

      const laidOut = layoutGrove(graph.nodes, graph.edges);
      const boxes = laidOut.map((node) => ({
        id: node.id,
        ...inflatedBox(node, depths.get(node.id) ?? 0),
      }));

      expect(laidOut).toHaveLength(count);
      expect(findOverlap(boxes)).toBeNull();
    }
  );

  it("pushes a branch three times denser than its siblings further out", () => {
    // The shape radial relief exists for: one parent fanning nine children
    // while the siblings either side of it carry two. Before the density
    // ladder, all three fans sat on the same ring and the dense one was
    // squeezed onto the bare tangential minimum.
    const graph = buildSkewedGrove(60);
    const depths = depthsOf(graph.edges);

    const laidOut = layoutGrove(graph.nodes, graph.edges);
    const radiusOf = (branchId: string) =>
      median(
        laidOut
          .filter((node) => isFanChildOf(node.id, branchId))
          .map((node) => {
            const center = centerOf(node, depths.get(node.id) ?? 2);
            return Math.hypot(center.x, center.y);
          })
      );

    // Both fans are at the same tree depth, so any gap between them is the
    // ladder having promoted the dense one onto an outer ring.
    expect(radiusOf(DENSE_BRANCH_ID)).toBeGreaterThan(
      radiusOf(SPARSE_BRANCH_ID) * 1.2
    );
  });

  it("keeps a dense fan's clearance in step with the rest of the grove", () => {
    const graph = buildSkewedGrove(60);
    const depths = depthsOf(graph.edges);

    const laidOut = layoutGrove(graph.nodes, graph.edges);
    const boxes = laidOut.map((node) => ({
      id: node.id,
      ...inflatedBox(node, depths.get(node.id) ?? 0),
    }));
    const clearances = nearestNeighbourClearances(boxes);
    const everyClearance = Array.from(clearances.values());
    const denseFan = Array.from(clearances)
      .filter(([id]) => isFanChildOf(id, DENSE_BRANCH_ID))
      .map(([, clearance]) => clearance);

    expect(denseFan).toHaveLength(DENSE_FAN);
    // Nothing anywhere is closer than the required margin...
    expect(Math.min(...everyClearance)).toBeGreaterThanOrEqual(0);
    // ...and the dense fan is not the part of the map paying for it: its
    // typical breathing room stays within reach of the grove's own median.
    expect(median(denseFan)).toBeGreaterThan(median(everyClearance) * 0.7);
  });

  it("parks a node unreachable from the root clear of the grove", () => {
    const graph = buildGrove(10);
    const orphan = makeNode("l-orphan", NodeTypes.LEFT, "Orphan", false);
    const depths = depthsOf(graph.edges);

    const laidOut = layoutGrove([...graph.nodes, orphan], graph.edges);
    const boxes = laidOut.map((node) => ({
      id: node.id,
      ...inflatedBox(node, depths.get(node.id) ?? 3),
    }));

    expect(findOverlap(boxes)).toBeNull();
  });
});

type GroveFixture = {
  nodes: BaseFlowNode[];
  edges: Edge[];
};

/**
 * Builds a deterministic mindmap of exactly `count` nodes.
 *
 * Nodes are attached breadth-first, alternating hemispheres at the root and
 * fanning three children per branch, so the fixture exercises the same shape an
 * AI-grown map has: a few wide branches over several levels.
 */
function buildGrove(
  count: number,
  options: { describeEvery?: number } = {}
): GroveFixture {
  const describeEvery = options.describeEvery ?? 3;
  const root = makeNode(ROOT_NODE_ID, NodeTypes.ROOT, "Root", true);
  const nodes: BaseFlowNode[] = [root];
  const edges: Edge[] = [];
  const frontier: Array<{ id: string; type: NodeTypes }> = [];
  let cursor = 0;

  while (nodes.length < count) {
    const index = nodes.length;
    const isRootChild = frontier.length === 0 || index % 7 === 0;
    const parent = isRootChild
      ? { id: ROOT_NODE_ID, type: NodeTypes.ROOT }
      : frontier[cursor % frontier.length];
    if (!isRootChild) cursor += 1;

    const type =
      parent.type === NodeTypes.ROOT
        ? index % 2 === 0
          ? NodeTypes.LEFT
          : NodeTypes.RIGHT
        : parent.type;
    const id = `${type === NodeTypes.LEFT ? "l" : "r"}-${index}`;

    nodes.push(
      makeNode(id, type, `Node ${index}`, index % describeEvery === 0)
    );
    edges.push(createEdge(parent.id, id));
    frontier.push({ id, type });
  }

  return { nodes, edges };
}

/** The over-demanding branch in `buildSkewedGrove`. */
const DENSE_BRANCH_ID = "r-branch-0";

/** One of its under-demanding siblings, at the same depth. */
const SPARSE_BRANCH_ID = "r-branch-1";

/** Children hung off the dense branch — roughly 3x a sparse sibling's fan. */
const DENSE_FAN = 9;

/** Children hung off every other branch. */
const SPARSE_FAN = 2;

/**
 * Builds a deterministic mindmap of exactly `count` nodes with skewed branching.
 *
 * Three branches per hemisphere, of which the first carries `DENSE_FAN`
 * children and the rest carry `SPARSE_FAN` — the shape that used to leave one
 * cramped fan sitting next to two half-empty spans. Anything past the second
 * level is attached round-robin so the fixture keeps growing without losing the
 * skew it was built to exercise.
 */
function buildSkewedGrove(count: number): GroveFixture {
  const nodes: BaseFlowNode[] = [
    makeNode(ROOT_NODE_ID, NodeTypes.ROOT, "Root", true),
  ];
  const edges: Edge[] = [];
  const frontier: Array<{ id: string; type: NodeTypes }> = [];
  let index = 0;

  /** Attaches one child, alternating which cards carry a description. */
  const attach = (parent: { id: string; type: NodeTypes }, id: string) => {
    index += 1;
    nodes.push(makeNode(id, parent.type, `Node ${index}`, index % 3 === 0));
    edges.push(createEdge(parent.id, id));
    frontier.push({ id, type: parent.type });
  };

  const branches: Array<{ id: string; type: NodeTypes }> = [];
  for (const type of [NodeTypes.LEFT, NodeTypes.RIGHT]) {
    for (let branch = 0; branch < 3; branch += 1) {
      const id = `${type === NodeTypes.LEFT ? "l" : "r"}-branch-${branch}`;
      attach({ id: ROOT_NODE_ID, type }, id);
      branches.push({ id, type });
    }
  }

  branches.forEach((branch, position) => {
    const fan = position % 3 === 0 ? DENSE_FAN : SPARSE_FAN;
    for (let child = 0; child < fan; child += 1) {
      attach(branch, `${branch.id}-c${child}`);
    }
  });

  let cursor = 0;
  while (nodes.length < count) {
    const parent = frontier[cursor % frontier.length];
    cursor += 1;
    attach(parent, `${parent.id}-g${index}`);
  }

  return { nodes: nodes.slice(0, count), edges };
}

/**
 * Builds the asymmetric root split that exposed cross-hemisphere crowding.
 */
function buildUnevenHemisphereGrove(): GroveFixture {
  const nodes: BaseFlowNode[] = [
    makeNode(ROOT_NODE_ID, NodeTypes.ROOT, "Root", false),
  ];
  const edges: Edge[] = [];

  for (const [type, branchCount] of [
    [NodeTypes.LEFT, 2],
    [NodeTypes.RIGHT, 4],
  ] as const) {
    const prefix = type === NodeTypes.LEFT ? "l" : "r";

    for (let branch = 0; branch < branchCount; branch += 1) {
      const branchId = `${prefix}-branch-${branch}`;
      nodes.push(makeNode(branchId, type, `Branch ${branch}`, false));
      edges.push(createEdge(ROOT_NODE_ID, branchId));

      for (let child = 0; child < 3; child += 1) {
        const childId = `${branchId}-child-${child}`;
        nodes.push(makeNode(childId, type, `Child ${child}`, false));
        edges.push(createEdge(branchId, childId));

        for (let leaf = 0; leaf < 3; leaf += 1) {
          const leafId = `${childId}-leaf-${leaf}`;
          nodes.push(makeNode(leafId, type, `Leaf ${leaf}`, false));
          edges.push(createEdge(childId, leafId));
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * True for a direct fan child of one skewed-fixture branch.
 *
 * Grandchildren are hung off the fan children and so share their id prefix; the
 * trailing index is what separates the fan itself from what grew out of it.
 */
function isFanChildOf(id: string, branchId: string): boolean {
  return new RegExp(`^${branchId}-c\\d+$`).test(id);
}

/** Creates one typed fixture node. */
function makeNode(
  id: string,
  type: NodeTypes,
  title: string,
  withDescription: boolean
): BaseFlowNode {
  return {
    id,
    type,
    data: {
      title,
      ...(withDescription
        ? { description: "A short description that clamps to two lines." }
        : {}),
    },
  };
}

/** Returns the first fixture node id on one hemisphere. */
function firstOfType(graph: GroveFixture, prefix: "l" | "r"): string {
  const node = graph.nodes.find((candidate) => candidate.id.startsWith(prefix));
  if (!node) throw new Error(`fixture has no ${prefix} node`);
  return node.id;
}

/** Maps every node id to its depth, derived the way the layout does. */
function depthsOf(edges: Edge[]): Map<string, number> {
  const depths = new Map<string, number>([[ROOT_NODE_ID, 0]]);
  let pending = [...edges];

  // Edges are emitted parent-first, but resolve iteratively so the helper does
  // not depend on that.
  while (pending.length > 0) {
    const unresolved: Edge[] = [];
    for (const edge of pending) {
      const parentDepth = depths.get(edge.source);
      if (parentDepth === undefined) {
        unresolved.push(edge);
        continue;
      }
      depths.set(edge.target, parentDepth + 1);
    }
    if (unresolved.length === pending.length) break;
    pending = unresolved;
  }

  return depths;
}

/** Maps every node id to its parent id. */
function parentsOf(edges: Edge[]): Map<string, string> {
  return new Map(edges.map((edge) => [edge.target, edge.source]));
}

/** Reduces laid-out nodes to the geometry the property assertions care about. */
function positionsOf(nodes: FlowNode[]): Array<[string, FlowNode["position"]]> {
  return nodes.map((node) => [node.id, node.position]);
}

/** Recovers the card centre from an XYFlow top-left position. */
function centerOf(node: FlowNode, depth: number): { x: number; y: number } {
  const size = estimateNodeSize(node, depth);
  return {
    x: node.position.x + size.width / 2,
    y: node.position.y + size.height / 2,
  };
}

/** Returns the card box grown by half the required margin on every side. */
function inflatedBox(node: FlowNode, depth: number) {
  const size = estimateNodeSize(node, depth);
  const pad = REQUIRED_MARGIN / 2;

  return {
    left: node.position.x - pad,
    right: node.position.x + size.width + pad,
    top: node.position.y - pad,
    bottom: node.position.y + size.height + pad,
  };
}

type InflatedBox = ReturnType<typeof inflatedBox> & { id: string };

/** Returns the first intersecting pair of inflated boxes, or null if clear. */
function findOverlap(boxes: InflatedBox[]): [string, string] | null {
  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      const a = boxes[first];
      const b = boxes[second];
      const overlaps =
        a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom;

      if (overlaps) return [a.id, b.id];
    }
  }

  return null;
}

/**
 * Distance from every card to its nearest neighbour, along the freer axis.
 *
 * Boxes are already inflated by the required margin, so 0 is "exactly as close
 * as the layout is allowed to put them" and a negative value is an overlap.
 */
function nearestNeighbourClearances(boxes: InflatedBox[]): Map<string, number> {
  const clearances = new Map<string, number>();

  for (const box of boxes) {
    let nearest = Infinity;

    for (const other of boxes) {
      if (other === box) continue;
      nearest = Math.min(
        nearest,
        Math.max(
          box.left - other.right,
          other.left - box.right,
          box.top - other.bottom,
          other.top - box.bottom
        )
      );
    }

    clearances.set(box.id, nearest);
  }

  return clearances;
}

/** The middle value of a sample, used to compare typical clearances. */
function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Reorders an array without any dependence on a random source. */
function shuffleDeterministically<T>(items: T[]): T[] {
  const even = items.filter((_item, index) => index % 2 === 0);
  const odd = items.filter((_item, index) => index % 2 === 1);
  return [...odd.reverse(), ...even];
}
