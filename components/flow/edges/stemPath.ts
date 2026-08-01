import { seededSigned } from "../layout/seededRandom";

/**
 * The geometry of a stem.
 *
 * Edges in the grove are stems, not wires: they leave the parent card at
 * whatever angle the child happens to sit, and they carry a slight organic bow
 * so no two look machined. The bow is seeded from the edge id, so a stem keeps
 * its exact curve across renders, reseeds and sessions.
 *
 * Kept free of React and of xyflow so it can be reasoned about (and tested) as
 * pure geometry.
 */

/** Gap left between the card boundary and the start of the stroke, in px. */
const STEM_ANCHOR_GAP = 2;

/** How far along the parent-to-child direction the first handle reaches. */
const OUTBOUND_TENSION = 0.36;

/** How far back along that direction the second handle reaches. */
const INBOUND_TENSION = 0.46;

/** Base sideways bow, as a share of the stem's length. */
const BOW_BASE = 0.1;

/** Extra bow the seed can add, as a share of the stem's length. */
const BOW_RANGE = 0.07;

/**
 * How much less the second handle bows than the first.
 *
 * Bowing both handles by the same amount draws a symmetric arc, which reads as
 * a drawn curve; leaning the bow towards the parent makes the stem look grown.
 */
const BOW_FALLOFF = 0.45;

type StemBox = {
  /** Card centre in flow coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

/**
 * Finds where a ray leaving a card's centre crosses the card boundary.
 *
 * Floating anchors: with a radial layout a child can sit at any angle, so the
 * stem may not use the fixed left/right handle positions. The ray-versus-box
 * intersection puts the anchor exactly where the stem visually leaves the card.
 */
function anchorOnBox(box: StemBox, dirX: number, dirY: number): Point {
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const toVerticalEdge =
    Math.abs(dirX) < 1e-6
      ? Number.POSITIVE_INFINITY
      : halfWidth / Math.abs(dirX);
  const toHorizontalEdge =
    Math.abs(dirY) < 1e-6
      ? Number.POSITIVE_INFINITY
      : halfHeight / Math.abs(dirY);
  const distance = Math.min(toVerticalEdge, toHorizontalEdge) + STEM_ANCHOR_GAP;

  return { x: box.x + dirX * distance, y: box.y + dirY * distance };
}

/**
 * Builds the cubic bezier for one stem between two card boxes.
 *
 * Both control points run along the parent-to-child direction (so the stem
 * flows outward with the growth) and are pushed sideways by a seeded bow whose
 * sign and magnitude are stable for that edge id.
 */
function buildStemPath(
  edgeId: string,
  source: StemBox,
  target: StemBox
): string {
  const spanX = target.x - source.x;
  const spanY = target.y - source.y;
  const span = Math.hypot(spanX, spanY);

  if (span < 1) {
    // Degenerate (unmeasured or stacked cards): a straight hairline is honest.
    return `M ${source.x},${source.y} L ${target.x},${target.y}`;
  }

  const dirX = spanX / span;
  const dirY = spanY / span;
  const start = anchorOnBox(source, dirX, dirY);
  const end = anchorOnBox(target, -dirX, -dirY);

  const stemX = end.x - start.x;
  const stemY = end.y - start.y;
  const stemLength = Math.hypot(stemX, stemY) || span;

  const seed = seededSigned(edgeId, "grove-stem");
  const bow =
    Math.sign(seed || 1) * stemLength * (BOW_BASE + BOW_RANGE * Math.abs(seed));
  // Perpendicular to the direction of growth.
  const bowX = -dirY * bow;
  const bowY = dirX * bow;

  const firstHandle = {
    x: start.x + dirX * stemLength * OUTBOUND_TENSION + bowX,
    y: start.y + dirY * stemLength * OUTBOUND_TENSION + bowY,
  };
  const secondHandle = {
    x: end.x - dirX * stemLength * INBOUND_TENSION + bowX * BOW_FALLOFF,
    y: end.y - dirY * stemLength * INBOUND_TENSION + bowY * BOW_FALLOFF,
  };

  return [
    `M ${start.x},${start.y}`,
    `C ${firstHandle.x},${firstHandle.y}`,
    `${secondHandle.x},${secondHandle.y}`,
    `${end.x},${end.y}`,
  ].join(" ");
}

export { anchorOnBox, buildStemPath, STEM_ANCHOR_GAP, type StemBox };
