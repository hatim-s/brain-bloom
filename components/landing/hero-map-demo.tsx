import styles from "./hero-map-demo.module.css";

/**
 * Which hemisphere of the grove a demo card grew into.
 *
 * The root is the still centre and has no side; every other card sits either
 * east or west of it, which is what decides where its leaf corner pinches.
 */
type DemoSide = "left" | "right";

/** Geometry for one authored node card inside the hero SVG. */
type DemoNode = {
  label: string;
  x: number;
  y: number;
  width: number;
  /** Hemisphere this card grew into; mirrors its pinched leaf corner. */
  side: DemoSide;
  /**
   * Loop class assigning this node its slot in the 18s ambient cycle. Each
   * class owns a dedicated `@keyframes` block whose percentages encode when
   * the card rises and when it settles away — see the module stylesheet.
   */
  motionClass: string;
};

const NODE_HEIGHT = 36;

/**
 * The hero's card radii: the canvas's 16/5 leaf pair, scaled for demo cards that
 * render at roughly two-thirds of a real node card (36px tall against a real
 * card's ~60, 82–170 wide against 236–320).
 *
 * It is the 16:5 proportion — not the absolute pixels — that reads as a leaf
 * corner, so the ratio is what is preserved: 10 : 3.125 is exactly 16 : 5.
 */
const NODE_CARD_RADIUS = 10;
const NODE_CARD_PINCH = 3.125;

/**
 * Builds the closed SVG path for a Grove node card: a rounded rectangle with one
 * pinched corner, mirrored per hemisphere.
 *
 * Echoes the shipped canvas card (`NODE_CARD_RADIUS` in
 * `components/flow/nodes/Node/Node.tsx`), where three corners open up generously
 * and the single corner pointing back down the stem toward the root pinches in —
 * an east-hemisphere card (`side: "right"`) pinches its top-LEFT corner, a
 * west-hemisphere card (`side: "left"`) pinches its top-RIGHT. So a card reads as
 * something that grew out of the middle rather than a rectangle dropped on the
 * canvas. The root, having no stem behind it, stays symmetric and is drawn as a
 * plain rounded rect instead.
 *
 * Corners are traced clockwise starting just past the top-left. Radii are
 * clamped to half the shorter side so a narrow card degrades to a stadium
 * instead of self-crossing.
 */
function leafCardPath({
  x,
  y,
  width,
  height,
  radius,
  pinchRadius,
  side,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radius of the three corners that open up. */
  radius: number;
  /** Radius of the one corner facing the root. */
  pinchRadius: number;
  side: DemoSide;
}): string {
  const limit = Math.min(width, height) / 2;
  const open = Math.min(radius, limit);
  const pinch = Math.min(pinchRadius, limit);
  // Only the top corner on the root-facing side pinches; the other three open up.
  const topLeft = side === "right" ? pinch : open;
  const topRight = side === "left" ? pinch : open;
  const right = x + width;
  const bottom = y + height;

  return [
    `M ${x + topLeft},${y}`,
    `H ${right - topRight}`,
    `A ${topRight},${topRight} 0 0 1 ${right},${y + topRight}`,
    `V ${bottom - open}`,
    `A ${open},${open} 0 0 1 ${right - open},${bottom}`,
    `H ${x + open}`,
    `A ${open},${open} 0 0 1 ${x},${bottom - open}`,
    `V ${y + topLeft}`,
    `A ${topLeft},${topLeft} 0 0 1 ${x + topLeft},${y}`,
    "Z",
  ].join(" ");
}

/** First-level branches around the root. */
const BRANCHES: DemoNode[] = [
  {
    label: "Light reactions",
    x: 650,
    y: 100,
    width: 130,
    side: "right",
    motionClass: styles.branch1,
  },
  {
    label: "Calvin cycle",
    x: 650,
    y: 322,
    width: 118,
    side: "right",
    motionClass: styles.branch2,
  },
  {
    label: "Chloroplast structure",
    x: 160,
    y: 212,
    width: 170,
    side: "left",
    motionClass: styles.branch3,
  },
];

/** Second-level leaves: last to grow, first to settle away. */
const LEAVES: DemoNode[] = [
  {
    label: "Photosystem II",
    x: 850,
    y: 44,
    width: 128,
    side: "right",
    motionClass: styles.leaf1,
  },
  {
    label: "ATP synthase",
    x: 850,
    y: 120,
    width: 118,
    side: "right",
    motionClass: styles.leaf2,
  },
  {
    label: "Carbon fixation",
    x: 850,
    y: 296,
    width: 130,
    side: "right",
    motionClass: styles.leaf3,
  },
  {
    label: "RuBisCO",
    x: 850,
    y: 372,
    width: 92,
    side: "right",
    motionClass: styles.leaf4,
  },
  {
    label: "Thylakoids",
    x: 26,
    y: 132,
    width: 100,
    side: "left",
    motionClass: styles.leaf5,
  },
  {
    label: "Stroma",
    x: 36,
    y: 292,
    width: 82,
    side: "left",
    motionClass: styles.leaf6,
  },
];

/**
 * Stems matching the canvas's edge language: flat exit, settled entry. Each is
 * rendered with `pathLength={100}`, which normalises every curve onto a shared
 * 0–100 dash scale so the stylesheet can schedule draw and retract in exact
 * slices of the cycle regardless of a stem's real arc length.
 */
