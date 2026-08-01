// @vitest-environment node

import { describe, expect, it } from "vitest";

import { anchorOnBox, buildStemPath, type StemBox } from "./stemPath";

/** A parent card west of the origin, as the grove would place one. */
const PARENT: StemBox = { x: -400, y: 0, width: 300, height: 62 };

/** A child card further west and below it. */
const CHILD: StemBox = { x: -780, y: 220, width: 264, height: 56 };

describe("anchorOnBox", () => {
  it("lands on the card boundary along the requested direction", () => {
    const anchor = anchorOnBox(PARENT, -1, 0);

    // 150px half-width plus the 2px breathing gap.
    expect(anchor).toEqual({ x: -552, y: 0 });
  });

  it("leaves through the horizontal edge when the direction is steep", () => {
    const anchor = anchorOnBox(PARENT, 0, 1);

    expect(anchor).toEqual({ x: -400, y: 33 });
  });
});

describe("buildStemPath", () => {
  it("draws one cubic from the source boundary to the target boundary", () => {
    const path = buildStemPath("e@a@b", PARENT, CHILD);
    const [start, ...rest] = readPoints(path);

    expect(path.startsWith("M ")).toBe(true);
    expect(path).toContain("C ");
    expect(rest).toHaveLength(3);
    // The stroke starts outside the parent card, never at its centre.
    expect(Math.hypot(start.x - PARENT.x, start.y - PARENT.y)).toBeGreaterThan(
      30
    );
  });

  it("bows off the straight line between the two anchors", () => {
    const path = buildStemPath("e@a@b", PARENT, CHILD);
    const [start, firstHandle, , end] = readPoints(path);

    const alongX = end.x - start.x;
    const alongY = end.y - start.y;
    const handleX = firstHandle.x - start.x;
    const handleY = firstHandle.y - start.y;
    // A non-zero cross product means the handle is off-axis: a curve, not a wire.
    const cross = Math.abs(alongX * handleY - alongY * handleX);

    expect(cross).toBeGreaterThan(0);
  });

  it("gives the same edge the same curve every time", () => {
    expect(buildStemPath("e@a@b", PARENT, CHILD)).toBe(
      buildStemPath("e@a@b", PARENT, CHILD)
    );
  });

  it("gives two edges between the same boxes different curves", () => {
    expect(buildStemPath("e@a@b", PARENT, CHILD)).not.toBe(
      buildStemPath("e@a@c", PARENT, CHILD)
    );
  });

  it("falls back to a straight line for stacked cards", () => {
    const path = buildStemPath("e@a@b", PARENT, { ...PARENT });

    expect(path).toBe("M -400,0 L -400,0");
  });
});

/** Extracts every coordinate pair from an SVG path command string. */
function readPoints(path: string): Array<{ x: number; y: number }> {
  return path
    .replace(/[MC]/g, "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}
