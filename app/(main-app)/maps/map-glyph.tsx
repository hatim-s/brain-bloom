/*
 * The structure glyph: every map on the dashboard wears its own small sprig.
 *
 * Why generated rather than one shared icon: a list of identical icons says
 * "records in a table", while a list of sprigs that are each visibly their own
 * says "living maps". The mark is the row's anchor, so it has to differ per map
 * without anyone having to name or draw it.
 *
 * Why evocative rather than literal: the dashboard query returns only
 * {_id, publicId, name, visibility, updatedAt, isOwner} — there is no node
 * structure on this screen, and fetching one would cost a query per row. The
 * glyph is therefore a *signature* derived from the map's identity, never a
 * depiction of its contents. Nothing in the UI may claim otherwise: the glyph
 * is aria-hidden decoration and no copy describes it as branches or counts.
 */

/** Square drawing field. Small enough that every unit is ~1.5px on screen. */
const GLYPH_VIEWBOX = 28;

/** The stem starts on the bottom edge, so the plant grows out of the well. */
const STEM_BASE_Y = 27;

/** FNV-1a 32-bit constants. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Branch count when the caller does not pin one: 2–4 keeps the mark legible. */
const MIN_BRANCHES = 2;
const BRANCH_VARIANTS = 3;

type Point = { x: number; y: number };

/** A leaf-dot terminating a branch, or the crown terminating the stem. */
type Leaf = { cx: number; cy: number; r: number };

/** Everything needed to draw one glyph, fully resolved from the seed. */
type Glyph = {
  stem: string;
  branches: string[];
  leaves: Leaf[];
  /** Index into `leaves` of the single dot allowed to carry the clay accent. */
  accentLeaf: number;
};

type MapGlyphProps = {
  /** Stable identity to derive the shape from — the map's `publicId`. */
  seed: string;
  className?: string;
  /**
   * Pins the branch count instead of seeding it. Used by the empty state, where
   * a single-branch sprout has to read as "nothing has grown here yet".
   */
  branchCount?: number;
  /**
   * Whether one leaf-dot takes the clay AI accent. Off where there is no map
   * for the model to have touched.
   */
  accent?: boolean;
};

/**
 * Hashes a string into a 32-bit unsigned integer (FNV-1a).
 *
 * Chosen over a crypto digest because it is a five-line pure function with no
 * async surface: the same `publicId` produces the same integer on the server
 * render, on hydration, and on every later request, which is what keeps the
 * glyph from flickering into a different shape after paint.
 */
function hashSeed(seed: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    // imul keeps the multiply in 32-bit space; a plain `*` would lose precision.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Builds a mulberry32 PRNG seeded by `seed`.
 *
 * Deterministic by construction — no `Math.random`, no clock, no client state —
 * so this module is safe inside a server component and cannot desynchronise
 * between server output and client hydration.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws the next random number into an inclusive-ish range. */
function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

/** Trims coordinate noise so the emitted path strings stay short and stable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Point on a quadratic bezier at `t`. */
function quadPoint(from: Point, control: Point, to: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  };
}

/** Tangent (direction of travel) on a quadratic bezier at `t`. */
function quadTangent(from: Point, control: Point, to: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: 2 * inverse * (control.x - from.x) + 2 * t * (to.x - control.x),
    y: 2 * inverse * (control.y - from.y) + 2 * t * (to.y - control.y),
  };
}

/** Serialises one curved segment. */
function quadPath(from: Point, control: Point, to: Point): string {
  return [
    `M${round(from.x)} ${round(from.y)}`,
    `Q${round(control.x)} ${round(control.y)}`,
    `${round(to.x)} ${round(to.y)}`,
  ].join(" ");
}

/**
 * Resolves a seed string into one plant.
 *
 * Seeded parameters, in draw order: the stem's foot offset, its tip offset and
 * height, its bend control point (the organic lean — never a straight or
 * mirrored stem), the branch count, which side the first branch takes, then per
 * branch its height along the stem, its spread angle off the stem tangent, its
 * length, its curvature, and its leaf radius. Finally, which single leaf carries
 * the clay accent. Every draw comes from the one PRNG stream, so the order of
 * these reads is part of the contract: reordering them reshapes every glyph.
 */
