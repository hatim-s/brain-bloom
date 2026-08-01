import { Edge } from "@xyflow/react";

import { ROOT_NODE_ID } from "../const";
import { BaseFlowNode, FlowNode, NodeTypes } from "../types";
import { estimateNodeSize, NODE_WIDTH_BY_DEPTH, NodeSize } from "./nodeSize";
import { seededSigned } from "./seededRandom";

/**
 * The Grove layout — a deterministic organic radial tree.
 *
 * WHAT IT LOOKS LIKE
 * The root is the heart of the grove at the origin. Branches radiate outward
 * into two hemispheres: `NodeTypes.LEFT` grows into the west, `NodeTypes.RIGHT`
 * into the east, so the bilateral data model (and every add-node semantic built
 * on it) survives untouched. Each hemisphere may use its *whole* half-turn when
 * demand needs it: a branch can sit due east, climb to within one card's width
 * of straight up, or dive to straight down. Quieter sides claim a centred
 * subset of that arc so a crowded opposite side cannot make them look
 * artificially sparse. Each depth is a ring; every card is wobbled off its
 * ring and off its exact slot angle so the map reads as growth, not as a filing
 * cabinet.
 *
 * THE ONE THING THAT IS NOT FREE: THE POLES
 * Cards are wide (up to 300px on a ring) and short (~50–110px). Two cards
 * sitting at the very top of a ring — one from each hemisphere — would both land
 * on `x = 0` and overlap by their whole width. So every card keeps a
 * `POLE_CLEARANCE` corridor clear of the vertical axis; that corridor is the
 * *only* thing standing between the layout and a literal ±90deg sector, and it
 * is exactly `(widest card + margin) / 2`, unwobbled. Because the corridor is a
 * fixed number of pixels, its cost shrinks as rings grow: a card at the end of
 * ring 1 sits ~62deg off the horizontal, ring 2 ~74deg, ring 3 ~79deg, and every
 * ring past that is above 80deg — all but straight up.
 *
 * WHY THE RINGS ARE ELLIPSES
 * Neighbouring rings have to clear each other by a card *width* where they cross
 * the horizontal axis, but only by a card *height* where they cross the vertical
 * one — and a card is three times wider than it is tall. A circular ring pays
 * the horizontal price in both directions and the grove balloons vertically for
 * nothing. Flattening the rings (`RING_HEIGHTS` grows slower than `RING_RADII`)
 * keeps the full range of bearings while spending only what each direction
 * actually costs, so a large map lands close to a screen's own proportions.
 *
 * HOW IT WORKS
 * 1. BFS from the root assigns depths and the sibling order (the child order
 *    encoded in the edge array, which mirrors the mindmap child `Map`).
 * 2. Bottom-up, each node claims a *tangential slot*. Slots are measured in
 *    `v` units — a normalised share of the ring's vertical reach, `v = y / Y_r`
 *    where `Y_r = ringVerticalReach(r)` — because `y = Y_r * v`, so a slot of
 *    `(height + TANGENTIAL_GAP) / Y_r` is exactly the vertical room that card
 *    needs on its ring. A subtree's demand is `max(own slot, sum of child
 *    demands)`. `v` is shared by every ring, so a child span always nests
 *    inside its parent's.
 * 3. Density then buys room, cheapest relief first (see THE DENSITY LADDER).
 * 4. Top-down, each sibling group divides its parent's `v` span. A node sits at
 *    the centre of its own span, plus organic jitter bounded by that span's
 *    slack.
 * 5. `y = Y_r * v`, and only *then* is the card wobbled — the wobble moves it
 *    along x only. Vertical packing therefore stays exact no matter how the
 *    rings wobble.
 *
 * THE DENSITY LADDER
 * A skewed tree — one parent fanning nine children while its siblings carry two
 * — used to pay for its fan with a *global* ring scale-up: the dense fan still
 * sat at the bare `TANGENTIAL_GAP` minimum while its sparse siblings floated in
 * spans three times larger than they needed, so clearance read as wildly uneven
 * and the whole grove ballooned. Density now buys room in three steps, each one
 * cheaper for the rest of the map than the next:
 *
 *   1. RADIAL RELIEF (per branch). A child whose subtree demand runs
 *      `DENSITY_TRIGGER`x above its sibling group's mean is *promoted*: its
 *      whole subtree moves a ring further out. A hemisphere with four or more
 *      broad root branches also alternates those branches across two radial
 *      lanes, avoiding a wall of same-depth cards and nearly coincident stems.
 *      Room on a ring grows with the ring, so the same `v` span holds
 *      proportionally more cards out there — the dense branch reaches further
 *      into the canvas instead of squeezing, which is also how a real branch
 *      behaves. The step is a whole ring rather than a fraction because
 *      `RING_RADII` is spaced at exactly one card width plus its margin: a
 *      half-step would park a promoted card inside the corridor that keeps two
 *      rings from touching. Promotion is inherited down the branch and capped
 *      by `MAX_BRANCH_PROMOTION` for the same reason.
 *   2. RING EXPANSION (per ring). Each ring is then widened by exactly the
 *      crowding *it* carries — the summed slot demand of the cards that actually
 *      landed on it — rather than by whatever the busiest ring in the map needs.
 *      This is the ring-fraction step: a ring lands at an intermediate radius
 *      between its nominal neighbours (ring 2 at 1.14x sits between the nominal
 *      rings 2 and 3). Scales are kept non-decreasing with the ring index, so a
 *      ring gap can only ever grow and the ring-clearance certificate holds.
 *   3. TANGENTIAL STRETCH (per hemisphere). Only residual overflow — what
 *      steps 1 and 2 could not absorb, e.g. one genuinely full sector — falls
 *      back to lengthening that sector vertically. Horizontal ring radii stay
 *      compact, so buying card clearance does not also buy needlessly long
 *      stems. The opposite side stays independent.
 *
 * Sibling spans then share their leftover `v` by a blend of an even split and a
 * demand-proportional one (`SLACK_BORROW_WEIGHT`), so an under-full sibling
 * donates part of its even share to the fan next door instead of hoarding air.
 * Every sibling still receives at least its whole demand, so the disjoint
 * interval that makes the layout collision-free is untouched.
 *
 * WHY IT CANNOT OVERLAP (cards + 24px)
 * - Same ring, same hemisphere: slot intervals are disjoint by construction
 *   (siblings partition their parent's span; cousins live in disjoint parent
 *   spans; a promoted child always lands on a strictly outer ring than its
 *   parent, so a node never shares a ring with its own ancestor), every card on
 *   one ring reads the same `Y_r`, and `y = Y_r * v` is unaffected by the
 *   wobble, so
 *   `dy >= (h_a + h_b) / 2 + TANGENTIAL_GAP` exactly — at every angle, including
 *   the poles, where cards are stacked vertically and x does not matter.
 * - Opposite hemispheres: every card keeps `|x| >= POLE_CLEARANCE` even after
 *   the wobble, so `dx >= 2 * POLE_CLEARANCE >= widest card + 24`.
 * - Two rings: near the horizontal axis the ring gap itself separates them in x
 *   (`RING_RADII` gaps stay above `(w_a + w_b) / 2 + 24` plus both wobbles);
 *   toward the poles the x gap narrows but the y gap opens, and `RING_HEIGHTS`
 *   is sized so that one of the two always clears. The layout test pins this
 *   with a dense scan of both rings rather than trusting the eye.
 * - Root vs. first ring: near the axis x separates them (the first ring clears
 *   the root card by ~90px), off-axis y does — a first-ring card that is not
 *   x-clear of the root is already 220px above or below it.
 *
 * DETERMINISM
 * Every jitter value comes from `seededSigned(nodeId, channel)` — an FNV-1a
 * hash into mulberry32. No `Math.random`, no clock, no dependence on array
 * order beyond the sibling order the data itself encodes. The same graph lays
 * out bit-identically on every render, reseed and session.
 */

