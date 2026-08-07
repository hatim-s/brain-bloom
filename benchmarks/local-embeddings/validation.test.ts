import { describe, expect, it } from "vitest";

import type { CandidateConfiguration, EmbeddingCandidate } from "./types.ts";
import {
  validateCandidate,
  validateCandidateConfiguration,
  validateEmbeddingVector,
} from "./validation.ts";

const validCandidate: EmbeddingCandidate = {
  key: "candidate-a",
  modelId: "local/candidate-a",
  revision: "a".repeat(40),
  dimensions: 3,
  artifactChecksum: `sha256:${"b".repeat(64)}`,
  offlineCachePath: ".cache/candidate-a",
};

const validBudgets = {
  maxColdLoadMs: 1,
  maxWarmQueryP95Ms: 1,
  minIngestionSegmentsPerSecond: 1,
  maxResidentMemoryMb: 1,
  maxCacheBytes: 1,
};

describe("embedding candidate validation", () => {
  it("accepts only exact hexadecimal revisions", () => {
    expect(() => validateCandidate(validCandidate)).not.toThrow();
    expect(() =>
      validateCandidate({ ...validCandidate, revision: "main" })
    ).toThrow(/exact 40-64/);
  });

  it("refuses missing or malformed checksums", () => {
    expect(() =>
      validateCandidate({ ...validCandidate, artifactChecksum: "" })
    ).toThrow(/checksum/);
    expect(() =>
      validateCandidate({
        ...validCandidate,
        artifactChecksum: `sha256:${"x".repeat(64)}`,
      })
    ).toThrow(/checksum/);
  });

  it("requires at least two configured candidates", () => {
    const configuration: CandidateConfiguration = {
      schemaVersion: 1,
      budgets: validBudgets,
      candidates: [validCandidate],
    };
    expect(() => validateCandidateConfiguration(configuration)).toThrow(
      /at least two candidates/
    );
  });
});

describe("embedding vector validation", () => {
  it("rejects dimension mismatch", () => {
    expect(() => validateEmbeddingVector([1, 2], 3, "vector")).toThrow(
      /dimension mismatch/
    );
  });

  it("rejects NaN and other non-finite values", () => {
    expect(() =>
      validateEmbeddingVector([1, Number.NaN, 2], 3, "vector")
    ).toThrow(/non-finite/);
    expect(() =>
      validateEmbeddingVector([1, Number.POSITIVE_INFINITY, 2], 3, "vector")
    ).toThrow(/non-finite/);
  });

  it("rejects zero and near-zero vectors", () => {
    expect(() => validateEmbeddingVector([0, 0, 0], 3, "vector")).toThrow(
      /near-zero/
    );
    expect(() =>
      validateEmbeddingVector([1e-13, 1e-13, 1e-13], 3, "vector")
    ).toThrow(/near-zero/);
  });
});
