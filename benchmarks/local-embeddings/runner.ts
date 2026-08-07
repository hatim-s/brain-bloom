import os from "node:os";
import { isDeepStrictEqual } from "node:util";

import { verifyCacheArtifact } from "./cache.ts";
import {
  calculateLexicalBaseline,
  calculateRandomExpectedRecall,
  calculateRecallMetrics,
  createRecallAggregate,
  rankSegments,
  summarizeLatencies,
} from "./metrics.ts";
import { ensureConfinedDirectory, inspectConfinedPath } from "./paths.ts";
import { assertExecutionPolicy } from "./policy.ts";
import type {
  BenchmarkClock,
  BenchmarkCorpus,
  BenchmarkQuestionSet,
  BenchmarkReport,
  BudgetObservation,
  CandidateBenchmarkResult,
  CandidateConfiguration,
  EmbeddingAdapter,
  EmbeddingAdapterFactory,
  EmbeddingCandidate,
  RuntimeProbe,
} from "./types.ts";
import {
  validateBenchmarkFixtures,
  validateCandidateConfiguration,
  validateEmbeddingVector,
} from "./validation.ts";

type BenchmarkRunOptions = {
  configuration: CandidateConfiguration;
  corpus: BenchmarkCorpus;
  questionSet: BenchmarkQuestionSet;
  adapterFactory: EmbeddingAdapterFactory;
  workspaceRoot: string;
  cacheRootRelative: string;
  run: boolean;
  allowDownloads: boolean;
  clock?: BenchmarkClock;
  runtimeProbe?: RuntimeProbe;
};

type CachePreflight = {
  candidate: EmbeddingCandidate;
  cachePath: string;
  cacheWasPresent: boolean;
};

const systemClock: BenchmarkClock = { nowMs: () => performance.now() };
const systemRuntimeProbe: RuntimeProbe = {
  environment: () => ({
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
  }),
  residentMemoryBytes: () => process.memoryUsage().rss,
  measurePeak: async (operation, sampleIntervalMs) => {
    let peakResidentMemoryBytes = process.memoryUsage().rss;
    const timer = setInterval(() => {
      peakResidentMemoryBytes = Math.max(
        peakResidentMemoryBytes,
        process.memoryUsage().rss
      );
    }, sampleIntervalMs);
    timer.unref();
    try {
      const result = await operation();
      peakResidentMemoryBytes = Math.max(
        peakResidentMemoryBytes,
        process.memoryUsage().rss
      );
      return { result, peakResidentMemoryBytes };
    } finally {
      clearInterval(timer);
    }
  },
};

/** Validates adapter output cardinality, dimensions, finiteness, and norm. */
function validateEmbeddingBatch(
  vectors: number[][],
  expectedCount: number,
  dimensions: number,
  label: string
): void {
  if (vectors.length !== expectedCount) {
    throw new Error(
      `${label} count mismatch: expected ${expectedCount}, received ${vectors.length}`
    );
  }
  vectors.forEach((vector, index) => {
    validateEmbeddingVector(vector, dimensions, `${label}[${index}]`);
  });
}

/** Compares an observed maximum against a finite upper budget. */
function upperBudget(budget: number, observed: number): BudgetObservation {
  return {
    budget,
    observed,
    status: observed <= budget ? "within" : "outside",
  };
}

/** Compares an observed minimum against a finite lower budget. */
function lowerBudget(budget: number, observed: number): BudgetObservation {
  return {
    budget,
    observed,
    status: observed >= budget ? "within" : "outside",
  };
}

/** Verifies adapter, runtime, and preprocessing identity before model loading. */
function validateAdapterIdentity(
  adapter: EmbeddingAdapter,
  candidate: EmbeddingCandidate
): void {
  const expected = {
    adapter: candidate.adapter,
    runtime: candidate.runtime,
    preprocessing: candidate.preprocessing,
  };
  if (!isDeepStrictEqual(adapter.identity, expected)) {
    throw new Error(`Adapter identity mismatch for ${candidate.key}`);
  }
}

/** Checks every configured cache without importing or constructing an adapter. */
async function preflightCandidateCaches(options: {
  configuration: CandidateConfiguration;
  workspaceRoot: string;
  cacheRootRelative: string;
  run: boolean;
  allowDownloads: boolean;
}): Promise<CachePreflight[]> {
  const configuration = validateCandidateConfiguration(options.configuration);
  const results: CachePreflight[] = [];
  for (const candidate of configuration.candidates) {
    const inspection = await inspectConfinedPath(
      options.workspaceRoot,
      options.cacheRootRelative,
      candidate.offlineCachePath
    );
    assertExecutionPolicy({
      run: options.run,
      allowDownloads: options.allowDownloads,
      cacheExists: inspection.exists,
    });
    if (inspection.exists) {
      if (inspection.kind !== "file" && inspection.kind !== "directory") {
        throw new Error(
          `Cache path has an unsupported type: ${inspection.path}`
        );
      }
      await verifyCacheArtifact(
        inspection.path,
        candidate.artifactChecksum,
        configuration.cacheLimits
      );
    }
    results.push({
      candidate,
      cachePath: inspection.path,
      cacheWasPresent: inspection.exists,
    });
  }
  return results;
}

