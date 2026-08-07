import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonReport, createMarkdownReport } from "./report.ts";
import { runBenchmark } from "./runner.ts";
import type {
  BenchmarkClock,
  BenchmarkCorpus,
  BenchmarkQuestionSet,
  CandidateConfiguration,
  EmbeddingAdapterFactory,
  RuntimeProbe,
} from "./types.ts";

const cacheRoot = path.join(
  process.env.TMPDIR ?? "/tmp",
  "brain-bloom-embedding-benchmark-tests"
);
const artifactContents = "deterministic fake model artifact";
const artifactChecksum = `sha256:${createHash("sha256")
  .update(artifactContents)
  .digest("hex")}`;

const configuration: CandidateConfiguration = {
  schemaVersion: 1,
  budgets: {
    maxColdLoadMs: 10,
    maxWarmQueryP95Ms: 10,
    minIngestionSegmentsPerSecond: 1,
    maxResidentMemoryMb: 10,
    maxCacheBytes: 1_000,
  },
  candidates: ["a", "b"].map((key) => ({
    key: `candidate-${key}`,
    modelId: `local/candidate-${key}`,
    revision: key.repeat(40),
    dimensions: 3,
    artifactChecksum,
    offlineCachePath: `candidate-${key}.bin`,
  })),
};

const corpus: BenchmarkCorpus = {
  schemaVersion: 1,
  multilingual: { required: false, languages: [] },
  segments: Array.from({ length: 21 }, (_, index) => ({
    id: `segment-${index}`,
    sourceId: `source-${Math.floor(index / 7)}`,
    format: (["pdf", "docx", "pptx"] as const)[index % 3],
    locator: `locator ${index}`,
    text: `synthetic study segment ${index}`,
    language: "en",
  })),
};

const categories = [
  "headings",
  "definitions",
  "slide-bullets",
  "paraphrases",
] as const;
const questionSet: BenchmarkQuestionSet = {
  schemaVersion: 1,
  questions: Array.from({ length: 30 }, (_, index) => ({
    id: `question-${index}`,
    text: `synthetic study question ${index}`,
    category: categories[index % categories.length],
    language: "en",
    relevantSegmentIds: [`segment-${index % corpus.segments.length}`],
  })),
};

/** Produces valid deterministic vectors without loading a model. */
function fakeVector(text: string): number[] {
  return [1, (text.length % 11) + 1, (text.charCodeAt(0) % 7) + 1];
}

/** Advances exactly one millisecond per observation for stable timing output. */
function createClock(): BenchmarkClock {
  let current = 0;
  return { nowMs: () => current++ };
}

const runtimeProbe: RuntimeProbe = {
  environment: () => ({
    platform: "test",
    architecture: "test-arch",
    nodeVersion: "v-test",
    cpuModel: "deterministic-cpu",
    cpuCount: 1,
  }),
  residentMemoryBytes: () => 100,
};

/** Creates the deterministic fake adapter used by CI. */
function createAdapterFactory(): EmbeddingAdapterFactory {
  return {
    create: async () => ({
      embed: async (texts) => texts.map(fakeVector),
    }),
  };
}

/** Runs a fully offline two-candidate benchmark against fake artifacts. */
async function runFakeBenchmark() {
  return runBenchmark({
    configuration,
    corpus,
    questionSet,
    adapterFactory: createAdapterFactory(),
    cacheRoot,
    run: true,
    allowDownloads: false,
    clock: createClock(),
    runtimeProbe,
  });
}

describe("local embedding benchmark runner", () => {
  beforeEach(async () => {
    await mkdir(cacheRoot, { recursive: true });
    await Promise.all(
      configuration.candidates.map((candidate) =>
        writeFile(
          path.join(cacheRoot, candidate.offlineCachePath),
          artifactContents,
          "utf8"
        )
      )
    );
  });

  it("runs two injected candidates and never emits a selection", async () => {
    const report = await runFakeBenchmark();

    expect(report.decision).toBe("not-selected");
    expect(report.results).toHaveLength(2);
    expect(report.results[0].offlineCache).toMatchObject({
      status: "verified",
      checksum: artifactChecksum,
    });
    expect(report.results[0].latency.warmQuery.samples).toBe(30);
    expect(report.results[0].ingestion.segmentCount).toBe(21);
  });

  it("denies a cache miss before creating an adapter", async () => {
    const factory: EmbeddingAdapterFactory = { create: vi.fn() };
    await expect(
      runBenchmark({
        configuration: {
          ...configuration,
          candidates: configuration.candidates.map((candidate) => ({
            ...candidate,
            offlineCachePath: `missing-${candidate.key}`,
          })),
        },
        corpus,
        questionSet,
        adapterFactory: factory,
        cacheRoot,
        run: true,
        allowDownloads: false,
      })
    ).rejects.toThrow(/downloads remain denied/);
    expect(factory.create).not.toHaveBeenCalled();
  });

  it("produces deterministic JSON and human-readable comparisons", async () => {
    const first = await runFakeBenchmark();
    const second = await runFakeBenchmark();

    expect(createJsonReport(first)).toBe(createJsonReport(second));
    const markdown = createMarkdownReport(first);
    expect(markdown).toContain("Decision: **not selected**");
    expect(markdown).toContain(artifactChecksum);
    expect(markdown).toContain(configuration.candidates[0].revision);
  });
});
