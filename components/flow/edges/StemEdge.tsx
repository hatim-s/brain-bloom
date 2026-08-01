"use client";

import {
  BaseEdge,
  type EdgeProps,
  type InternalNode,
  type Node,
  useInternalNode,
} from "@xyflow/react";

import { nodeWidthForDepth } from "../layout/nodeSize";
import { buildStemPath, type StemBox } from "./stemPath";

/**
 * The stem: one edge of the grove.
 *
 * Anchors float. A radial layout puts children at any angle, so the stroke is
 * not tied to the card's fixed left/right handles (those stay in the DOM as
 * 1px points, purely so xyflow considers the connection valid): the anchor is
 * computed from the two cards' measured boxes along the parent-to-child
 * direction, and the curve carries a seeded organic bow.
 *
 * Colour and weight live in `flow.css` against `.react-flow__edge-path`, so the
 * clay AI states and the moss active path style this component without it
 * knowing anything about them. The one thing CSS cannot conjure is a second
 * stroke, so the stem paints its own underglow layer (see `UNDERGLOW_CLASS`).
 */

/** Card box used before xyflow has measured a freshly mounted node. */
const UNMEASURED_HEIGHT = 64;

/**
 * The wider stroke painted beneath the stem, for the root-to-active trail.
 *
 * It is a real path rather than a CSS filter glow: a `drop-shadow` would blur
 * the stem's own colour into a halo the design system has no token for, and
 * would put a filter pass on every edge on the canvas. Rendered on every stem
 * and left transparent until `flow.css` inks it, so the trail can fade in and
 * out on the same 200ms curve in both directions.
 */
const UNDERGLOW_CLASS = "sprig-stem-underglow";

/** Reads a card's centre box from the flow's internal node record. */
function readStemBox(node: InternalNode<Node>): StemBox {
  const width = node.measured.width ?? nodeWidthForDepth(1);
  const height = node.measured.height ?? UNMEASURED_HEIGHT;
  const { x, y } = node.internals.positionAbsolute;

  return { x: x + width / 2, y: y + height / 2, width, height };
}

function StemEdge({ id, source, target, markerEnd, style }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const path = buildStemPath(
    id,
    readStemBox(sourceNode),
    readStemBox(targetNode)
  );

  return (
    <>
      {/* Painted first, so it sits under the stem's own stroke. */}
      <path className={UNDERGLOW_CLASS} d={path} />
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
    </>
  );
}

export { StemEdge };