/** Tracks peak RSS around one operation and preserves its return value. */
async function measureOperation<T>(
  runtimeProbe: RuntimeProbe,
  operation: () => Promise<T>,
  sampleIntervalMs: number,
  observedPeaks: number[]
): Promise<T> {
  const measurement = await runtimeProbe.measurePeak(
    operation,
    sampleIntervalMs
  );
  observedPeaks.push(measurement.peakResidentMemoryBytes);
  return measurement.result;
}

/** Benchmarks one pinned candidate without comparing or selecting it. */
async function benchmarkCandidate(
  options: BenchmarkRunOptions,
  preflight: CachePreflight,
  clock: BenchmarkClock,
  runtimeProbe: RuntimeProbe
): Promise<CandidateBenchmarkResult> {
  const { configuration, corpus, questionSet, adapterFactory } = options;
  const { candidate, cachePath, cacheWasPresent } = preflight;
  if (!cacheWasPresent) {
    await ensureConfinedDirectory(
      options.workspaceRoot,
      options.cacheRootRelative,
      candidate.offlineCachePath
    );
  }

  const memoryBefore = runtimeProbe.residentMemoryBytes();
  const observedPeaks = [memoryBefore];
  const sampleInterval = configuration.measurement.memorySampleIntervalMs;
  let adapter: EmbeddingAdapter | undefined;
  try {
    adapter = await measureOperation(
      runtimeProbe,
      () =>
        adapterFactory.create(candidate, {
          allowDownloads: options.allowDownloads,
          offlineCachePath: cachePath,
        }),
      sampleInterval,
      observedPeaks
    );
    validateAdapterIdentity(adapter, candidate);

    const loadStart = clock.nowMs();
    await measureOperation(
      runtimeProbe,
      () => adapter!.load(),
      sampleInterval,
      observedPeaks
    );
    const coldLoadMs = clock.nowMs() - loadStart;

    const cacheMetadata = await verifyCacheArtifact(
      cachePath,
      candidate.artifactChecksum,
      configuration.cacheLimits
    );

    // Query zero is measured once as the cold query and never reused in warm timing.
    const firstQuestion = questionSet.questions[0];
    const coldQueryStart = clock.nowMs();
    const coldQueryVectors = await measureOperation(
      runtimeProbe,
      () => adapter!.embed([firstQuestion.text], "query"),
      sampleInterval,
      observedPeaks
    );
    const coldQueryMs = clock.nowMs() - coldQueryStart;
    validateEmbeddingBatch(
      coldQueryVectors,
      1,
      candidate.dimensions,
      `${candidate.key} cold query embedding`
    );

    // Eager role-specific calls force lazy document/query initialization out of timings.
    await measureOperation(
      runtimeProbe,
      () => adapter!.embed([corpus.segments[0].text], "document"),
      sampleInterval,
      observedPeaks
    );
    await measureOperation(
      runtimeProbe,
      () => adapter!.embed([questionSet.questions[1].text], "query"),
      sampleInterval,
      observedPeaks
    );

    const ingestionStart = clock.nowMs();
    const segmentVectors = await measureOperation(
      runtimeProbe,
      () =>
        adapter!.embed(
          corpus.segments.map((segment) => segment.text),
          "document"
        ),
      sampleInterval,
      observedPeaks
    );
    const ingestionElapsedMs = clock.nowMs() - ingestionStart;
    validateEmbeddingBatch(
      segmentVectors,
      corpus.segments.length,
      candidate.dimensions,
      `${candidate.key} corpus embedding`
    );

    const vectorSegments = corpus.segments.map((segment, index) => ({
      id: segment.id,
      vector: segmentVectors[index],
    }));
    const rankings = new Map<string, string[]>([
      [firstQuestion.id, rankSegments(coldQueryVectors[0], vectorSegments)],
    ]);
    const warmLatencies: number[] = [];
    const warmQuestions = questionSet.questions.slice(1);
    for (
      let pass = 0;
      pass < configuration.measurement.warmQueryPasses;
      pass += 1
    ) {
      const offset = pass % warmQuestions.length;
      const orderedQuestions = [
        ...warmQuestions.slice(offset),
        ...warmQuestions.slice(0, offset),
      ];
      for (const question of orderedQuestions) {
        const queryStart = clock.nowMs();
        const queryVectors = await measureOperation(
          runtimeProbe,
          () => adapter!.embed([question.text], "query"),
          sampleInterval,
          observedPeaks
        );
        warmLatencies.push(clock.nowMs() - queryStart);
        validateEmbeddingBatch(
          queryVectors,
          1,
          candidate.dimensions,
          `${candidate.key} query ${question.id}`
        );
        if (!rankings.has(question.id)) {
          rankings.set(
            question.id,
            rankSegments(queryVectors[0], vectorSegments)
          );
        }
      }
    }

    const recall = calculateRecallMetrics(questionSet.questions, rankings);
    const warmQuery = summarizeLatencies(warmLatencies);
    const ingestionRate =
      ingestionElapsedMs === 0
        ? 0
        : corpus.segments.length / (ingestionElapsedMs / 1_000);
    const memoryAfter = runtimeProbe.residentMemoryBytes();
    const memoryPeak = Math.max(memoryAfter, ...observedPeaks);
    const memoryMeasurement =
      memoryAfter < memoryBefore ? "invalid-after-below-before" : "valid";
    const memoryPeakMb = (memoryPeak - memoryBefore) / (1024 * 1024);
    const languageMetrics = Object.fromEntries(
      corpus.multilingual.languages.map((language) => {
        const languageQuestions = questionSet.questions.filter(
          (question) => question.language === language
        );
        return [language, createRecallAggregate(languageQuestions, rankings)];
      })
    );
    const memoryBudget = upperBudget(
      configuration.budgets.maxResidentMemoryMb,
      memoryPeakMb
    );
    if (memoryMeasurement !== "valid") memoryBudget.status = "invalid";

    return {
      candidate,
      offlineCache: {
        status: "verified",
        bytes: cacheMetadata.bytes,
        checksum: cacheMetadata.checksum,
      },
      recall,
      latency: { coldLoadMs, coldQueryMs, warmQuery },
      ingestion: {
        segmentCount: corpus.segments.length,
        elapsedMs: ingestionElapsedMs,
        segmentsPerSecond: ingestionRate,
      },
      resources: {
        residentMemoryBeforeBytes: memoryBefore,
        residentMemoryPeakBytes: memoryPeak,
        residentMemoryAfterBytes: memoryAfter,
        residentMemoryMeasurement: memoryMeasurement,
        cacheBytes: cacheMetadata.bytes,
      },
      budgets: {
        coldLoadMs: upperBudget(
          configuration.budgets.maxColdLoadMs,
          coldLoadMs
        ),
        warmQueryP95Ms: upperBudget(
          configuration.budgets.maxWarmQueryP95Ms,
          warmQuery.p95Ms
        ),
        ingestionSegmentsPerSecond: lowerBudget(
          configuration.budgets.minIngestionSegmentsPerSecond,
          ingestionRate
        ),
        residentMemoryMb: memoryBudget,
        cacheBytes: upperBudget(
          configuration.budgets.maxCacheBytes,
          cacheMetadata.bytes
        ),
      },
      multilingual: {
        required: corpus.multilingual.required,
        languages: languageMetrics,
      },
    };
  } finally {
    await adapter?.close?.();
  }
}