/** Nominal horizontal ring semi-axis per depth; index 0 is the root. */
const RING_RADII = [0, 440, 880, 1320] as const;

/** Horizontal semi-axis added per depth beyond the tabulated rings. */
const OUTER_RING_GROWTH = 440;

/**
 * Nominal vertical ring semi-axis per depth; index 0 is the root.
 *
 * Rings are ellipses, not circles. Two cards on neighbouring rings clear each
 * other horizontally by a card *width* but vertically by a card *height*, and a
 * card is roughly three times wider than it is tall — so a circular ring buys
 * its vertical room at the horizontal price and the grove balloons. Flattening
 * the rings keeps the whole half-circle of *bearings* (a branch still climbs to
 * straight up) while spending only what the vertical clearance actually costs.
 */
const RING_HEIGHTS = [0, 360, 640, 920] as const;

/** Vertical semi-axis added per depth beyond the tabulated rings. */
const OUTER_RING_HEIGHT_GROWTH = 280;

/** Breathing room reserved between two cards sharing a ring, in px. */
const TANGENTIAL_GAP = 32;

/** The clearance any two cards on the canvas keep from each other, in px. */
const CARD_MARGIN = 24;

/** Ring wobble as a share of a card's distance from the vertical axis. */
const RADIUS_JITTER_RATIO = 0.04;

