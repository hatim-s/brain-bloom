// @vitest-environment node

import { describe, expect, it } from "vitest";

import { estimateNodeSize, nodeWidthForDepth } from "./nodeSize";

/**
 * Contract test. These numbers are shared with the node card: the card is
 * styled to exactly these widths and line heights, and the layout reserves
 * exactly this much room. A deliberate change here has to land on both sides.
 */
describe("estimateNodeSize", () => {
  it("pins the card width at every depth", () => {
    expect([0, 1, 2, 3, 4, 9].map(nodeWidthForDepth)).toEqual([
      320, 300, 264, 236, 236, 236,
    ]);
  });

  it("reserves one title line plus padding for a bare card", () => {
    const bare = { data: {} };

    expect(estimateNodeSize(bare, 0)).toEqual({ width: 320, height: 70 });
    expect(estimateNodeSize(bare, 1)).toEqual({ width: 300, height: 62 });
    expect(estimateNodeSize(bare, 2)).toEqual({ width: 264, height: 56 });
    expect(estimateNodeSize(bare, 3)).toEqual({ width: 236, height: 49 });
  });

  it("reserves two clamped description lines when there is a description", () => {
    const described = { data: { description: "Two clamped lines of body." } };

    expect(estimateNodeSize(described, 0)).toEqual({ width: 320, height: 118 });
    expect(estimateNodeSize(described, 1)).toEqual({ width: 300, height: 110 });
    expect(estimateNodeSize(described, 2)).toEqual({ width: 264, height: 98 });
    expect(estimateNodeSize(described, 4)).toEqual({ width: 236, height: 91 });
  });

  it("treats an empty description as no description", () => {
    expect(estimateNodeSize({ data: { description: "" } }, 1)).toEqual(
      estimateNodeSize({ data: {} }, 1)
    );
  });

  it("clamps a nonsense depth onto the tiers", () => {
    expect(estimateNodeSize({ data: {} }, -3)).toEqual(
      estimateNodeSize({ data: {} }, 0)
    );
    expect(estimateNodeSize({ data: {} }, Number.NaN)).toEqual(
      estimateNodeSize({ data: {} }, 0)
    );
  });
});
