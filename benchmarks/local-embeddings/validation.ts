import { z } from "zod";

import { validateRelativePath } from "./paths.ts";
import type {
  BenchmarkCorpus,
  BenchmarkQuestionSet,
  BenchmarkReport,
  CandidateConfiguration,
  EmbeddingCandidate,
} from "./types.ts";

const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const revisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const nonEmptyString = z.string().trim().min(1);
const versionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
const languageSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
const nonNegativeFinite = z.number().nonnegative().finite();
const positiveFinite = z.number().positive().finite();
const recallDepthSchema = z.strictObject({
  "5": z.number().min(0).max(1),
  "10": z.number().min(0).max(1),
  "20": z.number().min(0).max(1),
});

/** Converts path-refinement exceptions into a strict schema predicate. */
function isSafeRelativePath(value: string): boolean {
  try {
    validateRelativePath(value, "offlineCachePath");
    return true;
  } catch {
    return false;
  }
}

const adapterIdentitySchema = z.strictObject({
  id: nonEmptyString,
  version: versionSchema,
  revision: revisionSchema,
  artifactChecksum: checksumSchema,
});
const runtimeIdentitySchema = z.strictObject({
  id: nonEmptyString,
  version: versionSchema,
});
const preprocessingIdentitySchema = z.strictObject({
  id: nonEmptyString,
  version: versionSchema,
  pooling: z.enum(["mean", "cls", "last-token"]),
  normalize: z.boolean(),
  queryPrefix: z.string(),
  documentPrefix: z.string(),
});
const candidateSchema = z.strictObject({
  key: nonEmptyString,
  modelId: nonEmptyString,
  revision: revisionSchema,
  dimensions: z.number().int().positive().max(65_536),
  artifactChecksum: checksumSchema,
  offlineCachePath: nonEmptyString.refine(isSafeRelativePath, {
    message:
      "offlineCachePath must remain relative to the dedicated cache root",
  }),
  adapter: adapterIdentitySchema,
  runtime: runtimeIdentitySchema,
  preprocessing: preprocessingIdentitySchema,
});
const budgetsSchema = z.strictObject({
  maxColdLoadMs: positiveFinite,
  maxWarmQueryP95Ms: positiveFinite,
  minIngestionSegmentsPerSecond: positiveFinite,
  maxResidentMemoryMb: positiveFinite,
  maxCacheBytes: z.number().int().positive(),
});
const cacheLimitsSchema = z.strictObject({
  maxBytes: z.number().int().positive(),
  maxFiles: z.number().int().positive().max(100_000),
  maxDepth: z.number().int().nonnegative().max(64),
});
const candidateConfigurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  budgets: budgetsSchema,
  cacheLimits: cacheLimitsSchema,
  measurement: z.strictObject({
    warmQueryPasses: z.number().int().min(2).max(20),
    memorySampleIntervalMs: z.number().int().positive().max(1_000),
  }),
  candidates: z.array(candidateSchema).min(2),
});

const segmentSchema = z.strictObject({
  id: nonEmptyString,
  sourceId: nonEmptyString,
  format: z.enum(["pdf", "docx", "pptx"]),
  locator: nonEmptyString,
  text: nonEmptyString,
  language: languageSchema,
});
const corpusSchema = z.strictObject({
  schemaVersion: z.literal(1),
  multilingual: z.strictObject({
    required: z.boolean(),
    languages: z.array(languageSchema).min(1),
  }),
  // Sixty candidates keep R@20 at or below a one-third random expectation.
  segments: z.array(segmentSchema).min(60),
});
const questionSchema = z.strictObject({
  id: nonEmptyString,
  text: nonEmptyString,
  category: z.enum(["headings", "definitions", "slide-bullets", "paraphrases"]),
  language: languageSchema,
  relevantSegmentIds: z.array(nonEmptyString).min(1),
});
const questionSetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  questions: z.array(questionSchema).min(30),
});

