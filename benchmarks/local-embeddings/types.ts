/** Versioned, immutable identity and resource limits for one model candidate. */
type EmbeddingCandidate = {
  key: string;
  modelId: string;
  revision: string;
  dimensions: number;
  artifactChecksum: string;
  offlineCachePath: string;
};

/** Human-reviewed limits recorded beside measurements without selecting a winner. */
type BenchmarkBudgets = {
  maxColdLoadMs: number;
  maxWarmQueryP95Ms: number;
  minIngestionSegmentsPerSecond: number;
  maxResidentMemoryMb: number;
  maxCacheBytes: number;
};

/** Root candidate configuration consumed by the evaluation harness. */
type CandidateConfiguration = {
  schemaVersion: 1;
  candidates: EmbeddingCandidate[];
  budgets: BenchmarkBudgets;
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

/** Adapter boundary keeps model runtimes and downloads out of the harness and CI. */
type EmbeddingAdapter = {
  embed(texts: string[]): Promise<number[][]>;
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

type RecallMetrics = {
  overall: Record<"5" | "10" | "20", number>;
  byCategory: Record<QuestionCategory, Record<"5" | "10" | "20", number>>;
};

type BudgetObservation = {
  budget: number;
  observed: number;
  status: "within" | "outside";
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
    residentMemoryAfterBytes: number;
    residentMemoryDeltaBytes: number;
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
    languages: Record<string, Record<"5" | "10" | "20", number>>;
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
  results: CandidateBenchmarkResult[];
};

type BenchmarkClock = {
  nowMs(): number;
};

type RuntimeProbe = {
  environment(): BenchmarkEnvironment;
  residentMemoryBytes(): number;
};

export type {
  AdapterCreateOptions,
  BenchmarkBudgets,
  BenchmarkClock,
  BenchmarkCorpus,
  BenchmarkEnvironment,
  BenchmarkQuestion,
  BenchmarkQuestionSet,
  BenchmarkReport,
  BenchmarkSegment,
  BudgetObservation,
  CandidateBenchmarkResult,
  CandidateConfiguration,
  EmbeddingAdapter,
  EmbeddingAdapterFactory,
  EmbeddingCandidate,
  LatencySummary,
  QuestionCategory,
  RecallMetrics,
  RuntimeProbe,
  SegmentFormat,
};