/** Absolute ceiling on ring wobble, so outer rings stay provably clear. */
const RADIUS_JITTER_LIMIT = 45;

/** How much of the wobble is an alternating sibling stagger vs. free jitter. */
const SIBLING_STAGGER_WEIGHT = 0.35;

/** Share of a span's leftover slack an angle may drift into. */
const ANGLE_JITTER_RATIO = 0.5;

/**
 * How far above its sibling group's mean a subtree's demand must sit before it
 * earns radial relief, as a ratio.
 *
 * 1.3 catches the shape the ladder exists for — one parent fanning three times
 * as wide as the siblings around it — while leaving an ordinary uneven tree
 * (two children here, three there) alone: promoting those would only stretch
 * the map for no gain in clearance.
 */
const DENSITY_TRIGGER = 1.3;

/** Root branches required before the hemisphere is split into radial lanes. */
const ROOT_LANE_MIN_BRANCHES = 4;

/**
 * Ring steps a branch may be promoted outward by, in total, along its path.
 *
 * One, and the cap is geometry rather than taste. `RING_RADII` is spaced at
 * about one card width plus its margin, and `NODE_WIDTH_BY_DEPTH` narrows by
 * one tier per depth — so a ring pair only clears because the outer ring
 * carries the narrower card. A one-ring lift keeps that true (ring `r` carries
 * depths `r-1` and `r`, one tier apart at most); a two-ring lift would let a
 * 300px branch card sit on ring 3 opposite another on ring 2, and the two would
 * be ~7px short of clearing. `grove.test.ts` proves the whole ring/expansion
 * grid against exactly this cap.
 */
const MAX_BRANCH_PROMOTION = 1;

/**
 * Share of a sibling group's leftover slack handed out in proportion to demand
 * rather than evenly.
 *
 * At 0 every sibling gets the same air regardless of how many cards it has to
 * seat (the old behaviour, which starved dense fans); at 1 a sparse sibling
 * would be squeezed onto its bare minimum. 1 hands every branch air in direct
 * proportion to its demand, so the densest fan receives the most relief.
 */
const SLACK_BORROW_WEIGHT = 1;

/** A ring is exactly full when the cards on it claim this much `v`. */
const RING_CAPACITY = 2;

/**
 * Room kept beyond the collision-free minimum in each hemisphere.
 *
 * Root packing is demand-sized rather than forced across the whole half-turn:
 * a quiet side therefore stays gathered while a busy side grows its own rings
 * until both spend the same 80% breathing allowance.
 */
const ROOT_BREATHING_RATIO = 1.8;

/** Where nodes unreachable from the root are parked. */
const DRIFT_RING_GAP = 460;

/** The widest card that can sit on a ring — the root never leaves the origin. */
const MAX_RING_CARD_WIDTH = Math.max(...NODE_WIDTH_BY_DEPTH.slice(1));

/**
 * The corridor every card keeps clear of the vertical axis, in px.
 *
 * Half of "widest card + margin" is what an east card and a west card need
 * between their centres to clear each other; dividing by the wobble headroom
 * means the *wobbled* card still respects it. This single number is what buys
 * the hemispheres their full half-turn: everything else about a card's bearing
 * is free, and the vertical reach of a ring follows from it (see
 * `ringVerticalReach`).
 */
const POLE_CLEARANCE =
  Math.ceil(
    (MAX_RING_CARD_WIDTH + CARD_MARGIN) / 2 / (1 - RADIUS_JITTER_RATIO)
  ) + 8;

type GroveNode = {
  id: string;
  /** Depth in the tree. Drives card size, and nothing else. */
  depth: number;
  /**
   * The ring the card is actually placed on, `>= depth`.
   *
   * Equal to `depth` until radial relief promotes the branch outward; see THE
   * DENSITY LADDER. Always strictly greater than the parent's ring.
   */
  ring: number;
  size: NodeSize;
  /** -1 for the west hemisphere, +1 for the east one. */
  sector: -1 | 1;
};

