import { describe, expect, it } from "vitest";

import { evaluateIntegrity } from "./integrity.ts";
import type { BenchmarkCorpus, IntegrityQuestion } from "./types.ts";

describe("integrity leakage evaluation", () => {
  it("fails when a forbidden cross-owner segment is the perfect full-corpus match", () => {
    const corpus: BenchmarkCorpus = {
      schemaVersion: 1,
      multilingual: { required: false, languages: ["en"] },
      sources: [
        {
          sourceId: "allowed",
          ownerId: "owner-a",
          scopeId: "scope-a",
          logicalSourceId: "allowed",
          version: "1",
          active: true,
          retrievable: true,
          scenario: "representative",
        },
        {
          sourceId: "forbidden",
          ownerId: "owner-b",
          scopeId: "scope-b",
          logicalSourceId: "forbidden",
          version: "1",
          active: true,
          retrievable: true,
          scenario: "cross-owner",
        },
      ],
      segments: [
        {
          id: "allowed-segment",
          sourceId: "allowed",
          format: "pdf",
          locator: "allowed",
          text: "allowed",
          language: "en",
        },
        {
          id: "forbidden-perfect",
          sourceId: "forbidden",
          format: "pdf",
          locator: "forbidden",
          text: "forbidden",
          language: "en",
        },
      ],
    };
    const question: IntegrityQuestion = {
      id: "cross-owner-query",
      text: "forbidden",
      language: "en",
      ownerId: "owner-a",
      scopeId: "scope-a",
      scenario: "cross-owner",
      expectedSegmentIds: ["allowed-segment"],
      forbiddenSegmentIds: ["forbidden-perfect"],
    };

    const evaluation = evaluateIntegrity({
      corpus,
      questions: [question],
      queryVectors: new Map([[question.id, [1, 0]]]),
      segmentVectors: new Map([
        ["allowed-segment", [0, 1]],
        ["forbidden-perfect", [1, 0]],
      ]),
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.crossOwnerLeakageCount).toBe(1);
    expect(evaluation.forbiddenHitsAt20).toBe(1);
    expect(evaluation.scenarios["cross-owner"].passed).toBe(false);
  });
});
