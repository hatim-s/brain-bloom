import { NodeData } from "../types";

/**
 * The size contract between the layout engine and the node card.
 *
 * The layout has to reserve space before anything is measured (it runs in the
 * store, on the server, and in node-environment tests), so card geometry is
 * computed analytically from depth and content. THIS FILE IS A CONTRACT: the
 * node card is styled to exactly these widths and line heights. If the card's
 * padding, width or type scale drifts, the grove starts to collide — change
 * both sides together.
 *
 * Depth-scaled, so the map reads like growth: the root is the widest presence
 * and leaves are the smallest.
 */

/** Card width per depth: root, branch, twig, leaf-and-below. */
const NODE_WIDTH_BY_DEPTH = [320, 300, 264, 236] as const;

/** Vertical padding applied to *each* of the top and bottom edges. */
const VERTICAL_PADDING_BY_DEPTH = [16, 14, 12, 10] as const;

/** One rendered title line at that depth's type size. */
const TITLE_LINE_BY_DEPTH = [30, 26, 24, 21] as const;

/** Two clamped description lines at that depth's body size, total. */
const DESCRIPTION_BLOCK_BY_DEPTH = [48, 48, 42, 42] as const;

/**
 * Absorbs sub-pixel line-height rounding and the card's border so the reserved
 * box is never smaller than the painted one.
 */
const SIZE_SAFETY_PAD = 8;

type NodeSize = {
  width: number;
  height: number;
};

/** Clamps a depth onto the four styled tiers (root, branch, twig, leaf+). */
function depthTier(depth: number): number {
  if (!Number.isFinite(depth) || depth < 0) return 0;
  return Math.min(Math.trunc(depth), NODE_WIDTH_BY_DEPTH.length - 1);
}

/** Returns the exact card width the node card must render at this depth. */
function nodeWidthForDepth(depth: number): number {
  return NODE_WIDTH_BY_DEPTH[depthTier(depth)];
}

/**
 * Estimates the rendered box of one node card at a given depth.
 *
 * Height = 2 x vertical padding + one title line + (two clamped description
 * lines when a description exists) + the safety pad. Titles are never clamped
 * to two lines in the estimate: the card keeps them on one line at these
 * widths, and over-reserving vertical space would visibly loosen the grove.
 */
function estimateNodeSize(
  node: { data: Pick<NodeData, "description"> },
  depth: number
): NodeSize {
  const tier = depthTier(depth);
  const hasDescription = Boolean(node.data.description);

  const height =
    VERTICAL_PADDING_BY_DEPTH[tier] * 2 +
    TITLE_LINE_BY_DEPTH[tier] +
    (hasDescription ? DESCRIPTION_BLOCK_BY_DEPTH[tier] : 0) +
    SIZE_SAFETY_PAD;

  return { width: NODE_WIDTH_BY_DEPTH[tier], height };
}

export {
  DESCRIPTION_BLOCK_BY_DEPTH,
  estimateNodeSize,
  NODE_WIDTH_BY_DEPTH,
  type NodeSize,
  nodeWidthForDepth,
  SIZE_SAFETY_PAD,
  TITLE_LINE_BY_DEPTH,
  VERTICAL_PADDING_BY_DEPTH,
};