/** Reads one hemisphere's expansion for a ring. */
type RingScaleFor = (ring: number, sector: GroveNode["sector"]) => number;

/** Reads the final tangential stretch owned by one hemisphere. */
type SectorSpreadFor = (sector: GroveNode["sector"]) => number;

type Point = {
  x: number;
  y: number;
};

/** Reads one semi-axis table, extrapolating past its last tabulated ring. */
function ringAxis(
  table: readonly number[],
  growth: number,
  depth: number
): number {
  if (depth <= 0) return 0;
  if (depth < table.length) return table[depth];

  return table[table.length - 1] + growth * (depth - (table.length - 1));
}

/** Returns the nominal (pre-scale) horizontal semi-axis for one depth. */
function ringRadius(depth: number): number {
  return ringAxis(RING_RADII, OUTER_RING_GROWTH, depth);
}

/** Returns the nominal (pre-scale) vertical semi-axis for one depth. */
function ringHeight(depth: number): number {
  return ringAxis(RING_HEIGHTS, OUTER_RING_HEIGHT_GROWTH, depth);
}

/**
 * How far above and below the root one ring reaches, in px.
 *
 * A card may sit anywhere on its ring except inside the `POLE_CLEARANCE`
 * corridor, so the ring's usable vertical span is where the corridor cuts the
 * ellipse: `b * sqrt(1 - (clearance / a)^2)`. This is the unit the tangential
 * packing is expressed in, which is why it is exported — the layout tests
 * measure how far branches actually climb against it.
 */
function ringVerticalReach(depth: number, scale = 1): number {
  const semiWidth = ringRadius(depth) * scale;
  if (semiWidth <= POLE_CLEARANCE) return 0;

  return (
    ringHeight(depth) * scale * Math.sqrt(1 - (POLE_CLEARANCE / semiWidth) ** 2)
  );
}

/** Clamps a value into an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Groups edges into an ordered child list per parent.
 *
 * Edge array order is the sibling order: both canonical transforms emit edges
 * by walking the mindmap child `Map`, which preserves insertion order.
 */
function collectChildIds(
  nodesById: Map<string, BaseFlowNode>,
  edges: Edge[]
): Map<string, string[]> {
  const childIds = new Map<string, string[]>();
  const claimed = new Set<string>();

  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    // One parent per node: the mindmap is a tree, and a duplicated edge must
    // not give a node two slots.
    if (claimed.has(edge.target)) continue;

    claimed.add(edge.target);
    const siblings = childIds.get(edge.source);
    if (siblings) {
      siblings.push(edge.target);
    } else {
      childIds.set(edge.source, [edge.target]);
    }
  }

  return childIds;
}

/**
 * Walks the tree breadth-first from the root, assigning depth and sector.
 *
 * A node's sector follows its own type, which the data model already keeps
 * consistent down a branch (a LEFT node only ever has LEFT descendants).
 */
function walkFromRoot(
  nodesById: Map<string, BaseFlowNode>,
  childIds: Map<string, string[]>
): GroveNode[] {
  const root = nodesById.get(ROOT_NODE_ID);
  if (!root) return [];

  const walked: GroveNode[] = [
    {
      id: root.id,
      depth: 0,
      ring: 0,
      size: estimateNodeSize(root, 0),
      sector: 1,
    },
  ];
  const visited = new Set([root.id]);

  for (let cursor = 0; cursor < walked.length; cursor += 1) {
    const current = walked[cursor];

    for (const childId of childIds.get(current.id) ?? []) {
      if (visited.has(childId)) continue;
      const child = nodesById.get(childId);
      if (!child) continue;

      visited.add(childId);
      const depth = current.depth + 1;
      walked.push({
        id: childId,
        depth,
        // Radial relief may lift this later; until then a card sits on the ring
        // that matches its depth.
        ring: depth,
        size: estimateNodeSize(child, depth),
        sector: child.type === NodeTypes.LEFT ? -1 : 1,
      });
    }
  }

  return walked;
}

/** The `v` a single card claims on the ring it sits on, at a given expansion. */
function slotOf(node: GroveNode, ringScale: number): number {
  // The root owns the origin rather than a slot on a ring.
  if (node.depth === 0) return 0;

  const reach = ringVerticalReach(node.ring, ringScale);
  if (reach <= 0) return 0;

  return (node.size.height + TANGENTIAL_GAP) / reach;
}

