import { describe, expect, it } from "vitest";

import {
  calculateRandomExpectedRecall,
  calculateRecallMetrics,
  rankSegments,
  recallAtDepth,
  summarizeLatencies,
} from "./metrics.ts";
import type { BenchmarkQuestion } from "./types.ts";

describe("embedding benchmark metrics", () => {
  it("computes fractional recall at each retrieval depth", () => {
    expect(recallAtDepth(["a", "c"], ["a", "b", "c"], 1)).toBe(0.5);
    expect(recallAtDepth(["a", "c"], ["a", "b", "c"], 3)).toBe(1);
  });

  it("aggregates overall and per-category recall", () => {
    const questions: BenchmarkQuestion[] = [
      {
        id: "heading",
        text: "heading",
        category: "headings",
        language: "en",
        relevantSegmentIds: ["a"],
      },
      {
        id: "definition",
        text: "definition",
        category: "definitions",
        language: "en",
        relevantSegmentIds: ["b"],
      },
      {
        id: "bullet",
        text: "bullet",
        category: "slide-bullets",
        language: "en",
        relevantSegmentIds: ["c"],
      },
      {
        id: "paraphrase",
        text: "paraphrase",
        category: "paraphrases",
        language: "en",
        relevantSegmentIds: ["d"],
      },
    ];
    const rankings = new Map([
      ["heading", ["a", "b", "c", "d"]],
      ["definition", ["a", "b", "c", "d"]],
      ["bullet", ["a", "b", "c", "d"]],
      ["paraphrase", ["a", "b", "c", "d"]],
    ]);

    const metrics = calculateRecallMetrics(questions, rankings);

    expect(metrics.overall.recall["5"]).toBe(1);
    expect(metrics.overall.questionCount).toBe(4);
    expect(metrics.byCategory.definitions.recall["5"]).toBe(1);
    expect(metrics.byCategory.paraphrases.recall["20"]).toBe(1);
  });

  it("uses stable segment IDs to break equal-score ties", () => {
    expect(
      rankSegments(
        [1, 0],
        [
          { id: "z", vector: [1, 0] },
          { id: "a", vector: [1, 0] },
        ]
      )
    ).toEqual(["a", "z"]);
  });

  it("summarizes median and nearest-rank p95 deterministically", () => {
    expect(summarizeLatencies([5, 1, 3, 2])).toEqual({
      samples: 4,
      minMs: 1,
      medianMs: 2.5,
      p95Ms: 5,
      maxMs: 5,
    });
  });

  it("records a discriminating analytic random baseline", () => {
    expect(calculateRandomExpectedRecall(100)).toEqual({
      "5": 0.05,
      "10": 0.1,
      "20": 0.2,
    });
  });
});
