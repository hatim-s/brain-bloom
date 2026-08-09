import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { INTEGRITY_SCENARIOS } from "./integrity.ts";
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
const integrityScenarioSchema = z.enum(INTEGRITY_SCENARIOS);
const recallDepthSchema = z.strictObject({
  "5": z.number().min(0).max(1),
  "10": z.number().min(0).max(1),
  "20": z.number().min(0).max(1),
});

/** Converts path-refinement exceptions into a strict schema predicate. */
function isSafeRelativePath(value: string): boolean {
  try {
    validateRelativePath(value, "confined path");
    return true;
  } catch {
    return false;
  }
}

const safePathSchema = nonEmptyString.refine(isSafeRelativePath, {
  message: "path must remain relative to its dedicated cache root",
});
const adapterIdentitySchema = z.strictObject({
  id: nonEmptyString,
  version: versionSchema,
  revision: revisionSchema,
  modulePath: safePathSchema,
  artifactChecksum: checksumSchema,
  manifestPath: safePathSchema,
  manifestChecksum: checksumSchema,
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
  offlineCachePath: safePathSchema,
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
const limitsSchema = z.strictObject({
  maxBytes: z.number().int().positive(),
  maxFiles: z.number().int().positive().max(100_000),
  maxDepth: z.number().int().nonnegative().max(64),
});
const candidateConfigurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  budgets: budgetsSchema,
  cacheLimits: limitsSchema,
  adapterLimits: limitsSchema,
  measurement: z.strictObject({
    warmQueryPasses: z.number().int().min(2).max(20),
    candidateTimeoutMs: z.number().int().min(1_000).max(3_600_000),
  }),
  candidates: z.array(candidateSchema).min(2),
});