/**
 * Computes the tangential demand of every subtree, bottom-up.
 *
 * `slots` is what a card needs for itself; `demands` is what its whole subtree
 * needs. Breadth-first order guarantees parents precede children, so one
 * reversed pass accumulates children before their parent.
 *
 * Runs twice: once against the nominal rings, to learn where the map is dense,
 * and once more after radial relief and ring expansion have re-priced those
 * rings — the second answer is the one the placement pass spends.
 */
function measureDemand(
  walked: GroveNode[],
  childIds: Map<string, string[]>,
  ringScaleFor: RingScaleFor
): { slots: Map<string, number>; demands: Map<string, number> } {
  const slots = new Map<string, number>();
  const demands = new Map<string, number>();

  for (let cursor = walked.length - 1; cursor >= 0; cursor -= 1) {
    const node = walked[cursor];
    const slot = slotOf(node, ringScaleFor(node.ring, node.sector));

    let childDemand = 0;
    for (const childId of childIds.get(node.id) ?? []) {
      childDemand += demands.get(childId) ?? 0;
    }

    slots.set(node.id, slot);
    demands.set(node.id, Math.max(slot, childDemand));
  }

  return { slots, demands };
}

/**
 * Step 1 of the density ladder: pushes over-demanding subtrees outward a ring.
 *
 * Within one sibling group, a child whose subtree demand runs `DENSITY_TRIGGER`
 * times the group mean is carrying a fan the group's even share cannot seat
 * comfortably. Broad root groups also alternate across two radial lanes once a
 * hemisphere carries at least `ROOT_LANE_MIN_BRANCHES` branches. Rather than
 * making the whole map pay for either case, selected subtrees are promoted onto
 * an outer ring, where the same `v` span is worth proportionally more pixels and
 * therefore seats proportionally more cards.
 *
 * Mutates `walked[].ring` in place. Breadth-first order means a parent's ring is
 * final before its children read it, so promotion is inherited down the branch
 * and every child still lands strictly outside its parent.
 */
function assignRingPromotions(
  walked: GroveNode[],
  childIds: Map<string, string[]>,
  slots: Map<string, number>,
  demands: Map<string, number>
): void {
  const byId = new Map(walked.map((node) => [node.id, node]));
  const promotions = new Map<string, number>();

  for (const node of walked) {
    const siblingIds = childIds.get(node.id) ?? [];
    // A lone child is never denser than "the group": there is no group.
    if (siblingIds.length < 2) continue;

    let total = 0;
    for (const id of siblingIds) total += demands.get(id) ?? 0;
    if (total <= 0) continue;

    const mean = total / siblingIds.length;

    for (const id of siblingIds) {
      const demand = demands.get(id) ?? 0;
      // A leaf is not a fan. Flinging one outward would stretch the grove
      // without buying any card the clearance it was missing.
      if (demand <= (slots.get(id) ?? 0)) continue;

      const excess = demand / mean;
      if (excess < DENSITY_TRIGGER) continue;

      promotions.set(id, 1);
    }
  }

  // Four broad root branches on one side create a wall of same-depth cards and
  // long, nearly coincident stems. Seat every second non-leaf branch in the
  // outer lane instead. The angular order is untouched, but the two radial
  // bands let neighboring fans breathe without stretching the whole sector.
  const rootChildren = childIds.get(ROOT_NODE_ID) ?? [];
  for (const sector of [-1, 1] as const) {
    const sectorChildren = rootChildren.filter(
      (id) => byId.get(id)?.sector === sector
    );
    if (sectorChildren.length < ROOT_LANE_MIN_BRANCHES) continue;

    const laneCandidates = sectorChildren.filter(
      (id) => (demands.get(id) ?? 0) > (slots.get(id) ?? 0)
    );
    for (let index = 1; index < laneCandidates.length; index += 2) {
      promotions.set(laneCandidates[index], 1);
    }
  }

  if (promotions.size === 0) return;

  for (const node of walked) {
    const inherited = node.ring - node.depth;

    for (const childId of childIds.get(node.id) ?? []) {
      const child = byId.get(childId);
      // Only the BFS parent places a child; a duplicated edge must not promote
      // the same card twice.
      if (!child || child.depth !== node.depth + 1) continue;

      const lift = Math.min(
        MAX_BRANCH_PROMOTION,
        inherited + (promotions.get(childId) ?? 0)
      );
      // `lift >= inherited` keeps `child.ring >= node.ring + 1`: a card can
      // never share a ring with its own ancestor.
      child.ring = child.depth + Math.max(lift, inherited);
    }
  }
}