const recallAggregateSchema = z.strictObject({
  questionCount: z.number().int().positive(),
  relevantSegmentCount: z.number().int().positive(),
  recall: recallDepthSchema,
});
const recallMetricsSchema = z.strictObject({
  overall: recallAggregateSchema,
  byCategory: z.strictObject({
    headings: recallAggregateSchema,
    definitions: recallAggregateSchema,
    "slide-bullets": recallAggregateSchema,
    paraphrases: recallAggregateSchema,
  }),
});
const latencySummarySchema = z.strictObject({
  samples: z.number().int().positive(),
  minMs: nonNegativeFinite,
  medianMs: nonNegativeFinite,
  p95Ms: nonNegativeFinite,
  maxMs: nonNegativeFinite,
});
const budgetObservationSchema = z.strictObject({
  budget: positiveFinite,
  observed: nonNegativeFinite,
  status: z.enum(["within", "outside", "invalid"]),
});
const candidateResultSchema = z.strictObject({
  candidate: candidateSchema,
  offlineCache: z.strictObject({
    status: z.literal("verified"),
    bytes: z.number().int().nonnegative(),
    checksum: checksumSchema,
  }),
  recall: recallMetricsSchema,
  latency: z.strictObject({
    coldLoadMs: nonNegativeFinite,
    coldQueryMs: nonNegativeFinite,
    warmQuery: latencySummarySchema,
  }),
  ingestion: z.strictObject({
    segmentCount: z.number().int().positive(),
    elapsedMs: nonNegativeFinite,
    segmentsPerSecond: nonNegativeFinite,
  }),
  resources: z.strictObject({
    residentMemoryBeforeBytes: z.number().int().nonnegative(),
    residentMemoryPeakBytes: z.number().int().nonnegative(),
    residentMemoryAfterBytes: z.number().int().nonnegative(),
    residentMemoryMeasurement: z.enum(["valid", "invalid-after-below-before"]),
    cacheBytes: z.number().int().nonnegative(),
  }),
  budgets: z.strictObject({
    coldLoadMs: budgetObservationSchema,
    warmQueryP95Ms: budgetObservationSchema,
    ingestionSegmentsPerSecond: budgetObservationSchema,
    residentMemoryMb: budgetObservationSchema,
    cacheBytes: budgetObservationSchema,
  }),
  multilingual: z.strictObject({
    required: z.boolean(),
    languages: z.record(languageSchema, recallAggregateSchema),
  }),
});
const benchmarkReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  decision: z.literal("not-selected"),
  environment: z.strictObject({
    platform: nonEmptyString,
    architecture: nonEmptyString,
    nodeVersion: nonEmptyString,
    cpuModel: nonEmptyString,
    cpuCount: z.number().int().positive(),
  }),
  fixtureVersions: z.strictObject({
    candidates: z.literal(1),
    corpus: z.literal(1),
    questions: z.literal(1),
  }),
  budgets: budgetsSchema,
  cacheLimits: cacheLimitsSchema,
  measurement: z.strictObject({
    warmQueryPasses: z.number().int().min(2).max(20),
    memorySampleIntervalMs: z.number().int().positive().max(1_000),
  }),
  baselines: z.strictObject({
    randomExpected: recallDepthSchema,
    lexical: recallMetricsSchema,
  }),
  results: z.array(candidateResultSchema).min(2),
});

/** Parses and validates every candidate configuration field at runtime. */
function validateCandidateConfiguration(
  input: unknown
): CandidateConfiguration {
  const configuration = candidateConfigurationSchema.parse(input);
  const keys = new Set<string>();
  for (const candidate of configuration.candidates) {
    if (keys.has(candidate.key))
      throw new Error(`Duplicate candidate key: ${candidate.key}`);
    keys.add(candidate.key);
  }
  if (
    configuration.cacheLimits.maxBytes > configuration.budgets.maxCacheBytes
  ) {
    throw new Error("cacheLimits.maxBytes cannot exceed budgets.maxCacheBytes");
  }
  return configuration;
}

/** Parses one candidate for focused unit validation. */
function validateCandidate(input: unknown): EmbeddingCandidate {
  return candidateSchema.parse(input);
}

