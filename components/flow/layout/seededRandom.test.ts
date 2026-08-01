// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  hashString,
  mulberry32,
  seededSigned,
  seededUnit,
} from "./seededRandom";

/**
 * These literals are load-bearing. Every card position and every stem curve is
 * derived from them, so changing the hash or the generator silently rearranges
 * every existing map. If a value here has to move, it is a deliberate reflow.
 */
describe("hashString", () => {
  it("hashes stably", () => {
    expect(hashString("")).toBe(2166136261);
    expect(hashString("root")).toBe(553455173);
    expect(hashString("l-child")).toBe(3877186552);
  });

  it("separates keys that differ only by where the boundary falls", () => {
    expect(hashString("ab c")).not.toBe(hashString("a bc"));
  });
});

describe("mulberry32", () => {
  it("produces the same stream from the same seed", () => {
    const first = mulberry32(42);
    const second = mulberry32(42);

    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it("stays inside the unit interval", () => {
    const draw = mulberry32(7);

    for (let index = 0; index < 500; index += 1) {
      const value = draw();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("seededUnit", () => {
  it("is a pure function of the id and channel", () => {
    expect(seededUnit("l-child", "grove-angle")).toBe(
      seededUnit("l-child", "grove-angle")
    );
    expect(seededUnit("l-child", "grove-angle")).not.toBe(
      seededUnit("l-child", "grove-radius")
    );
    expect(seededUnit("l-child", "grove-angle")).not.toBe(
      seededUnit("r-child", "grove-angle")
    );
  });

  it("signs the same draw symmetrically", () => {
    const id = "l-child";

    expect(seededSigned(id, "grove-angle")).toBeCloseTo(
      seededUnit(id, "grove-angle") * 2 - 1,
      12
    );
  });
});
