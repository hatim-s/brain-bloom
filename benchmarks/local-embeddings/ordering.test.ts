import { describe, expect, it } from "vitest";

import { compareCodeUnits } from "./ordering.ts";
import { sortJsonValue } from "./report.ts";

describe("deterministic code-unit ordering", () => {
  it("orders Unicode and canonically equivalent strings by raw code units", () => {
    const values = ["é", "z", "e\u0301", "Z", "ä"];

    expect(values.sort(compareCodeUnits)).toEqual([
      "Z",
      "e\u0301",
      "z",
      "ä",
      "é",
    ]);
  });

  it("canonicalizes durable JSON keys with the same ordering", () => {
    expect(
      Object.keys(sortJsonValue({ é: 1, "e\u0301": 2, Z: 3 }) as object)
    ).toEqual(["Z", "e\u0301", "é"]);
  });
});