const EDGES: { d: string; motionClass: string }[] = [
  // Root → first level.
  { d: "M580 230 C 615 230 615 118 650 118", motionClass: styles.edgeL1 },
  { d: "M580 230 C 615 230 615 340 650 340", motionClass: styles.edgeL2 },
  { d: "M420 230 C 385 230 365 230 330 230", motionClass: styles.edgeL3 },
  // First level → leaves.
  { d: "M780 118 C 815 118 815 62 850 62", motionClass: styles.edgeD1 },
  { d: "M780 118 C 815 118 815 138 850 138", motionClass: styles.edgeD2 },
  { d: "M768 340 C 809 340 809 314 850 314", motionClass: styles.edgeD3 },
  { d: "M768 340 C 809 340 809 390 850 390", motionClass: styles.edgeD4 },
  { d: "M160 230 C 143 230 143 150 126 150", motionClass: styles.edgeD5 },
  { d: "M160 230 C 143 230 143 310 118 310", motionClass: styles.edgeD6 },
];

/**
 * One quiet card in the map, drawn in the canvas's own node vocabulary.
 *
 * The motion class stays on the wrapping `<g>` — exactly where the 18s cycle's
 * keyframes expect it — so the card's shape and its schedule are independent.
 */
function DemoNodeCard({ label, x, y, width, side, motionClass }: DemoNode) {
  return (
    <g className={motionClass}>
      <path
        className="fill-card stroke-line-strong"
        d={leafCardPath({
          x,
          y,
          width,
          height: NODE_HEIGHT,
          radius: NODE_CARD_RADIUS,
          pinchRadius: NODE_CARD_PINCH,
          side,
        })}
        filter="url(#hero-node-shadow)"
        strokeWidth={1.25}
      />
      <text
        className="fill-foreground"
        fontSize={13}
        textAnchor="middle"
        x={x + width / 2}
        y={y + NODE_HEIGHT / 2 + 4.5}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * The landing hero's proof: a real prompt growing into a real map, on a loop.
 *
 * Hand-authored geometry in the product's own node vocabulary (card fill,
 * line-strong hairline edges, the signature leaf corner mirrored per hemisphere,
 * a symmetric root carrying the wordmark's leaf-dot) rather than marketing art.
 * All content is a truthful map of photosynthesis.
 *
 * Motion is the Grove's one sanctioned continuous movement: a seamless 18s
 * ambient loop — unhurried growth, a long rest where the finished map holds and
 * breathes, a graceful dissolve in reverse order, then an empty beat and a
 * restart with no visible seam. Every element shares one duration and one
 * delay; the per-element schedule lives in the stylesheet's percentage
 * keyframes. Under `prefers-reduced-motion: reduce` no animation applies at
 * all, so what renders is this server-rendered markup as authored: the
 * complete map, fully visible and still.
 */
function HeroMapDemo() {
  return (
    <svg
      aria-label="A prompt asking how photosynthesis works growing into a mindmap: photosynthesis branches into light reactions, the Calvin cycle, and chloroplast structure, each with further sub-branches."
      className={`${styles.stage} h-auto w-full`}
      fill="none"
      role="img"
      viewBox="0 0 1000 460"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/*
          One soft overhead light: small offset, gentle blur, and deep-forest
          shadow ink (never neutral black) so depth stays warm in both themes.
        */}
        <filter
          id="hero-node-shadow"
          x="-20%"
          y="-20%"
          width="140%"
          height="160%"
        >
          <feDropShadow
            dx="0"
            dy="1"
            floodColor="oklch(0.14 0.02 152)"
            floodOpacity="0.18"
            stdDeviation="1.5"
          />
        </filter>
      </defs>

      {/* Stems sit under every card. */}
      <g className="stroke-line-strong" strokeWidth={1.5}>
        {EDGES.map((edge) => (
          <path
            className={`${styles.edge} ${edge.motionClass}`}
            d={edge.d}
            key={edge.d}
            pathLength={100}
          />
        ))}
      </g>

      {/* The typed prompt, in the product's own input vocabulary. */}
      <g className={styles.prompt}>
        <rect
          className="fill-card stroke-line-strong"
          filter="url(#hero-node-shadow)"
          height={48}
          rx={12}
          strokeWidth={1.25}
          width={330}
          x={40}
          y={24}
        />
        <text className="fill-foreground" fontSize={14} x={62} y={53}>
          How does photosynthesis work?
        </text>
        <rect
          className={`fill-primary ${styles.caret}`}
          height={18}
          rx={0.75}
          width={1.5}
          x={276}
          y={39}
        />
      </g>

      {/* Root: the distilled topic, carrying the wordmark's leaf-dot. */}
      <g className={styles.root}>
        <rect
          className="fill-card stroke-line-strong"
          filter="url(#hero-node-shadow)"
          height={52}
          rx={14}
          strokeWidth={1.25}
          width={160}
          x={420}
          y={204}
        />
        <circle className="fill-primary" cx={442} cy={230} r={3} />
        <text
          className="fill-foreground"
          fontSize={15}
          fontWeight={600}
          letterSpacing="-0.01"
          x={454}
          y={235}
        >
          Photosynthesis
        </text>
      </g>

      {BRANCHES.map((node) => (
        <DemoNodeCard key={node.label} {...node} />
      ))}
      {LEAVES.map((node) => (
        <DemoNodeCard key={node.label} {...node} />
      ))}
    </svg>
  );
}

export { type DemoSide, HeroMapDemo, leafCardPath };
