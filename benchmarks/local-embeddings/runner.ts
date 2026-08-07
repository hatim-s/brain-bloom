import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { verifyCacheArtifact } from "./cache.ts";
import {
  calculateRecallMetrics,
  rankSegments,
  recallAtDepth,
  summarizeLatencies,
} from "./metrics.ts";
import { assertExecutionPolicy } from "./policy.ts";
import type {
  BenchmarkClock,
  BenchmarkCorpus,
  BenchmarkEnvironment,
  BenchmarkQuestionSet,
  BenchmarkReport,
  BudgetObservation,
  CandidateBenchmarkResult,
  CandidateConfiguration,
  EmbeddingAdapter,
  EmbeddingAdapterFactory,
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
  cacheRoot: string;
  run: boolean;
  allowDownloads: boolean;
  clock?: BenchmarkClock;
  runtimeProbe?: RuntimeProbe;
};

const systemClock: BenchmarkClock = { nowMs: () => performance.now() };
const systemRuntimeProbe: RuntimeProbe = {
  environment: (): BenchmarkEnvironment => ({
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
  }),
  residentMemoryBytes: () => process.memoryUsage().rss,
};

/** Returns whether the declared cache path currently exists. */
async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

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

/** Ensures adapter cleanup runs even when a candidate is rejected. */
async function closeAdapter(
  adapter: EmbeddingAdapter | undefined
): Promise<void> {
  await adapter?.close?.();
}

/** Benchmarks one pinned candidate without comparing or selecting it. */
async function benchmarkCandidate(
  options: BenchmarkRunOptions,
  candidateIndex: number,
  clock: BenchmarkClock,
  runtimeProbe: RuntimeProbe
): Promise<CandidateBenchmarkResult> {
  const { configuration, corpus, questionSet, adapterFactory } = options;
  const candidate = configuration.candidates[candidateIndex];
  const cachePath = path.resolve(options.cacheRoot, candidate.offlineCachePath);
  const cacheWasPresent = await pathExists(cachePath);
  assertExecutionPolicy({
    run: options.run,
    allowDownloads: options.allowDownloads,
    cacheExists: cacheWasPresent,
  });

  if (cacheWasPresent) {
    await verifyCacheArtifact(cachePath, candidate.artifactChecksum);
  }

  const memoryBefore = runtimeProbe.residentMemoryBytes();
  const loadStart = clock.nowMs();
  let adapter: EmbeddingAdapter | undefined;
  try {
    adapter = await adapterFactory.create(candidate, {
      allowDownloads: options.allowDownloads,
      offlineCachePath: cachePath,
    });
    const coldLoadMs = clock.nowMs() - loadStart;

    // A permitted adapter may populate a missing cache; verify it before use.
    const cacheMetadata = await verifyCacheArtifact(
      cachePath,
      candidate.artifactChecksum
    );
    const ingestionStart = clock.nowMs();
    const segmentVectors = await adapter.embed(
      corpus.segments.map((segment) => segment.text)
    );
    const ingestionElapsedMs = clock.nowMs() - ingestionStart;
    validateEmbeddingBatch(
      segmentVectors,
      corpus.segments.length,
      candidate.dimensions,
      `${candidate.key} corpus embedding`
    );

    const firstQuestion = questionSet.questions[0];
    const coldQueryStart = clock.nowMs();
    const coldQueryVectors = await adapter.embed([firstQuestion.text]);
    const coldQueryMs = clock.nowMs() - coldQueryStart;
    validateEmbeddingBatch(
      coldQueryVectors,
      1,
      candidate.dimensions,
      `${candidate.key} cold query embedding`
    );

    const rankings = new Map<string, string[]>();
    const warmLatencies: number[] = [];
    for (const question of questionSet.questions) {
      const queryStart = clock.nowMs();
      const queryVectors = await adapter.embed([question.text]);
      warmLatencies.push(clock.nowMs() - queryStart);
      validateEmbeddingBatch(
        queryVectors,
        1,
        candidate.dimensions,
        `${candidate.key} query ${question.id}`
      );
      rankings.set(
        question.id,
        rankSegments(
          queryVectors[0],
          corpus.segments.map((segment, index) => ({
            id: segment.id,
            vector: segmentVectors[index],
          }))
        )
      );
    }

    const recall = calculateRecallMetrics(questionSet.questions, rankings);
    const warmQuery = summarizeLatencies(warmLatencies);
    const ingestionRate =
      ingestionElapsedMs === 0
        ? Number.POSITIVE_INFINITY
        : corpus.segments.length / (ingestionElapsedMs / 1_000);
    const memoryAfter = runtimeProbe.residentMemoryBytes();
    const memoryDelta = Math.max(0, memoryAfter - memoryBefore);
    const memoryMb = memoryDelta / (1024 * 1024);
    const languageMetrics = Object.fromEntries(
      corpus.multilingual.languages.map((language) => {
        const languageQuestions = questionSet.questions.filter(
          (question) => question.language === language
        );
        const recallForDepth = (depth: 5 | 10 | 20) => {
          if (languageQuestions.length === 0) return 0;
          return (
            languageQuestions.reduce((sum, question) => {
              const ranking = rankings.get(question.id) ?? [];
              return (
                sum + recallAtDepth(question.relevantSegmentIds, ranking, depth)
              );
            }, 0) / languageQuestions.length
          );
        };
        return [
          language,
          {
            "5": recallForDepth(5),
            "10": recallForDepth(10),
            "20": recallForDepth(20),
          },
        ];
      })
    );

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
        residentMemoryAfterBytes: memoryAfter,
        residentMemoryDeltaBytes: memoryDelta,
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
        residentMemoryMb: upperBudget(
          configuration.budgets.maxResidentMemoryMb,
          memoryMb
        ),
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
    await closeAdapter(adapter);
  }
}

/** Runs all candidates in declared order and deliberately emits no winner. */
async function runBenchmark(
  options: BenchmarkRunOptions
): Promise<BenchmarkReport> {
  validateCandidateConfiguration(options.configuration);
  validateBenchmarkFixtures(options.corpus, options.questionSet);
  const clock = options.clock ?? systemClock;
  const runtimeProbe = options.runtimeProbe ?? systemRuntimeProbe;
  const results: CandidateBenchmarkResult[] = [];
  for (
    let index = 0;
    index < options.configuration.candidates.length;
    index += 1
  ) {
    results.push(await benchmarkCandidate(options, index, clock, runtimeProbe));
  }

  return {
    schemaVersion: 1,
    decision: "not-selected",
    environment: runtimeProbe.environment(),
    fixtureVersions: { candidates: 1, corpus: 1, questions: 1 },
    budgets: options.configuration.budgets,
    results,
  };
}

export { type BenchmarkRunOptions, runBenchmark, validateEmbeddingBatch };
