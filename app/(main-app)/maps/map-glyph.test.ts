import { describe, expect, it } from "vitest";

import { buildGlyph } from "./map-glyph";

/** Extracts every number appearing in the glyph's path strings. */
function coordinates(seed: string): number[] {
  const glyph = buildGlyph(seed);
  const numbers = [glyph.stem, ...glyph.branches]
    .join(" ")
    .match(/-?\d+(\.\d+)?/g);

  return (numbers ?? []).map(Number);
}

describe("buildGlyph", () => {
  it("returns the same drawing for the same seed", () => {
    // The contract the server render depends on: a map's mark can never change
    // between the server pass and hydration, or between two requests.
    expect(buildGlyph("kf83nq2")).toEqual(buildGlyph("kf83nq2"));
  });

  it("returns different drawings for different seeds", () => {
    expect(buildGlyph("kf83nq2").stem).not.toEqual(buildGlyph("kf83nq3").stem);
  });

  it("grows 2 to 4 branches when the count is not pinned", () => {
    const counts = new Set<number>();

    for (let index = 0; index < 200; index += 1) {
      const { branches } = buildGlyph(`seed-${index}`);
      expect(branches.length).toBeGreaterThanOrEqual(2);
      expect(branches.length).toBeLessThanOrEqual(4);
      counts.add(branches.length);
    }

    // Seeded asymmetry has to actually vary, otherwise every row looks alike.
    expect(counts.size).toBe(3);
  });

  it("honours a pinned branch count", () => {
    expect(buildGlyph("sprig", 1).branches).toHaveLength(1);
  });

  it("marks exactly one leaf as the accent leaf", () => {
    const glyph = buildGlyph("kf83nq2");

    // One clay heart per glyph: the row's only AI accent.
    expect(glyph.accentLeaf).toBeGreaterThanOrEqual(0);
    expect(glyph.accentLeaf).toBeLessThan(glyph.leaves.length);
    // A leaf per branch, plus the crown on the stem's tip.
    expect(glyph.leaves).toHaveLength(glyph.branches.length + 1);
  });

  it("stays inside the 28-unit drawing field", () => {
    for (let index = 0; index < 200; index += 1) {
      const values = coordinates(`seed-${index}`);
      // Room for the 1.5-unit stroke on every side; the stem's foot is meant to
      // reach the bottom edge (y = 27) so the plant grows out of its well.
      expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...values)).toBeLessThanOrEqual(27);

      for (const leaf of buildGlyph(`seed-${index}`).leaves) {
        expect(leaf.cx - leaf.r).toBeGreaterThanOrEqual(1);
        expect(leaf.cx + leaf.r).toBeLessThanOrEqual(27);
        expect(leaf.cy - leaf.r).toBeGreaterThanOrEqual(1);
        expect(leaf.cy + leaf.r).toBeLessThanOrEqual(27);
      }
    }
  });
});
