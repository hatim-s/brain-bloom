import os from "node:os";
import { isDeepStrictEqual } from "node:util";

import { verifyCacheArtifact } from "./cache.ts";
import { evaluateIntegrity } from "./integrity.ts";
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
  VerifiedAdapterArtifact,
} from "./types.ts";
import {
  validateBenchmarkFixtures,
  validateCandidateConfiguration,
  validateEmbeddingVector,
} from "./validation.ts";

type CandidateMemoryMode = "isolated" | "in-process-test";

type SingleCandidateRunOptions = {
  configuration: CandidateConfiguration;
  corpus: BenchmarkCorpus;
  questionSet: BenchmarkQuestionSet;
  candidateKey: string;
  verifiedAdapter: VerifiedAdapterArtifact;
  adapterFactory: EmbeddingAdapterFactory;
  workspaceRoot: string;
  cacheRootRelative: string;
  run: boolean;
  allowDownloads: boolean;
  memoryMode: CandidateMemoryMode;
  clock?: BenchmarkClock;
  runtimeProbe?: RuntimeProbe;
};

type IsolatedBenchmarkRunOptions = Omit<
  SingleCandidateRunOptions,
  | "candidateKey"
  | "verifiedAdapter"
  | "adapterFactory"
  | "memoryMode"
  | "clock"
  | "runtimeProbe"
> & {
  verifiedAdapters: VerifiedAdapterArtifact[];
  executeCandidate: CandidateProcessExecutor;
  environment?: ReturnType<RuntimeProbe["environment"]>;
};

type CandidateProcessRequest = Omit<
  SingleCandidateRunOptions,
  "adapterFactory" | "memoryMode" | "clock" | "runtimeProbe"
> & { absoluteModulePath: string; adapterRootRelative: string };

type CandidateProcessExecutor = (
  request: CandidateProcessRequest
) => Promise<CandidateBenchmarkResult>;

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
    cpuCount: Math.max(1, os.cpus().length),
  }),
  residentMemoryBytes: () => process.memoryUsage().rss,
  // Node reports maxRSS in KiB on supported Unix platforms.
  peakResidentMemoryBytes: () => process.resourceUsage().maxRSS * 1024,
};