const sourceSchema = z.strictObject({
  sourceId: nonEmptyString,
  ownerId: nonEmptyString,
  scopeId: nonEmptyString,
  logicalSourceId: nonEmptyString,
  version: nonEmptyString,
  active: z.boolean(),
  retrievable: z.boolean(),
  scenario: z.union([z.literal("representative"), integrityScenarioSchema]),
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
  sources: z.array(sourceSchema).min(1),
  segments: z.array(segmentSchema).min(60),
});
const questionSchema = z.strictObject({
  id: nonEmptyString,
  text: nonEmptyString,
  category: z.enum(["headings", "definitions", "slide-bullets", "paraphrases"]),
  language: languageSchema,
  relevantSegmentIds: z.array(nonEmptyString).min(1),
});
const integrityQuestionSchema = z.strictObject({
  id: nonEmptyString,
  text: nonEmptyString,
  language: languageSchema,
  ownerId: nonEmptyString,
  scopeId: nonEmptyString,
  scenario: integrityScenarioSchema,
  expectedSegmentIds: z.array(nonEmptyString),
  forbiddenSegmentIds: z.array(nonEmptyString),
});
const questionSetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  qualityContext: z.strictObject({
    ownerId: nonEmptyString,
    scopeId: nonEmptyString,
    scenario: z.literal("retrieval-quality"),
  }),
  questions: z.array(questionSchema).min(30),
  integrityQuestions: z
    .array(integrityQuestionSchema)
    .min(INTEGRITY_SCENARIOS.length),
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
const verifiedAdapterSchema = z.strictObject({
  status: z.literal("verified"),
  modulePath: safePathSchema,
  moduleChecksum: checksumSchema,
  manifestPath: safePathSchema,
  manifestChecksum: checksumSchema,
  adapter: z.strictObject({
    id: nonEmptyString,
    version: versionSchema,
    revision: revisionSchema,
  }),
  runtime: runtimeIdentitySchema,
  preprocessing: preprocessingIdentitySchema,
});
const scenarioResultSchema = z.strictObject({
  questionCount: z.number().int().positive(),
  expectedSegments: z.number().int().nonnegative(),
  expectedHitsAt20: z.number().int().nonnegative(),
  forbiddenSegments: z.number().int().nonnegative(),
  forbiddenHitsAt20: z.number().int().nonnegative(),
  passed: z.boolean(),
});
const integritySchema = z.strictObject({
  required: z.literal(true),
  passed: z.boolean(),
  questionCount: z.number().int().positive(),
  crossOwnerLeakageCount: z.number().int().nonnegative(),
  outOfScopeLeakageCount: z.number().int().nonnegative(),
  inactiveVersionLeakageCount: z.number().int().nonnegative(),
  excludedSourceLeakageCount: z.number().int().nonnegative(),
  forbiddenSegments: z.number().int().nonnegative(),
  forbiddenHitsAt20: z.number().int().nonnegative(),
  forbiddenHitRate: z.number().min(0).max(1),
  expectedHitRateAt20: z.number().min(0).max(1),
  scenarios: z.strictObject(
    Object.fromEntries(
      INTEGRITY_SCENARIOS.map((scenario) => [scenario, scenarioResultSchema])
    ) as Record<
      (typeof INTEGRITY_SCENARIOS)[number],
      typeof scenarioResultSchema
    >
  ),
});
const candidateResultSchema = z.strictObject({
  candidate: candidateSchema,
  verifiedAdapter: verifiedAdapterSchema,
  offlineCache: z.strictObject({
    status: z.literal("verified"),
    bytes: z.number().int().nonnegative(),
    checksum: checksumSchema,
  }),
  recall: recallMetricsSchema,
  integrity: integritySchema,
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
    residentMemoryMeasurement: z.enum([
      "valid-isolated-process",
      "invalid-in-process-test",
    ]),
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
  cacheLimits: limitsSchema,
  adapterLimits: limitsSchema,
  measurement: z.strictObject({
    warmQueryPasses: z.number().int().min(2).max(20),
    candidateTimeoutMs: z.number().int().min(1_000).max(3_600_000),
    isolation: z.literal("fresh-child-process-per-candidate"),
    memoryMetric: z.literal("process-high-water-rss"),
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

/** Fully parses fixtures and enforces source, language, and integrity contracts. */
function validateBenchmarkFixtures(
  corpusInput: unknown,
  questionSetInput: unknown
): { corpus: BenchmarkCorpus; questionSet: BenchmarkQuestionSet } {
  const corpus = corpusSchema.parse(corpusInput);
  const questionSet = questionSetSchema.parse(questionSetInput);
  const languages = new Set(corpus.multilingual.languages);
  if (languages.size !== corpus.multilingual.languages.length)
    throw new Error("Corpus languages must be unique");
  const sources = new Map<string, (typeof corpus.sources)[number]>();
  const activeLogicalSources = new Set<string>();
  const logicalSourceIds = new Set<string>();
  for (const source of corpus.sources) {
    if (sources.has(source.sourceId))
      throw new Error(`Duplicate source id: ${source.sourceId}`);
    if (source.active && activeLogicalSources.has(source.logicalSourceId))
      throw new Error(
        `Logical source ${source.logicalSourceId} has multiple active versions`
      );
    if (source.active) activeLogicalSources.add(source.logicalSourceId);
    logicalSourceIds.add(source.logicalSourceId);
    sources.set(source.sourceId, source);
  }
  for (const logicalSourceId of Array.from(logicalSourceIds))
    if (!activeLogicalSources.has(logicalSourceId))
      throw new Error(
        `Logical source ${logicalSourceId} must have exactly one active version`
      );
  const segments = new Map<string, (typeof corpus.segments)[number]>();
  const formats = new Set<string>();
  const segmentLanguages = new Set<string>();
  for (const segment of corpus.segments) {
    if (segments.has(segment.id))
      throw new Error(`Duplicate segment id: ${segment.id}`);
    if (!sources.has(segment.sourceId))
      throw new Error(
        `Segment ${segment.id} references missing source ${segment.sourceId}`
      );
    if (!languages.has(segment.language))
      throw new Error(
        `Segment ${segment.id} uses undeclared language ${segment.language}`
      );
    segments.set(segment.id, segment);
    formats.add(segment.format);
    segmentLanguages.add(segment.language);
  }
  for (const format of ["pdf", "docx", "pptx"])
    if (!formats.has(format))
      throw new Error(
        `Corpus must include ${format.toUpperCase()}-like segments`
      );
  const ids = new Set<string>();
  const categories = new Set<string>();
  const questionLanguages = new Set<string>();
  for (const question of questionSet.questions) {
    if (ids.has(question.id))
      throw new Error(`Duplicate question id: ${question.id}`);
    if (!languages.has(question.language))
      throw new Error(
        `Question ${question.id} uses undeclared language ${question.language}`
      );
    if (
      new Set(question.relevantSegmentIds).size !==
      question.relevantSegmentIds.length
    )
      throw new Error(`Question ${question.id} repeats a relevant segment id`);
    for (const segmentId of question.relevantSegmentIds) {
      const segment = segments.get(segmentId);
      if (!segment)
        throw new Error(
          `Question ${question.id} references missing ${segmentId}`
        );
      const source = sources.get(segment.sourceId)!;
      if (segment.language !== question.language)
        throw new Error(
          `Question ${question.id} language does not match ${segmentId}`
        );
      if (
        source.ownerId !== questionSet.qualityContext.ownerId ||
        source.scopeId !== questionSet.qualityContext.scopeId ||
        !source.active ||
        !source.retrievable
      )
        throw new Error(
          `Quality question ${question.id} references an ineligible source`
        );
    }
    ids.add(question.id);
    categories.add(question.category);
    questionLanguages.add(question.language);
  }
  for (const category of [
    "headings",
    "definitions",
    "slide-bullets",
    "paraphrases",
  ])
    if (!categories.has(category))
      throw new Error(`Questions must cover category ${category}`);
  const coveredScenarios = new Set<string>();
  for (const question of questionSet.integrityQuestions) {
    if (ids.has(question.id))
      throw new Error(`Duplicate question id: ${question.id}`);
    ids.add(question.id);
    if (!languages.has(question.language))
      throw new Error(
        `Integrity question ${question.id} uses undeclared language ${question.language}`
      );
    if (
      new Set(question.expectedSegmentIds).size !==
        question.expectedSegmentIds.length ||
      new Set(question.forbiddenSegmentIds).size !==
        question.forbiddenSegmentIds.length
    )
      throw new Error(`Integrity question ${question.id} repeats a segment id`);
    if (
      question.expectedSegmentIds.some((id) =>
        question.forbiddenSegmentIds.includes(id)
      )
    )
      throw new Error(
        `Integrity question ${question.id} overlaps expected and forbidden ids`
      );
    for (const id of [
      ...question.expectedSegmentIds,
      ...question.forbiddenSegmentIds,
    ])
      if (!segments.has(id))
        throw new Error(
          `Integrity question ${question.id} references missing ${id}`
        );
    for (const id of question.expectedSegmentIds) {
      const source = sources.get(segments.get(id)!.sourceId)!;
      if (
        source.ownerId !== question.ownerId ||
        source.scopeId !== question.scopeId ||
        !source.active ||
        !source.retrievable
      )
        throw new Error(
          `Integrity question ${question.id} expected segment is not eligible`
        );
    }
    for (const id of question.forbiddenSegmentIds) {
      const source = sources.get(segments.get(id)!.sourceId)!;
      const correctlyExcluded =
        (question.scenario === "cross-owner" &&
          source.ownerId !== question.ownerId) ||
        (question.scenario === "out-of-scope" &&
          source.scopeId !== question.scopeId) ||
        (question.scenario === "inactive-version" && !source.active) ||
        (question.scenario === "malformed" &&
          source.scenario === "malformed" &&
          !source.retrievable) ||
        (question.scenario === "limit" &&
          source.scenario === "limit" &&
          !source.retrievable);
      if (!correctlyExcluded)
        throw new Error(
          `Integrity question ${question.id} forbidden segment does not exercise ${question.scenario}`
        );
    }
    coveredScenarios.add(question.scenario);
  }
  for (const scenario of INTEGRITY_SCENARIOS)
    if (!coveredScenarios.has(scenario))
      throw new Error(`Integrity questions must cover scenario ${scenario}`);
  for (const language of Array.from(languages))
    if (!segmentLanguages.has(language) || !questionLanguages.has(language))
      throw new Error(
        `Declared language ${language} requires segments and questions`
      );
  if (corpus.multilingual.required && languages.size < 2)
    throw new Error("Multilingual corpus must declare at least two languages");
  return { corpus, questionSet };
}

/** Validates complete report shapes, measurement provenance, and required gates. */
function validateBenchmarkReport(input: unknown): BenchmarkReport {
  const report = benchmarkReportSchema.parse(input);
  if (report.cacheLimits.maxBytes > report.budgets.maxCacheBytes)
    throw new Error("Report cache limits exceed the cache budget");
  const validateAggregate = (
    aggregate: (typeof report.results)[number]["recall"]["overall"],
    label: string
  ) => {
    if (
      aggregate.recall["5"] > aggregate.recall["10"] ||
      aggregate.recall["10"] > aggregate.recall["20"]
    )
      throw new Error(`${label} recall must be monotonic`);
  };
  validateAggregate(report.baselines.lexical.overall, "Lexical overall");
  const candidateKeys = new Set<string>();
  let expectedLanguageKeys: string[] | undefined;
  for (const result of report.results) {
    if (candidateKeys.has(result.candidate.key))
      throw new Error(`Duplicate report candidate ${result.candidate.key}`);
    candidateKeys.add(result.candidate.key);
    if (
      result.verifiedAdapter.modulePath !==
        result.candidate.adapter.modulePath ||
      result.verifiedAdapter.moduleChecksum !==
        result.candidate.adapter.artifactChecksum ||
      result.verifiedAdapter.manifestPath !==
        result.candidate.adapter.manifestPath ||
      result.verifiedAdapter.manifestChecksum !==
        result.candidate.adapter.manifestChecksum ||
      !isDeepStrictEqual(result.verifiedAdapter.adapter, {
        id: result.candidate.adapter.id,
        version: result.candidate.adapter.version,
        revision: result.candidate.adapter.revision,
      }) ||
      !isDeepStrictEqual(
        result.verifiedAdapter.runtime,
        result.candidate.runtime
      ) ||
      !isDeepStrictEqual(
        result.verifiedAdapter.preprocessing,
        result.candidate.preprocessing
      )
    )
      throw new Error(
        `${result.candidate.key} adapter provenance is inconsistent`
      );
    const scenarioRows = INTEGRITY_SCENARIOS.map(
      (scenario) => result.integrity.scenarios[scenario]
    );
    const expectedSegments = scenarioRows.reduce(
      (sum, row) => sum + row.expectedSegments,
      0
    );
    const expectedHits = scenarioRows.reduce(
      (sum, row) => sum + row.expectedHitsAt20,
      0
    );
    const forbiddenSegments = scenarioRows.reduce(
      (sum, row) => sum + row.forbiddenSegments,
      0
    );
    const forbiddenHits = scenarioRows.reduce(
      (sum, row) => sum + row.forbiddenHitsAt20,
      0
    );
    if (
      scenarioRows.reduce((sum, row) => sum + row.questionCount, 0) !==
        result.integrity.questionCount ||
      forbiddenSegments !== result.integrity.forbiddenSegments ||
      forbiddenHits !== result.integrity.forbiddenHitsAt20 ||
      result.integrity.expectedHitRateAt20 !==
        (expectedSegments === 0 ? 1 : expectedHits / expectedSegments) ||
      result.integrity.forbiddenHitRate !==
        (forbiddenSegments === 0 ? 0 : forbiddenHits / forbiddenSegments)
    )
      throw new Error(
        `${result.candidate.key} integrity aggregates are inconsistent`
      );
    if (
      !result.integrity.passed ||
      result.integrity.crossOwnerLeakageCount !== 0 ||
      result.integrity.outOfScopeLeakageCount !== 0 ||
      result.integrity.inactiveVersionLeakageCount !== 0 ||
      result.integrity.excludedSourceLeakageCount !== 0 ||
      result.integrity.forbiddenHitRate !== 0 ||
      !INTEGRITY_SCENARIOS.every(
        (scenario) => result.integrity.scenarios[scenario].passed
      )
    )
      throw new Error(
        `${result.candidate.key} failed required integrity gates`
      );
    if (
      result.resources.residentMemoryPeakBytes <
      Math.max(
        result.resources.residentMemoryBeforeBytes,
        result.resources.residentMemoryAfterBytes
      )
    )
      throw new Error(`${result.candidate.key} peak RSS is incomplete`);
    const isolated =
      result.resources.residentMemoryMeasurement === "valid-isolated-process";
    if (isolated !== (result.budgets.residentMemoryMb.status !== "invalid"))
      throw new Error(
        `${result.candidate.key} memory budget validity is inconsistent`
      );
    const peakMiB = result.resources.residentMemoryPeakBytes / (1024 * 1024);
    if (result.budgets.residentMemoryMb.observed !== peakMiB)
      throw new Error(
        `${result.candidate.key} memory observation is inconsistent`
      );
    if (
      isolated &&
      result.budgets.residentMemoryMb.status !==
        (peakMiB <= report.budgets.maxResidentMemoryMb ? "within" : "outside")
    )
      throw new Error(`${result.candidate.key} memory status is inconsistent`);
    const budgetRows = [
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
    for (const row of budgetRows)
      if (
        row.observation.budget !== row.budget ||
        row.observation.observed !== row.observed ||
        row.observation.status !== (row.within ? "within" : "outside")
      )
        throw new Error(
          `${result.candidate.key} budget observation is inconsistent`
        );
    if (
      result.latency.warmQuery.samples !==
      (result.recall.overall.questionCount - 1) *
        report.measurement.warmQueryPasses
    )
      throw new Error(
        `${result.candidate.key} warm-query sample count is incomplete`
      );
    if (
      result.resources.cacheBytes !== result.offlineCache.bytes ||
      result.offlineCache.bytes > report.cacheLimits.maxBytes ||
      result.ingestion.segmentCount < 60
    )
      throw new Error(
        `${result.candidate.key} resource counts are inconsistent`
      );
    const latency = result.latency.warmQuery;
    if (
      latency.minMs > latency.medianMs ||
      latency.medianMs > latency.p95Ms ||
      latency.p95Ms > latency.maxMs
    )
      throw new Error(
        `${result.candidate.key} latency summary is inconsistent`
      );
    validateAggregate(result.recall.overall, `${result.candidate.key} overall`);
    const categories = Object.values(result.recall.byCategory);
    categories.forEach((aggregate, index) =>
      validateAggregate(aggregate, `${result.candidate.key} category ${index}`)
    );
    if (
      categories.reduce((sum, row) => sum + row.questionCount, 0) !==
        result.recall.overall.questionCount ||
      categories.reduce((sum, row) => sum + row.relevantSegmentCount, 0) !==
        result.recall.overall.relevantSegmentCount
    )
      throw new Error(
        `${result.candidate.key} category aggregates are incomplete`
      );
    const languageKeys = Object.keys(result.multilingual.languages).sort();
    if (
      languageKeys.length === 0 ||
      (result.multilingual.required && languageKeys.length < 2)
    )
      throw new Error(
        `${result.candidate.key} language aggregates are incomplete`
      );
    if (
      expectedLanguageKeys &&
      expectedLanguageKeys.join("\0") !== languageKeys.join("\0")
    )
      throw new Error("Candidate language aggregates do not match");
    expectedLanguageKeys = languageKeys;
    const languageRows = Object.values(result.multilingual.languages);
    if (
      languageRows.reduce((sum, row) => sum + row.questionCount, 0) !==
        result.recall.overall.questionCount ||
      languageRows.reduce((sum, row) => sum + row.relevantSegmentCount, 0) !==
        result.recall.overall.relevantSegmentCount
    )
      throw new Error(
        `${result.candidate.key} language aggregates are incomplete`
      );
  }
  if (
    new Set(report.results.map((result) => result.ingestion.segmentCount))
      .size !== 1
  )
    throw new Error("Candidate reports must use the same retrieval pool");
  const segmentCount = report.results[0].ingestion.segmentCount;
  for (const depth of [5, 10, 20] as const)
    if (report.baselines.randomExpected[depth] !== depth / segmentCount)
      throw new Error("Random expected recall does not match retrieval pool");
  return report;
}

/** Fails closed on malformed vectors before they can influence rankings. */
function validateEmbeddingVector(
  vector: number[],
  dimensions: number,
  label: string
): void {
  if (vector.length !== dimensions)
    throw new Error(
      `${label} dimension mismatch: expected ${dimensions}, received ${vector.length}`
    );
  if (vector.some((value) => !Number.isFinite(value)))
    throw new Error(`${label} contains a non-finite value`);
  const scale = vector.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value)),
    0
  );
  if (!Number.isFinite(scale) || scale <= 1e-12)
    throw new Error(`${label} has a near-zero or invalid norm`);
  const scaledNorm = Math.sqrt(
    vector.reduce((sum, value) => sum + (value / scale) ** 2, 0)
  );
  if (!Number.isFinite(scaledNorm) || scaledNorm === 0)
    throw new Error(`${label} has a non-finite norm`);
}

export {
  validateBenchmarkFixtures,
  validateBenchmarkReport,
  validateCandidate,
  validateCandidateConfiguration,
  validateEmbeddingVector,
};
