/** Pinned adapter implementation that owns tokenizer and embedding behavior. */
type AdapterIdentity = {
  id: string;
  version: string;
  revision: string;
  artifactChecksum: string;
};

/** Runtime identity makes native/backend differences visible in comparisons. */
type RuntimeIdentity = {
  id: string;
  version: string;
};

/** Explicit preprocessing contract prevents hidden pooling or prefix changes. */
type PreprocessingIdentity = {
  id: string;
  version: string;
  pooling: "mean" | "cls" | "last-token";
  normalize: boolean;
  queryPrefix: string;
  documentPrefix: string;
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

/** Hard traversal bounds applied before and while cache bytes are streamed. */
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
  measurement: {
    warmQueryPasses: number;
    memorySampleIntervalMs: number;
  };
};

type SegmentFormat = "pdf" | "docx" | "pptx";
type QuestionCategory =
  | "headings"
  | "definitions"
  | "slide-bullets"
  | "paraphrases";

/** Normalized, non-sensitive segment with document-style provenance. */
type BenchmarkSegment = {
  id: string;
  sourceId: string;
  format: SegmentFormat;
  locator: string;
  text: string;
  language: string;
};

/** Versioned corpus declares multilingual expectations explicitly. */
type BenchmarkCorpus = {
  schemaVersion: 1;
  multilingual: {
    required: boolean;
    languages: string[];
  };
  segments: BenchmarkSegment[];
};

/** A question may have multiple relevant segments for recall evaluation. */
type BenchmarkQuestion = {
  id: string;
  text: string;
  category: QuestionCategory;
  language: string;
  relevantSegmentIds: string[];
};

type BenchmarkQuestionSet = {
  schemaVersion: 1;
  questions: BenchmarkQuestion[];
};

type EmbeddingRole = "document" | "query";

/** Adapter boundary keeps model runtimes and downloads out of the harness and CI. */
type EmbeddingAdapter = {
  identity: {
    adapter: AdapterIdentity;
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

/** Measurements for one candidate; no field represents selection or activation. */
type CandidateBenchmarkResult = {
  candidate: EmbeddingCandidate;
  offlineCache: {
    status: "verified";
    bytes: number;
    checksum: string;
  };
  recall: RecallMetrics;
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
    residentMemoryMeasurement: "valid" | "invalid-after-below-before";
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
  measurement: {
    warmQueryPasses: number;
    memorySampleIntervalMs: number;
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
  measurePeak<T>(
    operation: () => Promise<T>,
    sampleIntervalMs: number
  ): Promise<{ result: T; peakResidentMemoryBytes: number }>;
};

export type {
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
  BudgetObservation,
  CacheLimits,
  CandidateBenchmarkResult,
  CandidateConfiguration,
  EmbeddingAdapter,
  EmbeddingAdapterFactory,
  EmbeddingCandidate,
  EmbeddingRole,
  LatencySummary,
  PreprocessingIdentity,
  QuestionCategory,
  RecallAggregate,
  RecallMetrics,
  RuntimeIdentity,
  RuntimeProbe,
  SegmentFormat,
};