/** Fully parses fixtures and enforces cross-file IDs, languages, and aggregates. */
function validateBenchmarkFixtures(
  corpusInput: unknown,
  questionSetInput: unknown
): { corpus: BenchmarkCorpus; questionSet: BenchmarkQuestionSet } {
  const corpus = corpusSchema.parse(corpusInput);
  const questionSet = questionSetSchema.parse(questionSetInput);
  const declaredLanguages = new Set(corpus.multilingual.languages);
  if (declaredLanguages.size !== corpus.multilingual.languages.length) {
    throw new Error("Corpus languages must be unique");
  }

  const segmentsById = new Map<string, (typeof corpus.segments)[number]>();
  const formats = new Set<string>();
  const segmentLanguages = new Set<string>();
  for (const segment of corpus.segments) {
    if (segmentsById.has(segment.id))
      throw new Error(`Duplicate segment id: ${segment.id}`);
    if (!declaredLanguages.has(segment.language)) {
      throw new Error(
        `Segment ${segment.id} uses undeclared language ${segment.language}`
      );
    }
    segmentsById.set(segment.id, segment);
    formats.add(segment.format);
    segmentLanguages.add(segment.language);
  }
  for (const format of ["pdf", "docx", "pptx"]) {
    if (!formats.has(format))
      throw new Error(
        `Corpus must include ${format.toUpperCase()}-like segments`
      );
  }

  const questionIds = new Set<string>();
  const categories = new Set<string>();
  const questionLanguages = new Set<string>();
  for (const question of questionSet.questions) {
    if (questionIds.has(question.id))
      throw new Error(`Duplicate question id: ${question.id}`);
    if (!declaredLanguages.has(question.language)) {
      throw new Error(
        `Question ${question.id} uses undeclared language ${question.language}`
      );
    }
    if (
      new Set(question.relevantSegmentIds).size !==
      question.relevantSegmentIds.length
    ) {
      throw new Error(`Question ${question.id} repeats a relevant segment id`);
    }
    for (const segmentId of question.relevantSegmentIds) {
      const segment = segmentsById.get(segmentId);
      if (!segment)
        throw new Error(
          `Question ${question.id} references missing ${segmentId}`
        );
      if (segment.language !== question.language) {
        throw new Error(
          `Question ${question.id} language does not match ${segmentId}`
        );
      }
    }
    questionIds.add(question.id);
    categories.add(question.category);
    questionLanguages.add(question.language);
  }

  for (const category of [
    "headings",
    "definitions",
    "slide-bullets",
    "paraphrases",
  ]) {
    if (!categories.has(category))
      throw new Error(`Questions must cover category ${category}`);
  }
  for (const language of Array.from(declaredLanguages)) {
    if (!segmentLanguages.has(language) || !questionLanguages.has(language)) {
      throw new Error(
        `Declared language ${language} requires segments and questions`
      );
    }
  }
  if (corpus.multilingual.required && declaredLanguages.size < 2) {
    throw new Error("Multilingual corpus must declare at least two languages");
  }
  return { corpus, questionSet };
}