/**
 * Step 2 of the density ladder: widens each ring by the crowding it carries.
 *
 * A ring is full when the cards on it claim `RING_CAPACITY` of `v` in one
 * hemisphere, so a ring carrying more than that is expanded by exactly its own
 * overflow — the ring-fraction step, which lands a busy ring at an intermediate
 * radius between its nominal neighbours while a quiet inner ring stays tight.
 *
 * Scales are accumulated independently per hemisphere as a running maximum over
 * the ring index, so they never decrease outward: an outer ring is then always
 * at least as expanded as the ring inside it, which means a ring gap can only
 * grow and the ring-clearance certificate carries over unchanged.
 */
function measureRingScales(walked: GroveNode[]): Map<string, number> {
  const crowding = new Map<string, number>();
  let deepestRing = 0;

  for (const node of walked) {
    if (node.depth === 0) continue;
    deepestRing = Math.max(deepestRing, node.ring);

    const key = `${node.ring}:${node.sector}`;
    crowding.set(key, (crowding.get(key) ?? 0) + slotOf(node, 1));
  }

  const scales = new Map<string, number>();

  for (const sector of [-1, 1] as const) {
    let running = 1;

    for (let ring = 1; ring <= deepestRing; ring += 1) {
      const claimed = crowding.get(`${ring}:${sector}`) ?? 0;
      // A ring's reach grows at least as fast as the ring does, so dividing the
      // claim by the expansion is a safe lower bound on the room it buys.
      running = Math.max(running, claimed / RING_CAPACITY);
      scales.set(`${ring}:${sector}`, running);
    }
  }

  return scales;
}

/**
 * Returns the final tangential stretch owned by each hemisphere.
 *
 * Demand is `(height + gap) / reach`. Multiplying an ellipse's vertical
 * semi-axis by `f` multiplies its usable reach by exactly `f`, so it divides all
 * demand by the same factor. Horizontal radii deliberately stay unchanged:
 * residual crowding needs more room around the arc, not more distance between
 * every parent and child.
 */
function measureSectorSpreads(
  walked: GroveNode[],
  childIds: Map<string, string[]>,
  demands: Map<string, number>
): Map<GroveNode["sector"], number> {
  const sectorDemand = new Map<number, number>([
    [-1, 0],
    [1, 0],
  ]);
  const bySector = new Map(walked.map((node) => [node.id, node.sector]));

  for (const childId of childIds.get(ROOT_NODE_ID) ?? []) {
    const sector = bySector.get(childId);
    if (sector === undefined) continue;
    sectorDemand.set(
      sector,
      (sectorDemand.get(sector) ?? 0) + (demands.get(childId) ?? 0)
    );
  }

  // Two is the maximum normalised span, from the south pole to the north one.
  const available = 2;

  return new Map([
    [
      -1,
      Math.max(
        1,
        ((sectorDemand.get(-1) ?? 0) * ROOT_BREATHING_RATIO) / available
      ),
    ],
    [
      1,
      Math.max(
        1,
        ((sectorDemand.get(1) ?? 0) * ROOT_BREATHING_RATIO) / available
      ),
    ],
  ]);
}

/**
 * Places every walked node, returning card centres keyed by node id.
 *
 * Top-down: each sibling group partitions its parent's `v` span. The root gives
 * each hemisphere a centred range sized from that side's own demand; leftover
 * slack is shared between siblings so branches fan out, and each card then
 * drifts inside its own slack.
 */
