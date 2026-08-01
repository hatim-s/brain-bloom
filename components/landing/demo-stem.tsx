import { cn } from "@/lib/utils";

/**
 * The hairline a demo stem is drawn in.
 *
 * `neutral` is the actionable-object line every ordinary stem uses; `clay` marks
 * a stem the model just grew, and is only ever paired with a clay node card (The
 * Clay Means AI Rule).
 */
type DemoStemTone = "neutral" | "clay";

const STEM_STROKE: Record<DemoStemTone, string> = {
  neutral: "stroke-line-strong",
  clay: "stroke-glow",
};

/**
 * The stem is authored inside a normalised square and then stretched to whatever
 * box its row hands it (`preserveAspectRatio="none"`), so one path serves every
 * stem length and reach in the landing demos.
 */
const STEM_BOX = 100;

/**
 * Curve grammar, lifted from the canvas's `edges/stemPath.ts` so the landing
 * demos bow the way the real edges do.
 *
 * The stem runs corner to corner — out from under the parent card at the top
 * left, into the child at the bottom right. Both control points ride that
 * parent-to-child direction (0.36 of the span out from the start, 0.46 back from
 * the end) and are then pushed perpendicular by the bow, toward the bottom left,
 * which is what makes the stem descend before it sweeps in.
 *
 * `BOW` is the canvas's `BOW_BASE` (0.10) plus a mid-range sample of its seeded
 * `BOW_RANGE` (0.07): the demos are static, so a single representative bow
 * stands in for the per-edge seed. `BOW_FALLOFF` leans the bow toward the parent
 * by bowing the second handle less than the first — a symmetric arc reads as a
 * drawn curve, an asymmetric one reads as grown.
 */
const OUTBOUND_TENSION = 0.36;
const INBOUND_TENSION = 0.46;
const BOW = 0.13;
const BOW_FALLOFF = 0.45;

/**
 * Builds the bowed cubic for one demo stem across a `size` × `size` box.
 *
 * Pure geometry over the diagonal from (0,0) to (size,size): the unit direction
 * is (1,1)/√2 and the perpendicular that the bow rides is (-1,1)/√2, which points
 * down and to the left.
 */
function buildDemoStemPath(size: number): string {
  const span = Math.hypot(size, size);
  // Both the direction and its perpendicular have components of ±1/√2.
  const unit = 1 / Math.SQRT2;
  const bowX = -unit * span * BOW;
  const bowY = unit * span * BOW;

  const firstHandle = {
    x: unit * span * OUTBOUND_TENSION + bowX,
    y: unit * span * OUTBOUND_TENSION + bowY,
  };
  const secondHandle = {
    x: size - unit * span * INBOUND_TENSION + bowX * BOW_FALLOFF,
    y: size - unit * span * INBOUND_TENSION + bowY * BOW_FALLOFF,
  };

  const round = (value: number) => Number(value.toFixed(2));

  return [
    `M 0,0`,
    `C ${round(firstHandle.x)},${round(firstHandle.y)}`,
    `${round(secondHandle.x)},${round(secondHandle.y)}`,
    `${size},${size}`,
  ].join(" ");
}

const STEM_PATH = buildDemoStemPath(STEM_BOX);

/**
 * A stem, not a wire: the curved connector the landing demos hang their child
 * cards off, echoing the canvas's own bowed cubic edges.
 *
 * Purely decorative and purely visual — it occupies exactly the box the caller
 * gives it via `className` (width, height and the negative translate that lifts
 * it to meet the parent row), so swapping it in for a bordered elbow changes
 * nothing about layout or spacing. The stroke stays a true 1.5px through the
 * non-uniform stretch thanks to `vector-effect="non-scaling-stroke"`, and
 * `overflow-visible` keeps the half-stroke at the box edges from being clipped.
 */
function DemoStem({
  className,
  tone = "neutral",
}: {
  /** Box classes: the same width, height and translate the row needs. */
  className?: string;
  tone?: DemoStemTone;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0 overflow-visible", className)}
      fill="none"
      preserveAspectRatio="none"
      viewBox={`0 0 ${STEM_BOX} ${STEM_BOX}`}
    >
      <path
        className={STEM_STROKE[tone]}
        d={STEM_PATH}
        strokeLinecap="round"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export { buildDemoStemPath, DemoStem, type DemoStemTone };