/** Validates complete result enums and numeric limits before serialization. */
function validateBenchmarkReport(input: unknown): BenchmarkReport {
  const report = benchmarkReportSchema.parse(input);
  if (report.cacheLimits.maxBytes > report.budgets.maxCacheBytes) {
    throw new Error("Report cache limits exceed the recorded cache budget");
  }
  const validateAggregate = (
    aggregate: (typeof report.results)[number]["recall"]["overall"],
    label: string
  ) => {
    if (
      aggregate.recall["5"] > aggregate.recall["10"] ||
      aggregate.recall["10"] > aggregate.recall["20"]
    ) {
      throw new Error(`${label} recall must be monotonic by retrieval depth`);
    }
  };

  validateAggregate(report.baselines.lexical.overall, "Lexical overall");
  const lexicalCategories = Object.values(report.baselines.lexical.byCategory);
  lexicalCategories.forEach((aggregate, index) =>
    validateAggregate(aggregate, `Lexical category ${index}`)
  );
  if (
    lexicalCategories.reduce(
      (sum, aggregate) => sum + aggregate.questionCount,
      0
    ) !== report.baselines.lexical.overall.questionCount ||
    lexicalCategories.reduce(
      (sum, aggregate) => sum + aggregate.relevantSegmentCount,
      0
    ) !== report.baselines.lexical.overall.relevantSegmentCount
  ) {
    throw new Error("Lexical category aggregates are incomplete");
  }
  if (
    report.baselines.randomExpected["5"] >
      report.baselines.randomExpected["10"] ||
    report.baselines.randomExpected["10"] >
      report.baselines.randomExpected["20"]
  ) {
    throw new Error("Random expected recall must be monotonic");
  }
  const baselineQuestionCount = report.baselines.lexical.overall.questionCount;
  let expectedLanguageKeys: string[] | undefined;
  const candidateKeys = new Set<string>();
  for (const result of report.results) {
    if (candidateKeys.has(result.candidate.key)) {
      throw new Error(`Duplicate report candidate ${result.candidate.key}`);
    }
    candidateKeys.add(result.candidate.key);
    if (
      result.resources.residentMemoryPeakBytes <
        result.resources.residentMemoryBeforeBytes ||
      result.resources.residentMemoryPeakBytes <
        result.resources.residentMemoryAfterBytes
    ) {
      throw new Error(`${result.candidate.key} peak RSS is incomplete`);
    }
    const expectedMemoryState =
      result.resources.residentMemoryAfterBytes <
      result.resources.residentMemoryBeforeBytes
        ? "invalid-after-below-before"
        : "valid";
    if (result.resources.residentMemoryMeasurement !== expectedMemoryState) {
      throw new Error(`${result.candidate.key} RSS validity is inconsistent`);
    }
    if (
      (expectedMemoryState === "valid" &&
        result.budgets.residentMemoryMb.status === "invalid") ||
      (expectedMemoryState !== "valid" &&
        result.budgets.residentMemoryMb.status !== "invalid")
    ) {
      throw new Error(
        `${result.candidate.key} memory budget validity is inconsistent`
      );
    }
    const peakDeltaMb =
      (result.resources.residentMemoryPeakBytes -
        result.resources.residentMemoryBeforeBytes) /
      (1024 * 1024);
    const expectedBudgetRows = [
      {
        observation: result.budgets.coldLoadMs,
        budget: report.budgets.maxColdLoadMs,
        observed: result.latency.coldLoadMs,
        within: result.latency.coldLoadMs <= report.budgets.maxColdLoadMs,
      },
      {
        observation: result.budgets.warmQueryP95Ms,
        budget: report.budgets.maxWarmQueryP95Ms,
        observed: result.latency.warmQuery.p95Ms,
        within:
          result.latency.warmQuery.p95Ms <= report.budgets.maxWarmQueryP95Ms,
      },
      {
        observation: result.budgets.ingestionSegmentsPerSecond,
        budget: report.budgets.minIngestionSegmentsPerSecond,
        observed: result.ingestion.segmentsPerSecond,
        within:
          result.ingestion.segmentsPerSecond >=
          report.budgets.minIngestionSegmentsPerSecond,
      },
      {
        observation: result.budgets.cacheBytes,
        budget: report.budgets.maxCacheBytes,
        observed: result.offlineCache.bytes,
        within: result.offlineCache.bytes <= report.budgets.maxCacheBytes,
      },
    ];
    for (const row of expectedBudgetRows) {
      if (
        row.observation.budget !== row.budget ||
        row.observation.observed !== row.observed ||
        row.observation.status !== (row.within ? "within" : "outside")
      ) {
        throw new Error(
          `${result.candidate.key} budget observation is inconsistent`
        );
      }
    }
    if (
      result.budgets.residentMemoryMb.budget !==
        report.budgets.maxResidentMemoryMb ||
      result.budgets.residentMemoryMb.observed !== peakDeltaMb
    ) {
      throw new Error(
        `${result.candidate.key} memory observation is inconsistent`
      );
    }
    if (
      expectedMemoryState === "valid" &&
      result.budgets.residentMemoryMb.status !==
        (peakDeltaMb <= report.budgets.maxResidentMemoryMb
          ? "within"
          : "outside")
    ) {
      throw new Error(`${result.candidate.key} memory status is inconsistent`);
    }
    if (
      result.resources.cacheBytes !== result.offlineCache.bytes ||
      result.ingestion.segmentCount < 60 ||
      result.offlineCache.bytes > report.cacheLimits.maxBytes
    ) {
      throw new Error(
        `${result.candidate.key} resource counts are inconsistent`
      );
    }
    const latency = result.latency.warmQuery;
    if (
      latency.samples !==
      (result.recall.overall.questionCount - 1) *
        report.measurement.warmQueryPasses
    ) {
      throw new Error(
        `${result.candidate.key} warm-query sample count is incomplete`
      );
    }
    if (
      latency.minMs > latency.medianMs ||
      latency.medianMs > latency.p95Ms ||
      latency.p95Ms > latency.maxMs
    ) {
      throw new Error(
        `${result.candidate.key} latency summary is inconsistent`
      );
    }
    validateAggregate(result.recall.overall, `${result.candidate.key} overall`);
    if (result.recall.overall.questionCount !== baselineQuestionCount) {
      throw new Error(
        `${result.candidate.key} question aggregate is incomplete`
      );
    }

    const categories = Object.values(result.recall.byCategory);
    categories.forEach((aggregate, index) =>
      validateAggregate(aggregate, `${result.candidate.key} category ${index}`)
    );
    if (
      categories.reduce(
        (sum, aggregate) => sum + aggregate.questionCount,
        0
      ) !== result.recall.overall.questionCount ||
      categories.reduce(
        (sum, aggregate) => sum + aggregate.relevantSegmentCount,
        0
      ) !== result.recall.overall.relevantSegmentCount
    ) {
      throw new Error(
        `${result.candidate.key} category aggregates are incomplete`
      );
    }

    const languageKeys = Object.keys(result.multilingual.languages).sort();
    if (
      languageKeys.length === 0 ||
      (result.multilingual.required && languageKeys.length < 2)
    ) {
      throw new Error(
        `${result.candidate.key} language aggregates are incomplete`
      );
    }
    if (
      expectedLanguageKeys &&
      expectedLanguageKeys.join("\0") !== languageKeys.join("\0")
    ) {
      throw new Error(
        "Candidate reports must contain the same language aggregates"
      );
    }
    expectedLanguageKeys = languageKeys;
    const languages = Object.values(result.multilingual.languages);
    languages.forEach((aggregate, index) =>
      validateAggregate(aggregate, `${result.candidate.key} language ${index}`)
    );
    if (
      languages.reduce((sum, aggregate) => sum + aggregate.questionCount, 0) !==
        result.recall.overall.questionCount ||
      languages.reduce(
        (sum, aggregate) => sum + aggregate.relevantSegmentCount,
        0
      ) !== result.recall.overall.relevantSegmentCount
    ) {
      throw new Error(
        `${result.candidate.key} language aggregates are incomplete`
      );
    }
  }
  const segmentCounts = new Set(
    report.results.map((result) => result.ingestion.segmentCount)
  );
  if (segmentCounts.size !== 1) {
    throw new Error("Candidate reports must use the same retrieval pool");
  }
  const segmentCount = report.results[0].ingestion.segmentCount;
  for (const depth of [5, 10, 20] as const) {
    if (report.baselines.randomExpected[depth] !== depth / segmentCount) {
      throw new Error(
        "Random expected recall does not match retrieval pool size"
      );
    }
  }
  return report;
}

/** Fails closed on malformed vectors before they can influence rankings. */
function validateEmbeddingVector(
  vector: number[],
  dimensions: number,
  label: string
): void {
  if (vector.length !== dimensions) {
    throw new Error(
      `${label} dimension mismatch: expected ${dimensions}, received ${vector.length}`
    );
  }
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} contains a non-finite value`);
  }
  const squaredNorm = vector.reduce((sum, value) => sum + value * value, 0);
  if (squaredNorm <= 1e-24) throw new Error(`${label} has a near-zero norm`);
}

export {
  validateBenchmarkFixtures,
  validateBenchmarkReport,
  validateCandidate,
  validateCandidateConfiguration,
  validateEmbeddingVector,
};