/** Validates adapter output cardinality, dimensions, finiteness, and norm. */
function validateEmbeddingBatch(
  vectors: number[][],
  expectedCount: number,
  dimensions: number,
  label: string
): void {
  if (vectors.length !== expectedCount)
    throw new Error(
      `${label} count mismatch: expected ${expectedCount}, received ${vectors.length}`
    );
  vectors.forEach((vector, index) =>
    validateEmbeddingVector(vector, dimensions, `${label}[${index}]`)
  );
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

/** Marks smoke-only observations as unusable for model-selection budgets. */
function invalidateSelectionBudget(
  observation: BudgetObservation
): BudgetObservation {
  return { ...observation, status: "invalid" };
}

/** Confirms runtime claims agree with the already verified adapter manifest. */
function validateAdapterIdentity(
  adapter: EmbeddingAdapter,
  verified: VerifiedAdapterArtifact
): void {
  const expected = {
    adapter: verified.adapter,
    runtime: verified.runtime,
    preprocessing: verified.preprocessing,
  };
  if (!isDeepStrictEqual(adapter.identity, expected))
    throw new Error(
      "Loaded adapter identity does not match its verified manifest"
    );
}

/** Checks configured caches without importing or constructing an adapter. */
async function preflightCandidateCaches(options: {
  configuration: CandidateConfiguration;
  workspaceRoot: string;
  cacheRootRelative: string;
  run: boolean;
  allowDownloads: boolean;
  candidateKeys?: string[];
}): Promise<CachePreflight[]> {
  const configuration = validateCandidateConfiguration(options.configuration);
  const selected = options.candidateKeys
    ? new Set(options.candidateKeys)
    : undefined;
  const results: CachePreflight[] = [];
  for (const candidate of configuration.candidates) {
    if (selected && !selected.has(candidate.key)) continue;
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
      if (inspection.kind !== "file" && inspection.kind !== "directory")
        throw new Error(
          `Cache path has an unsupported type: ${inspection.path}`
        );
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
  if (selected && results.length !== selected.size)
    throw new Error("Unknown candidate requested for cache preflight");
  return results;
}

/** Benchmarks one candidate; production callers must run this in a fresh child. */
async function runSingleCandidate(
  options: SingleCandidateRunOptions
): Promise<CandidateBenchmarkResult> {
  const configuration = validateCandidateConfiguration(options.configuration);
  const fixtures = validateBenchmarkFixtures(
    options.corpus,
    options.questionSet
  );
  const candidate = configuration.candidates.find(
    (entry) => entry.key === options.candidateKey
  );
  if (!candidate) throw new Error(`Unknown candidate: ${options.candidateKey}`);
  const preflight = (
    await preflightCandidateCaches({
      ...options,
      configuration,
      candidateKeys: [candidate.key],
    })
  )[0];
  if (!preflight.cacheWasPresent)
    await ensureConfinedDirectory(
      options.workspaceRoot,
      options.cacheRootRelative,
      candidate.offlineCachePath
    );
  const clock = options.clock ?? systemClock;
  const runtimeProbe = options.runtimeProbe ?? systemRuntimeProbe;
  const memoryBefore = runtimeProbe.residentMemoryBytes();
  let adapter: EmbeddingAdapter | undefined;
  try {
    // Start before factory creation: adapters may allocate/load lazily in create().
    const coldLoadStart = clock.nowMs();
    adapter = await options.adapterFactory.create(candidate, {
      allowDownloads: options.allowDownloads,
      offlineCachePath: preflight.cachePath,
    });
    validateAdapterIdentity(adapter, options.verifiedAdapter);
    await adapter.load();

    const firstQuestion = fixtures.questionSet.questions[0];
    const coldQueryStart = clock.nowMs();
    const coldQueryVectors = await adapter.embed([firstQuestion.text], "query");
    const coldQueryMs = clock.nowMs() - coldQueryStart;
    validateEmbeddingBatch(
      coldQueryVectors,
      1,
      candidate.dimensions,
      `${candidate.key} cold query embedding`
    );
    // Force both preprocessing roles before ending the cold-load/preflight phase.
    const eagerDocument = await adapter.embed(
      [fixtures.corpus.segments[0].text],
      "document"
    );
    const eagerQuery = await adapter.embed(
      [fixtures.questionSet.questions[1].text],
      "query"
    );
    validateEmbeddingBatch(
      eagerDocument,
      1,
      candidate.dimensions,
      `${candidate.key} document preflight`
    );
    validateEmbeddingBatch(
      eagerQuery,
      1,
      candidate.dimensions,
      `${candidate.key} query preflight`
    );
    const coldLoadMs = clock.nowMs() - coldLoadStart;

    const cacheMetadata = await verifyCacheArtifact(
      preflight.cachePath,
      candidate.artifactChecksum,
      configuration.cacheLimits
    );
    const ingestionStart = clock.nowMs();
    const segmentVectors = await adapter.embed(
      fixtures.corpus.segments.map((segment) => segment.text),
      "document"
    );
    const ingestionElapsedMs = clock.nowMs() - ingestionStart;
    validateEmbeddingBatch(
      segmentVectors,
      fixtures.corpus.segments.length,
      candidate.dimensions,
      `${candidate.key} corpus embedding`
    );
    const vectorSegments = fixtures.corpus.segments.map((segment, index) => ({
      id: segment.id,
      vector: segmentVectors[index],
    }));
    const segmentVectorMap = new Map(
      vectorSegments.map((entry) => [entry.id, entry.vector] as const)
    );
    const rankings = new Map<string, string[]>([
      [firstQuestion.id, rankSegments(coldQueryVectors[0], vectorSegments)],
    ]);
    const warmLatencies: number[] = [];
    const warmQuestions = fixtures.questionSet.questions.slice(1);
    for (
      let pass = 0;
      pass < configuration.measurement.warmQueryPasses;
      pass += 1
    ) {
      const offset = pass % warmQuestions.length;
      const ordered = [
        ...warmQuestions.slice(offset),
        ...warmQuestions.slice(0, offset),
      ];
      for (const question of ordered) {
        const start = clock.nowMs();
        const vectors = await adapter.embed([question.text], "query");
        warmLatencies.push(clock.nowMs() - start);
        validateEmbeddingBatch(
          vectors,
          1,
          candidate.dimensions,
          `${candidate.key} query ${question.id}`
        );
        if (!rankings.has(question.id))
          rankings.set(question.id, rankSegments(vectors[0], vectorSegments));
      }
    }
    const integrityVectors = await adapter.embed(
      fixtures.questionSet.integrityQuestions.map((question) => question.text),
      "query"
    );
    validateEmbeddingBatch(
      integrityVectors,
      fixtures.questionSet.integrityQuestions.length,
      candidate.dimensions,
      `${candidate.key} integrity query`
    );
    const integrity = evaluateIntegrity({
      corpus: fixtures.corpus,
      questions: fixtures.questionSet.integrityQuestions,
      queryVectors: new Map(
        fixtures.questionSet.integrityQuestions.map(
          (question, index) => [question.id, integrityVectors[index]] as const
        )
      ),
      segmentVectors: segmentVectorMap,
    });
    if (!integrity.passed)
      throw new Error(`Integrity gate failed for ${candidate.key}`);

    const recall = calculateRecallMetrics(
      fixtures.questionSet.questions,
      rankings
    );
    const warmQuery = summarizeLatencies(warmLatencies);
    const ingestionRate =
      ingestionElapsedMs === 0
        ? 0
        : fixtures.corpus.segments.length / (ingestionElapsedMs / 1_000);
    const memoryAfter = runtimeProbe.residentMemoryBytes();
    const memoryPeak = Math.max(
      memoryBefore,
      memoryAfter,
      runtimeProbe.peakResidentMemoryBytes()
    );
    const memoryStatus =
      options.memoryMode === "isolated"
        ? "valid-isolated-process"
        : "invalid-in-process-test";
    const memoryPeakMiB = memoryPeak / (1024 * 1024);
    const memoryBudget = upperBudget(
      configuration.budgets.maxResidentMemoryMb,
      memoryPeakMiB
    );
    memoryBudget.status = "invalid";
    const languages = Object.fromEntries(
      fixtures.corpus.multilingual.languages.map((language) => [
        language,
        createRecallAggregate(
          fixtures.questionSet.questions.filter(
            (question) => question.language === language
          ),
          rankings
        ),
      ])
    );
    return {
      candidate,
      verifiedAdapter: options.verifiedAdapter,
      executionEvidence: options.verifiedAdapter.bundle.executionEvidence,
      offlineCache: {
        status: "verified",
        bytes: cacheMetadata.bytes,
        checksum: cacheMetadata.checksum,
      },
      recall,
      integrity,
      latency: { coldLoadMs, coldQueryMs, warmQuery },
      ingestion: {
        segmentCount: fixtures.corpus.segments.length,
        elapsedMs: ingestionElapsedMs,
        segmentsPerSecond: ingestionRate,
      },
      resources: {
        residentMemoryBeforeBytes: memoryBefore,
        residentMemoryPeakBytes: memoryPeak,
        residentMemoryAfterBytes: memoryAfter,
        residentMemoryMeasurement: memoryStatus,
        cacheBytes: cacheMetadata.bytes,
      },
      budgets: {
        coldLoadMs: invalidateSelectionBudget(
          upperBudget(configuration.budgets.maxColdLoadMs, coldLoadMs)
        ),
        warmQueryP95Ms: invalidateSelectionBudget(
          upperBudget(configuration.budgets.maxWarmQueryP95Ms, warmQuery.p95Ms)
        ),
        ingestionSegmentsPerSecond: invalidateSelectionBudget(
          lowerBudget(
            configuration.budgets.minIngestionSegmentsPerSecond,
            ingestionRate
          )
        ),
        residentMemoryMb: memoryBudget,
        cacheBytes: invalidateSelectionBudget(
          upperBudget(configuration.budgets.maxCacheBytes, cacheMetadata.bytes)
        ),
      },
      multilingual: {
        required: fixtures.corpus.multilingual.required,
        languages,
      },
    };
  } finally {
    await adapter?.close?.();
  }
}

/** Builds a comparison report from independently measured candidate results. */
function buildReport(options: {
  configuration: CandidateConfiguration;
  corpus: BenchmarkCorpus;
  questionSet: BenchmarkQuestionSet;
  results: CandidateBenchmarkResult[];
  environment: ReturnType<RuntimeProbe["environment"]>;
}): BenchmarkReport {
  return {
    schemaVersion: 1,
    decision: "not-selected",
    executionEvidence:
      options.configuration.candidates[0].adapter.bundle.executionEvidence,
    environment: options.environment,
    fixtureVersions: { candidates: 1, corpus: 1, questions: 1 },
    budgets: options.configuration.budgets,
    cacheLimits: options.configuration.cacheLimits,
    adapterLimits: options.configuration.adapterLimits,
    measurement: {
      ...options.configuration.measurement,
      isolation: "fresh-child-process-per-candidate",
      memoryMetric: "process-high-water-rss",
    },
    baselines: {
      randomExpected: calculateRandomExpectedRecall(
        options.corpus.segments.length
      ),
      lexical: calculateLexicalBaseline(
        options.questionSet.questions,
        options.corpus.segments
      ),
    },
    results: options.results,
  };
}

/** Runs candidates in declared order through a fresh-process executor. */
async function runBenchmarkIsolated(
  options: IsolatedBenchmarkRunOptions & {
    absoluteModulePaths: string[];
    adapterRootRelative: string;
  }
): Promise<BenchmarkReport> {
  const configuration = validateCandidateConfiguration(options.configuration);
  const fixtures = validateBenchmarkFixtures(
    options.corpus,
    options.questionSet
  );
  if (
    options.verifiedAdapters.length !== configuration.candidates.length ||
    options.absoluteModulePaths.length !== configuration.candidates.length
  )
    throw new Error("Every candidate requires one verified adapter artifact");
  const results: CandidateBenchmarkResult[] = [];
  for (let index = 0; index < configuration.candidates.length; index += 1) {
    const candidate = configuration.candidates[index];
    results.push(
      await options.executeCandidate({
        configuration,
        corpus: fixtures.corpus,
        questionSet: fixtures.questionSet,
        candidateKey: candidate.key,
        verifiedAdapter: options.verifiedAdapters[index],
        absoluteModulePath: options.absoluteModulePaths[index],
        adapterRootRelative: options.adapterRootRelative,
        workspaceRoot: options.workspaceRoot,
        cacheRootRelative: options.cacheRootRelative,
        run: options.run,
        allowDownloads: options.allowDownloads,
      })
    );
  }
  return buildReport({
    configuration,
    corpus: fixtures.corpus,
    questionSet: fixtures.questionSet,
    results,
    environment: options.environment ?? systemRuntimeProbe.environment(),
  });
}

export {
  buildReport,
  type CandidateProcessExecutor,
  type CandidateProcessRequest,
  type IsolatedBenchmarkRunOptions,
  preflightCandidateCaches,
  runBenchmarkIsolated,
  runSingleCandidate,
  type SingleCandidateRunOptions,
  systemRuntimeProbe,
  validateAdapterIdentity,
  validateEmbeddingBatch,
};
