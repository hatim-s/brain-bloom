import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
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
import { validateBenchmarkReport } from "./validation.ts";

let workspaceRoot = "";
const cacheRootRelative = "cache";
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
  cacheLimits: { maxBytes: 1_000, maxFiles: 10, maxDepth: 2 },
  measurement: { warmQueryPasses: 2, memorySampleIntervalMs: 1 },
  candidates: ["a", "b"].map((key) => ({
    key: `candidate-${key}`,
    modelId: `local/candidate-${key}`,
    revision: key.repeat(40),
    dimensions: 3,
    artifactChecksum,
    offlineCachePath: `candidate-${key}.bin`,
    adapter: {
      id: "fake-adapter",
      version: "1.0.0",
      revision: "c".repeat(40),
      artifactChecksum: `sha256:${"d".repeat(64)}`,
    },
    runtime: { id: "fake-runtime", version: "1.0.0" },
    preprocessing: {
      id: "fake-preprocessing",
      version: "1.0.0",
      pooling: "mean" as const,
      normalize: true,
      queryPrefix: "query: ",
      documentPrefix: "document: ",
    },
  })),
};

const corpus: BenchmarkCorpus = {
  schemaVersion: 1,
  multilingual: { required: false, languages: ["en"] },
  segments: Array.from({ length: 60 }, (_, index) => ({
    id: `segment-${index}`,
    sourceId: `source-${Math.floor(index / 20)}`,
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

/** Creates a deterministic absolute/peak RSS probe for CI. */
function createRuntimeProbe(
  residentValues = [100, 100, 100, 100]
): RuntimeProbe {
  let residentIndex = 0;
  return {
    environment: () => ({
      platform: "test",
      architecture: "test-arch",
      nodeVersion: "v-test",
      cpuModel: "deterministic-cpu",
      cpuCount: 1,
    }),
    residentMemoryBytes: () =>
      residentValues[Math.min(residentIndex++, residentValues.length - 1)],
    measurePeak: async (operation) => ({
      result: await operation(),
      peakResidentMemoryBytes: 150,
    }),
  };
}

/** Creates the deterministic role-aware fake adapter used by CI. */
function createAdapterFactory(events: string[] = []): EmbeddingAdapterFactory {
  return {
    create: async (candidate) => {
      events.push(`create:${candidate.key}`);
      return {
        identity: {
          adapter: candidate.adapter,
          runtime: candidate.runtime,
          preprocessing: candidate.preprocessing,
        },
        load: async () => {
          events.push(`load:${candidate.key}`);
        },
        embed: async (texts, role) => {
          events.push(`embed:${role}:${texts[0]}`);
          return texts.map(fakeVector);
        },
      };
    },
  };
}

/** Runs a fully offline two-candidate benchmark against fake artifacts. */
async function runFakeBenchmark(
  runtimeProbe = createRuntimeProbe(),
  adapterFactory = createAdapterFactory()
) {
  return runBenchmark({
    configuration,
    corpus,
    questionSet,
    adapterFactory,
    workspaceRoot,
    cacheRootRelative,
    run: true,
    allowDownloads: false,
    clock: createClock(),
    runtimeProbe,
  });
}

describe("local embedding benchmark runner", () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sprig-runner-"));
    await mkdir(path.join(workspaceRoot, cacheRootRelative));
    await Promise.all(
      configuration.candidates.map((candidate) =>
        writeFile(
          path.join(
            workspaceRoot,
            cacheRootRelative,
            candidate.offlineCachePath
          ),
          artifactContents,
          "utf8"
        )
      )
    );
  });

  it("runs pinned role-aware adapters and never emits a selection", async () => {
    const report = await runFakeBenchmark();

    expect(report.decision).toBe("not-selected");
    expect(report.results).toHaveLength(2);
    expect(report.results[0].offlineCache).toMatchObject({
      status: "verified",
      checksum: artifactChecksum,
    });
    expect(report.results[0].latency.warmQuery.samples).toBe(58);
    expect(report.results[0].ingestion.segmentCount).toBe(60);
    expect(report.results[0].resources).toMatchObject({
      residentMemoryBeforeBytes: 100,
      residentMemoryPeakBytes: 150,
      residentMemoryAfterBytes: 100,
      residentMemoryMeasurement: "valid",
    });
    expect(report.baselines.randomExpected["20"]).toBeCloseTo(1 / 3);
  });

  it("loads explicitly, measures cold query once, and warms each role before timing", async () => {
    const events: string[] = [];
    await runFakeBenchmark(createRuntimeProbe(), createAdapterFactory(events));
    const firstCandidateEvents = events.slice(
      0,
      events.indexOf("create:candidate-b")
    );

    expect(firstCandidateEvents[0]).toBe("create:candidate-a");
    expect(firstCandidateEvents[1]).toBe("load:candidate-a");
    expect(firstCandidateEvents[2]).toBe(
      "embed:query:synthetic study question 0"
    );
    expect(firstCandidateEvents[3]).toBe(
      "embed:document:synthetic study segment 0"
    );
    expect(
      firstCandidateEvents.filter((event) =>
        event.endsWith("synthetic study question 0")
      )
    ).toHaveLength(1);
  });

  it("denies a cache miss before creating an adapter", async () => {
    const create = vi.fn(createAdapterFactory().create);
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
        adapterFactory: { create },
        workspaceRoot,
        cacheRootRelative,
        run: true,
        allowDownloads: false,
      })
    ).rejects.toThrow(/downloads remain denied/);
    expect(create).not.toHaveBeenCalled();
  });

  it("denies an oversized cache before creating an adapter", async () => {
    const create = vi.fn(createAdapterFactory().create);
    await expect(
      runBenchmark({
        configuration: {
          ...configuration,
          cacheLimits: { ...configuration.cacheLimits, maxBytes: 2 },
        },
        corpus,
        questionSet,
        adapterFactory: { create },
        workspaceRoot,
        cacheRootRelative,
        run: true,
        allowDownloads: false,
      })
    ).rejects.toThrow(/maxBytes/);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses adapter identity drift before loading the model", async () => {
    const load = vi.fn(async () => undefined);
    const adapterFactory: EmbeddingAdapterFactory = {
      create: async (candidate) => ({
        identity: {
          adapter: { ...candidate.adapter, version: "drifted" },
          runtime: candidate.runtime,
          preprocessing: candidate.preprocessing,
        },
        load,
        embed: async (texts) => texts.map(fakeVector),
      }),
    };

    await expect(
      runFakeBenchmark(createRuntimeProbe(), adapterFactory)
    ).rejects.toThrow(/identity mismatch/);
    expect(load).not.toHaveBeenCalled();
  });

  it("marks an RSS regression invalid instead of clamping it to zero", async () => {
    const report = await runFakeBenchmark(
      createRuntimeProbe([200, 100, 200, 100])
    );

    expect(report.results[0].resources.residentMemoryMeasurement).toBe(
      "invalid-after-below-before"
    );
    expect(report.results[0].budgets.residentMemoryMb.status).toBe("invalid");
  });

  it("produces deterministic validated JSON and human-readable comparisons", async () => {
    const first = await runFakeBenchmark();
    const second = await runFakeBenchmark();

    expect(createJsonReport(first)).toBe(createJsonReport(second));
    const markdown = createMarkdownReport(first);
    expect(markdown).toContain("Decision: **not selected**");
    expect(markdown).toContain(artifactChecksum);
    expect(markdown).toContain("fake-adapter@1.0.0");
    expect(markdown).toContain("Random expected recall");
  });

  it("rejects invalid result enums and incomplete language aggregates", async () => {
    const report = await runFakeBenchmark();
    expect(() =>
      validateBenchmarkReport({ ...report, decision: "selected" })
    ).toThrow();
    expect(() =>
      validateBenchmarkReport({
        ...report,
        results: report.results.map((result, index) =>
          index === 0
            ? {
                ...result,
                multilingual: { ...result.multilingual, languages: {} },
              }
            : result
        ),
      })
    ).toThrow(/language aggregates are incomplete/);
  });
});