function placeNodes(
  walked: GroveNode[],
  childIds: Map<string, string[]>,
  slots: Map<string, number>,
  demands: Map<string, number>,
  sectorSpreadFor: SectorSpreadFor,
  ringScaleFor: RingScaleFor
): Map<string, Point> {
  const centers = new Map<string, Point>();
  const spans = new Map<string, [number, number]>();
  const bySector = new Map(walked.map((node) => [node.id, node.sector]));

  /** Divides one contiguous `v` range across an ordered sibling group. */
  const divideSpan = (
    siblingIds: string[],
    rangeStart: number,
    rangeEnd: number
  ) => {
    if (siblingIds.length === 0) return;

    const width = rangeEnd - rangeStart;
    const sector = bySector.get(siblingIds[0]) ?? 1;
    const spread = sectorSpreadFor(sector);
    const claims = siblingIds.map((id) => (demands.get(id) ?? 0) / spread);
    const claimed = claims.reduce((total, claim) => total + claim, 0);
    // Induction keeps `claimed <= width` (a span is never smaller than the
    // subtree demand it was sized from); the guard is float-noise insurance.
    const slack = Math.max(0, width - claimed);
    const evenShare = slack / siblingIds.length;

    let cursor = rangeStart;
    siblingIds.forEach((id, index) => {
      // Slack borrowing: leftover `v` is split partly evenly and partly in
      // proportion to demand, so a sibling whose subtree sits below the group's
      // share donates part of its even portion to the fan next door instead of
      // leaving it as air nobody needed. Every sibling still receives its whole
      // claim, so the disjoint-interval guarantee that makes the layout
      // collision-free is untouched, and the shares still sum to `width`.
      const borrowedShare =
        claimed > 0 ? (slack * claims[index]) / claimed : evenShare;
      const size =
        claims[index] +
        (1 - SLACK_BORROW_WEIGHT) * evenShare +
        SLACK_BORROW_WEIGHT * borrowedShare;

      spans.set(id, [cursor, cursor + size]);
      cursor += size;
    });
  };

  const rootChildIds = childIds.get(ROOT_NODE_ID) ?? [];
  // Hemispheres are separated in x, so their slot intervals may overlap. Each
  // one claims only its own demand plus the shared breathing ratio; a sparse
  // side no longer stretches across room that the crowded side paid for.
  for (const sector of [-1, 1] as const) {
    const siblingIds = rootChildIds.filter((id) => bySector.get(id) === sector);
    const spread = sectorSpreadFor(sector);
    const claim = siblingIds.reduce(
      (total, id) => total + (demands.get(id) ?? 0) / spread,
      0
    );
    const width = Math.min(2, claim * ROOT_BREATHING_RATIO);

    divideSpan(siblingIds, -width / 2, width / 2);
  }

  for (const node of walked) {
    if (node.depth === 0) {
      // The heart of the grove; its children's spans are already divided above.
      centers.set(node.id, { x: 0, y: 0 });
      continue;
    }

    const [spanStart, spanEnd] = spans.get(node.id) ?? [-1, 1];
    const spread = sectorSpreadFor(node.sector);
    const slot = (slots.get(node.id) ?? 0) / spread;
    // Jitter is bounded by the slack the span has beyond the card's own slot,
    // so the card can never drift out of its reserved interval.
    const slack = Math.max(0, spanEnd - spanStart - slot);
    const drift =
      seededSigned(node.id, "grove-angle") * (slack / 2) * ANGLE_JITTER_RATIO;
    const v = clamp((spanStart + spanEnd) / 2 + drift, -1, 1);

    // Ring expansion preserves the ellipse's proportions; residual sector
    // crowding stretches only the vertical axis. This keeps depth bands close
    // enough for readable stems while giving a busy hemisphere more arc length.
    const ringScale = ringScaleFor(node.ring, node.sector);
    const semiWidth = ringRadius(node.ring) * ringScale;
    const semiHeight = ringHeight(node.ring) * ringScale * spread;
    // Vertical position comes from the expanded ring reach. The same sector
    // spread multiplies every ring, so ordering and collision clearance hold.
    const y = ringVerticalReach(node.ring, ringScale) * spread * v;
    // x follows from the ellipse. `POLE_CLEARANCE` is the floor by construction
    // (`|y| <= reach` is exactly `x >= clearance`); the `max` only absorbs float
    // noise and a degenerate ring.
    const nominalX = Math.max(
      semiWidth * Math.sqrt(Math.max(1 - (y / semiHeight) ** 2, 0)),
      POLE_CLEARANCE
    );

    // The wobble is horizontal — radial on the axis, and a harmless sideways
    // nudge near the poles, where neighbours are separated in y instead. Scaling
    // it by the card's own distance from the axis keeps the pole corridor intact
    // and keeps outer rings provably clear.
    const wobbleAmplitude = Math.min(
      RADIUS_JITTER_RATIO * nominalX,
      RADIUS_JITTER_LIMIT
    );
    const wobble = clamp(
      (1 - SIBLING_STAGGER_WEIGHT) * seededSigned(node.id, "grove-radius") +
        SIBLING_STAGGER_WEIGHT * staggerSign(node.id),
      -1,
      1
    );

    centers.set(node.id, {
      x: node.sector * (nominalX + wobbleAmplitude * wobble),
      y,
    });
    divideSpan(childIds.get(node.id) ?? [], spanStart, spanEnd);
  }

  return centers;
}

