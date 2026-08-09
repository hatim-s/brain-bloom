import { describe, expect, it } from "vitest";

import { readJsonFixture } from "./cli.ts";
import type { CandidateConfiguration, EmbeddingCandidate } from "./types.ts";
import {
  validateBenchmarkFixtures,
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
  offlineCachePath: "candidate-a",
  adapter: {
    id: "test-adapter",
    version: "1.0.0",
    revision: "c".repeat(40),
    modulePath: "adapter/adapter.mjs",
    artifactChecksum: `sha256:${"d".repeat(64)}`,
    manifestPath: "adapter/manifest.json",
    manifestChecksum: `sha256:${"f".repeat(64)}`,
    bundle: {
      format: "self-contained-esm-bundle/v1",
      allowedNodeBuiltins: [],
    },
  },
  runtime: { id: "test-runtime", version: "1.0.0" },
  preprocessing: {
    id: "test-preprocessing",
    version: "1.0.0",
    pooling: "mean",
    normalize: true,
    queryPrefix: "query: ",
    documentPrefix: "document: ",
  },
};

const validBudgets = {
  maxColdLoadMs: 1,
  maxWarmQueryP95Ms: 1,
  minIngestionSegmentsPerSecond: 1,
  maxResidentMemoryMb: 1,
  maxCacheBytes: 1_000,
};

/** Creates a complete two-candidate configuration for focused schema tests. */
function createConfiguration(): CandidateConfiguration {
  return {
    schemaVersion: 1,
    budgets: validBudgets,
    cacheLimits: { maxBytes: 1_000, maxFiles: 10, maxDepth: 3 },
    adapterLimits: { maxBytes: 1_000, maxFiles: 4, maxDepth: 2 },
    measurement: { warmQueryPasses: 2, candidateTimeoutMs: 1000 },
    candidates: [
      validCandidate,
      {
        ...validCandidate,
        key: "candidate-b",
        modelId: "local/candidate-b",
        revision: "e".repeat(40),
        offlineCachePath: "candidate-b",
      },
    ],
  };
}

describe("embedding candidate runtime validation", () => {
  it("accepts only exact hexadecimal revisions and checksums", () => {
    expect(() => validateCandidate(validCandidate)).not.toThrow();
    expect(() =>
      validateCandidate({ ...validCandidate, revision: "main" })
    ).toThrow();
    expect(() =>
      validateCandidate({ ...validCandidate, artifactChecksum: "" })
    ).toThrow();
  });

  it("rejects absolute, parent-traversal, and unknown candidate fields", () => {
    expect(() =>
      validateCandidate({ ...validCandidate, offlineCachePath: "/tmp/model" })
    ).toThrow(/dedicated cache root/);
    expect(() =>
      validateCandidate({ ...validCandidate, offlineCachePath: "../model" })
    ).toThrow(/dedicated cache root/);
    expect(() =>
      validateCandidate({ ...validCandidate, unexpected: true })
    ).toThrow();
  });

  it("requires two candidates and complete positive hard limits", () => {
    const configuration = createConfiguration();
    expect(() =>
      validateCandidateConfiguration({
        ...configuration,
        candidates: [validCandidate],
      })
    ).toThrow();
    expect(() =>
      validateCandidateConfiguration({
        ...configuration,
        cacheLimits: { ...configuration.cacheLimits, maxFiles: 0 },
      })
    ).toThrow();
    expect(() =>
      validateCandidateConfiguration({
        ...configuration,
        measurement: {
          ...configuration.measurement,
          candidateTimeoutMs: 999,
        },
      })
    ).toThrow();
  });

  it("rejects duplicate and dependency-escape bundle builtins", () => {
    const configuration = createConfiguration();
    configuration.candidates[0].adapter.bundle.allowedNodeBuiltins = [
      "node:crypto",
      "node:crypto",
    ];
    expect(() => validateCandidateConfiguration(configuration)).toThrow(
      /must be unique/
    );

    const moduleEscape = createConfiguration();
    moduleEscape.candidates[0].adapter.bundle.allowedNodeBuiltins = [
      "node:module",
    ];
    expect(() => validateCandidateConfiguration(moduleEscape)).toThrow(
      /unsupported/
    );
  });
});

