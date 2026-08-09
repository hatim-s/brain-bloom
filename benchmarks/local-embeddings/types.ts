/** Versioned executable contract for one immutable adapter bundle. */
type AdapterBundleContract = {
  format: "self-contained-esm-bundle/v1";
  allowedNodeBuiltins: string[];
};

/** Pinned adapter artifact and manifest that bind executable behavior. */
type AdapterIdentity = {
  id: string;
  version: string;
  revision: string;
  modulePath: string;
  artifactChecksum: string;
  manifestPath: string;
  manifestChecksum: string;
  bundle: AdapterBundleContract;
};

/** Runtime identity is verified from the adapter's bounded manifest. */
type RuntimeIdentity = {
  id: string;
  version: string;
};

/** Preprocessing identity is verified from the adapter's bounded manifest. */
type PreprocessingIdentity = {
  id: string;
  version: string;
  pooling: "mean" | "cls" | "last-token";
  normalize: boolean;
  queryPrefix: string;
  documentPrefix: string;
};

/** Cryptographic provenance derived from confined artifact bytes, not adapter claims. */
type VerifiedAdapterArtifact = {
  status: "verified";
  modulePath: string;
  moduleChecksum: string;
  manifestPath: string;
  manifestChecksum: string;
  adapter: Pick<AdapterIdentity, "id" | "version" | "revision">;
  bundle: AdapterBundleContract;
  runtime: RuntimeIdentity;
  preprocessing: PreprocessingIdentity;
};

/** Versioned, immutable identity and resource limits for one model candidate. */
type EmbeddingCandidate = {
  key: string;
  modelId: string;
  revision: string;
  dimensions: number;
  artifactChecksum: string;
  offlineCachePath: string;
  adapter: AdapterIdentity;
  runtime: RuntimeIdentity;
  preprocessing: PreprocessingIdentity;
};

/** Human-reviewed limits recorded beside measurements without selecting a winner. */
type BenchmarkBudgets = {
  maxColdLoadMs: number;
  maxWarmQueryP95Ms: number;
  minIngestionSegmentsPerSecond: number;
  maxResidentMemoryMb: number;
  maxCacheBytes: number;
};

/** Hard traversal bounds applied before and while bytes are streamed. */
type CacheLimits = {
  maxBytes: number;
  maxFiles: number;
  maxDepth: number;
};

/** Root candidate configuration consumed by the evaluation harness. */
type CandidateConfiguration = {
  schemaVersion: 1;
  candidates: EmbeddingCandidate[];
  budgets: BenchmarkBudgets;
  cacheLimits: CacheLimits;
  adapterLimits: CacheLimits;
  measurement: {
    warmQueryPasses: number;
    candidateTimeoutMs: number;
  };
};

type SegmentFormat = "pdf" | "docx" | "pptx";
type QuestionCategory =
  | "headings"
  | "definitions"
  | "slide-bullets"
  | "paraphrases";
type IntegrityScenario =
  | "cross-owner"
  | "out-of-scope"
  | "inactive-version"
  | "adversarial"
  | "malformed"
  | "limit";

/** Authorization and lifecycle metadata shared by normalized source segments. */
type BenchmarkSource = {
  sourceId: string;
  ownerId: string;
  scopeId: string;
  logicalSourceId: string;
  version: string;
  active: boolean;
  retrievable: boolean;
  scenario: "representative" | IntegrityScenario;
};

/** Normalized, non-sensitive segment with document-style provenance. */
type BenchmarkSegment = {
  id: string;
  sourceId: string;
  format: SegmentFormat;
  locator: string;
  text: string;
  language: string;
};

/** Versioned corpus declares multilingual and source-integrity expectations. */
type BenchmarkCorpus = {
  schemaVersion: 1;
  multilingual: {
    required: boolean;
    languages: string[];
  };
  sources: BenchmarkSource[];
  segments: BenchmarkSegment[];
};

/** A quality question may have multiple relevant segments for recall evaluation. */
type BenchmarkQuestion = {
  id: string;
  text: string;
  category: QuestionCategory;
  language: string;
  relevantSegmentIds: string[];
};

/** Explicit integrity query contains positive and forbidden retrieval evidence. */
type IntegrityQuestion = {
  id: string;
  text: string;
  language: string;
  ownerId: string;
  scopeId: string;
  scenario: IntegrityScenario;
  expectedSegmentIds: string[];
  forbiddenSegmentIds: string[];
};

type BenchmarkQuestionSet = {
  schemaVersion: 1;
  qualityContext: {
    ownerId: string;
    scopeId: string;
    scenario: "retrieval-quality";
  };
  questions: BenchmarkQuestion[];
  integrityQuestions: IntegrityQuestion[];
};

type EmbeddingRole = "document" | "query";

/** Adapter boundary keeps model runtimes and downloads out of the harness and CI. */
type EmbeddingAdapter = {
  identity: {
    adapter: Pick<AdapterIdentity, "id" | "version" | "revision">;
    runtime: RuntimeIdentity;
    preprocessing: PreprocessingIdentity;
  };
  load(): Promise<void>;
  embed(texts: string[], role: EmbeddingRole): Promise<number[][]>;
  close?(): Promise<void>;
};