function buildGlyph(seed: string, branchCount?: number): Glyph {
  const random = createRandom(hashSeed(seed));

  const foot: Point = {
    x: GLYPH_VIEWBOX / 2 + between(random, -1.2, 1.2),
    y: STEM_BASE_Y,
  };
  const crown: Point = {
    x: foot.x + between(random, -3.4, 3.4),
    y: between(random, 4.6, 8),
  };
  const bend: Point = {
    x: foot.x + between(random, -4.2, 4.2),
    y: between(random, 12.8, 18.5),
  };

  const count =
    branchCount ?? MIN_BRANCHES + Math.floor(random() * BRANCH_VARIANTS);
  let side = random() < 0.5 ? -1 : 1;

  const branches: string[] = [];
  const leaves: Leaf[] = [];

  for (let index = 0; index < count; index += 1) {
    // Spread the take-off points up the lower two thirds of the stem, with a
    // little jitter so the spacing never reads as a scale on a ruler.
    const t = 0.3 + (index / count) * 0.48 + between(random, 0, 0.07);
    const origin = quadPoint(foot, bend, crown, t);
    const tangent = quadTangent(foot, bend, crown, t);

    const stemAngle = Math.atan2(tangent.y, tangent.x);
    const spread = (between(random, 34, 66) * Math.PI) / 180;
    const angle = stemAngle + side * spread;
    // Higher branches are shorter, the way a young plant tapers.
    const length = between(random, 5.4, 8.6) * (1 - 0.3 * t);

    const tip: Point = {
      x: origin.x + Math.cos(angle) * length,
      y: origin.y + Math.sin(angle) * length,
    };

    // Bow the branch away from its own chord, always towards the light: the
    // perpendicular is flipped when it points down the page.
    const perpendicular: Point = {
      x: -(tip.y - origin.y) / length,
      y: (tip.x - origin.x) / length,
    };
    const lift = perpendicular.y > 0 ? -1 : 1;
    const bow = between(random, 0.9, 2.6) * lift;
    const control: Point = {
      x: (origin.x + tip.x) / 2 + perpendicular.x * bow,
      y: (origin.y + tip.y) / 2 + perpendicular.y * bow,
    };

    branches.push(quadPath(origin, control, tip));
    leaves.push({
      cx: round(tip.x),
      cy: round(tip.y),
      r: round(between(random, 1, 1.5)),
    });

    side = -side;
  }

  leaves.push({
    cx: round(crown.x),
    cy: round(crown.y),
    r: round(between(random, 1.25, 1.7)),
  });

  return {
    accentLeaf: Math.floor(random() * leaves.length),
    branches,
    leaves,
    stem: quadPath(foot, bend, crown),
  };
}

/**
 * Renders the seeded sprig for one map.
 *
 * Pure and hook-free: it is a server component like the page that mounts it.
 * Strokes ride `currentColor`, so the housing decides the moss tone; the one
 * accent dot reaches for `--glow` directly, because clay means "the model
 * touched this" and must not follow the surrounding text colour.
 */
function MapGlyph({
  accent = true,
  branchCount,
  className,
  seed,
}: MapGlyphProps) {
  const glyph = buildGlyph(seed, branchCount);

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.5}
      viewBox={`0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`}
    >
      <path d={glyph.stem} />
      {glyph.branches.map((branch, index) => (
        // Branches sit a shade behind the stem so the mark has a near and a far.
        <path d={branch} key={`branch-${index}`} strokeOpacity={0.75} />
      ))}
      {glyph.leaves.map((leaf, index) => (
        <circle
          cx={leaf.cx}
          cy={leaf.cy}
          fill={
            accent && index === glyph.accentLeaf
              ? "var(--glow)"
              : "currentColor"
          }
          key={`leaf-${index}`}
          r={leaf.r}
          stroke="none"
        />
      ))}
    </svg>
  );
}

export { buildGlyph, MapGlyph };