describe("benchmark fixture runtime validation", () => {
  it("accepts the committed expanded multilingual fixtures", async () => {
    const fixtures = validateBenchmarkFixtures(
      await readJsonFixture("corpus.v1.json"),
      await readJsonFixture("questions.v1.json")
    );
    expect(fixtures.corpus.segments.length).toBeGreaterThanOrEqual(60);
    expect(fixtures.questionSet.questions).toHaveLength(32);
    for (const logicalSourceId of ["biology-reader", "history-notes"]) {
      const versions = fixtures.corpus.sources.filter(
        (source) => source.logicalSourceId === logicalSourceId
      );
      expect(versions).toHaveLength(2);
      expect(versions.filter((source) => source.active)).toHaveLength(1);
    }
    const historyV1 = fixtures.corpus.sources.find(
      (source) => source.sourceId === "history-notes-docx-v1"
    );
    expect(historyV1?.active).toBe(true);
  });

  it("rejects unknown enums and undeclared languages", async () => {
    const corpus = validateBenchmarkFixtures(
      await readJsonFixture("corpus.v1.json"),
      await readJsonFixture("questions.v1.json")
    ).corpus;
    const questionSet = validateBenchmarkFixtures(
      corpus,
      await readJsonFixture("questions.v1.json")
    ).questionSet;
    expect(() =>
      validateBenchmarkFixtures(corpus, {
        ...questionSet,
        questions: questionSet.questions.map((question, index) =>
          index === 0 ? { ...question, category: "typo-category" } : question
        ),
      })
    ).toThrow();
    expect(() =>
      validateBenchmarkFixtures(corpus, {
        ...questionSet,
        questions: questionSet.questions.map((question, index) =>
          index === 0 ? { ...question, language: "fr" } : question
        ),
      })
    ).toThrow();
    expect(() =>
      validateBenchmarkFixtures(
        {
          ...corpus,
          segments: corpus.segments.map((segment, index) =>
            index === 0 ? { ...segment, format: "html" } : segment
          ),
        },
        questionSet
      )
    ).toThrow();
  });

  it("rejects duplicate relevance and question-segment language mismatch", async () => {
    const fixtures = validateBenchmarkFixtures(
      await readJsonFixture("corpus.v1.json"),
      await readJsonFixture("questions.v1.json")
    );
    const first = fixtures.questionSet.questions[0];
    expect(() =>
      validateBenchmarkFixtures(fixtures.corpus, {
        ...fixtures.questionSet,
        questions: [
          { ...first, relevantSegmentIds: ["pdf-01", "pdf-01"] },
          ...fixtures.questionSet.questions.slice(1),
        ],
      })
    ).toThrow(/repeats a relevant segment/);
    expect(() =>
      validateBenchmarkFixtures(fixtures.corpus, {
        ...fixtures.questionSet,
        questions: [
          { ...first, language: "es" },
          ...fixtures.questionSet.questions.slice(1),
        ],
      })
    ).toThrow(/language does not match/);
  });

  it("rejects duplicate segment IDs and missing relevant references", async () => {
    const fixtures = validateBenchmarkFixtures(
      await readJsonFixture("corpus.v1.json"),
      await readJsonFixture("questions.v1.json")
    );
    expect(() =>
      validateBenchmarkFixtures(
        {
          ...fixtures.corpus,
          segments: fixtures.corpus.segments.map((segment, index) =>
            index === 1
              ? { ...segment, id: fixtures.corpus.segments[0].id }
              : segment
          ),
        },
        fixtures.questionSet
      )
    ).toThrow(/Duplicate segment id/);
    expect(() =>
      validateBenchmarkFixtures(fixtures.corpus, {
        ...fixtures.questionSet,
        questions: fixtures.questionSet.questions.map((question, index) =>
          index === 0
            ? { ...question, relevantSegmentIds: ["missing-segment"] }
            : question
        ),
      })
    ).toThrow(/references missing/);
  });

  it("requires complete measurable integrity scenarios and valid exclusion metadata", async () => {
    const fixtures = validateBenchmarkFixtures(
      await readJsonFixture("corpus.v1.json"),
      await readJsonFixture("questions.v1.json")
    );
    expect(() =>
      validateBenchmarkFixtures(fixtures.corpus, {
        ...fixtures.questionSet,
        integrityQuestions: fixtures.questionSet.integrityQuestions.map(
          (question) =>
            question.scenario === "limit"
              ? {
                  ...question,
                  scenario: "malformed" as const,
                  forbiddenSegmentIds: ["pdf-25"],
                }
              : question
        ),
      })
    ).toThrow(/cover scenario limit/);
    expect(() =>
      validateBenchmarkFixtures(fixtures.corpus, {
        ...fixtures.questionSet,
        integrityQuestions: fixtures.questionSet.integrityQuestions.map(
          (question) =>
            question.scenario === "cross-owner"
              ? { ...question, forbiddenSegmentIds: ["pdf-26"] }
              : question
        ),
      })
    ).toThrow(/does not exercise cross-owner/);
  });

  it("rejects logical sources without exactly one active version", async () => {
    const fixtures = validateBenchmarkFixtures(
      await readJsonFixture("corpus.v1.json"),
      await readJsonFixture("questions.v1.json")
    );
    expect(() =>
      validateBenchmarkFixtures(
        {
          ...fixtures.corpus,
          sources: fixtures.corpus.sources.map((source) =>
            source.logicalSourceId === "biology-reader"
              ? { ...source, active: false }
              : source
          ),
        },
        fixtures.questionSet
      )
    ).toThrow(/exactly one active version/);
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