/**
 * A stable alternating term, so siblings stagger in and out along their ring.
 *
 * Derived from the id rather than the sibling index so that inserting a
 * sibling never re-shuffles the stagger of the others.
 */
function staggerSign(id: string): number {
  return seededSigned(id, "grove-stagger") >= 0 ? 1 : -1;
}

/**
 * Parks nodes unreachable from the root outside the grove.
 *
 * The canonical transforms only ever emit nodes reachable from the root, so
 * this is a safety net for a partially written graph: the orphans stay visible,
 * stay deterministic, and stay far enough out never to touch a real branch.
 */
function placeDriftNodes(
  orphans: BaseFlowNode[],
  deepestRadius: number,
  centers: Map<string, Point>
): void {
  if (orphans.length === 0) return;

  const radius = deepestRadius + DRIFT_RING_GAP;
  const sizes = orphans.map((node) => estimateNodeSize(node, 3));
  const step = Math.max(...sizes.map((size) => size.height)) + TANGENTIAL_GAP;

  orphans.forEach((node, index) => {
    centers.set(node.id, {
      x: node.type === NodeTypes.LEFT ? -radius : radius,
      y: (index - (orphans.length - 1) / 2) * step,
    });
  });
}

/**
 * Lays out one mindmap graph into absolute XYFlow positions.
 *
 * Input order is preserved in the output, and the result is a pure function of
 * the graph: identical input, bit-identical positions, every time.
 */
function layoutGrove(nodes: BaseFlowNode[], edges: Edge[]): FlowNode[] {
  if (nodes.length === 0) return [];

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const childIds = collectChildIds(nodesById, edges);
  const walked = walkFromRoot(nodesById, childIds);

  // The density ladder, cheapest relief first: measure the map on its nominal
  // rings, promote the branches that are crowded relative to their siblings,
  // widen each ring by the crowding it is left carrying, re-measure against
  // those rings, and only then stretch residual overflow per hemisphere.
  const nominal = measureDemand(walked, childIds, () => 1);
  assignRingPromotions(walked, childIds, nominal.slots, nominal.demands);
  const ringScales = measureRingScales(walked);
  const ringScaleFor: RingScaleFor = (ring, sector) =>
    ringScales.get(`${ring}:${sector}`) ?? 1;

  const { slots, demands } = measureDemand(walked, childIds, ringScaleFor);
  const sectorSpreads = measureSectorSpreads(walked, childIds, demands);
  const sectorSpreadFor: SectorSpreadFor = (sector) =>
    sectorSpreads.get(sector) ?? 1;
  const centers = placeNodes(
    walked,
    childIds,
    slots,
    demands,
    sectorSpreadFor,
    ringScaleFor
  );

  const deepestRadius = walked.reduce(
    (deepest, node) =>
      Math.max(
        deepest,
        ringRadius(node.ring) * ringScaleFor(node.ring, node.sector)
      ),
    0
  );
  placeDriftNodes(
    nodes.filter((node) => !centers.has(node.id)),
    deepestRadius,
    centers
  );

  const depths = new Map(walked.map((node) => [node.id, node.depth]));

  return nodes.map<FlowNode>((node) => {
    const center = centers.get(node.id) ?? { x: 0, y: 0 };
    const size = estimateNodeSize(node, depths.get(node.id) ?? 3);

    // XYFlow positions the top-left corner; the grove reasons about centres.
    return {
      ...node,
      position: {
        x: center.x - size.width / 2,
        y: center.y - size.height / 2,
      },
    };
  });
}

export {
  CARD_MARGIN,
  layoutGrove,
  MAX_BRANCH_PROMOTION,
  POLE_CLEARANCE,
  RADIUS_JITTER_LIMIT,
  RADIUS_JITTER_RATIO,
  ROOT_BREATHING_RATIO,
  RING_HEIGHTS,
  RING_RADII,
  ringHeight,
  ringRadius,
  ringVerticalReach,
  TANGENTIAL_GAP,
};