/** Runs all candidates in declared order and deliberately emits no winner. */
async function runBenchmark(
  options: BenchmarkRunOptions
): Promise<BenchmarkReport> {
  const configuration = validateCandidateConfiguration(options.configuration);
  const fixtures = validateBenchmarkFixtures(
    options.corpus,
    options.questionSet
  );
  const normalizedOptions = {
    ...options,
    configuration,
    corpus: fixtures.corpus,
    questionSet: fixtures.questionSet,
  };
  const clock = options.clock ?? systemClock;
  const runtimeProbe = options.runtimeProbe ?? systemRuntimeProbe;
  const preflights = await preflightCandidateCaches(normalizedOptions);
  const results: CandidateBenchmarkResult[] = [];
  for (const preflight of preflights) {
    results.push(
      await benchmarkCandidate(
        normalizedOptions,
        preflight,
        clock,
        runtimeProbe
      )
    );
  }
  return {
    schemaVersion: 1,
    decision: "not-selected",
    environment: runtimeProbe.environment(),
    fixtureVersions: { candidates: 1, corpus: 1, questions: 1 },
    budgets: configuration.budgets,
    cacheLimits: configuration.cacheLimits,
    measurement: configuration.measurement,
    baselines: {
      randomExpected: calculateRandomExpectedRecall(
        fixtures.corpus.segments.length
      ),
      lexical: calculateLexicalBaseline(
        fixtures.questionSet.questions,
        fixtures.corpus.segments
      ),
    },
    results,
  };
}

export {
  type BenchmarkRunOptions,
  preflightCandidateCaches,
  runBenchmark,
  validateAdapterIdentity,
  validateEmbeddingBatch,
};