type AdapterCreateOptions = {
  allowDownloads: boolean;
  offlineCachePath: string;
};

type EmbeddingAdapterFactory = {
  create(
    candidate: EmbeddingCandidate,
    options: AdapterCreateOptions
  ): Promise<EmbeddingAdapter>;
};

type LatencySummary = {
  samples: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
};

type RecallAggregate = {
  questionCount: number;
  relevantSegmentCount: number;
  recall: Record<"5" | "10" | "20", number>;
};

type RecallMetrics = {
  overall: RecallAggregate;
  byCategory: Record<QuestionCategory, RecallAggregate>;
};

type BudgetObservation = {
  budget: number;
  observed: number;
  status: "within" | "outside" | "invalid";
};

type IntegrityScenarioResult = {
  questionCount: number;
  expectedSegments: number;
  expectedHitsAt20: number;
  forbiddenSegments: number;
  forbiddenHitsAt20: number;
  passed: boolean;
};

type IntegrityEvaluation = {
  required: true;
  passed: boolean;
  questionCount: number;
  crossOwnerLeakageCount: number;
  outOfScopeLeakageCount: number;
  inactiveVersionLeakageCount: number;
  excludedSourceLeakageCount: number;
  forbiddenSegments: number;
  forbiddenHitsAt20: number;
  forbiddenHitRate: number;
  expectedHitRateAt20: number;
  scenarios: Record<IntegrityScenario, IntegrityScenarioResult>;
};

/** Measurements for one candidate; no field represents selection or activation. */
type CandidateBenchmarkResult = {
  candidate: EmbeddingCandidate;
  verifiedAdapter: VerifiedAdapterArtifact;
  offlineCache: {
    status: "verified";
    bytes: number;
    checksum: string;
  };
  recall: RecallMetrics;
  integrity: IntegrityEvaluation;
  latency: {
    coldLoadMs: number;
    coldQueryMs: number;
    warmQuery: LatencySummary;
  };
  ingestion: {
    segmentCount: number;
    elapsedMs: number;
    segmentsPerSecond: number;
  };
  resources: {
    residentMemoryBeforeBytes: number;
    residentMemoryPeakBytes: number;
    residentMemoryAfterBytes: number;
    residentMemoryMeasurement:
      | "valid-isolated-process"
      | "invalid-in-process-test";
    cacheBytes: number;
  };
  budgets: {
    coldLoadMs: BudgetObservation;
    warmQueryP95Ms: BudgetObservation;
    ingestionSegmentsPerSecond: BudgetObservation;
    residentMemoryMb: BudgetObservation;
    cacheBytes: BudgetObservation;
  };
  multilingual: {
    required: boolean;
    languages: Record<string, RecallAggregate>;
  };
};

type BenchmarkEnvironment = {
  platform: string;
  architecture: string;
  nodeVersion: string;
  cpuModel: string;
  cpuCount: number;
};

/** Complete deterministic artifact produced by one benchmark run. */
type BenchmarkReport = {
  schemaVersion: 1;
  decision: "not-selected";
  environment: BenchmarkEnvironment;
  fixtureVersions: {
    candidates: 1;
    corpus: 1;
    questions: 1;
  };
  budgets: BenchmarkBudgets;
  cacheLimits: CacheLimits;
  adapterLimits: CacheLimits;
  measurement: {
    warmQueryPasses: number;
    candidateTimeoutMs: number;
    isolation: "fresh-child-process-per-candidate";
    memoryMetric: "process-high-water-rss";
  };
  baselines: {
    randomExpected: Record<"5" | "10" | "20", number>;
    lexical: RecallMetrics;
  };
  results: CandidateBenchmarkResult[];
};

type BenchmarkClock = {
  nowMs(): number;
};

type RuntimeProbe = {
  environment(): BenchmarkEnvironment;
  residentMemoryBytes(): number;
  peakResidentMemoryBytes(): number;
};

export type {
  AdapterBundleContract,
  AdapterCreateOptions,
  AdapterIdentity,
  BenchmarkBudgets,
  BenchmarkClock,
  BenchmarkCorpus,
  BenchmarkEnvironment,
  BenchmarkQuestion,
  BenchmarkQuestionSet,
  BenchmarkReport,
  BenchmarkSegment,
  BenchmarkSource,
  BudgetObservation,
  CacheLimits,
  CandidateBenchmarkResult,
  CandidateConfiguration,
  EmbeddingAdapter,
  EmbeddingAdapterFactory,
  EmbeddingCandidate,
  EmbeddingRole,
  IntegrityEvaluation,
  IntegrityQuestion,
  IntegrityScenario,
  IntegrityScenarioResult,
  LatencySummary,
  PreprocessingIdentity,
  QuestionCategory,
  RecallAggregate,
  RecallMetrics,
  RuntimeIdentity,
  RuntimeProbe,
  SegmentFormat,
  VerifiedAdapterArtifact,
};
