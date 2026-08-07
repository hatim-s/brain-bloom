import type {
  BenchmarkCorpus,
  BenchmarkQuestionSet,
  CandidateConfiguration,
  EmbeddingCandidate,
  QuestionCategory,
  SegmentFormat,
} from "./types.ts";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40,64}$/;
const REQUIRED_FORMATS: SegmentFormat[] = ["pdf", "docx", "pptx"];
const REQUIRED_CATEGORIES: QuestionCategory[] = [
  "headings",
  "definitions",
  "slide-bullets",
  "paraphrases",
];

/** Rejects floating model identities and incomplete artifact declarations. */
function validateCandidate(candidate: EmbeddingCandidate): void {
  if (!candidate.key.trim() || !candidate.modelId.trim()) {
    throw new Error("Every candidate requires a key and modelId");
  }
  if (!REVISION_PATTERN.test(candidate.revision)) {
    throw new Error(
      `Candidate ${candidate.key} revision must be an exact 40-64 character lowercase hexadecimal commit`
    );
  }
  if (
    !Number.isSafeInteger(candidate.dimensions) ||
    candidate.dimensions <= 0
  ) {
    throw new Error(`Candidate ${candidate.key} dimensions must be positive`);
  }
  if (!CHECKSUM_PATTERN.test(candidate.artifactChecksum)) {
    throw new Error(
      `Candidate ${candidate.key} requires an exact sha256 artifact checksum`
    );
  }
  if (!candidate.offlineCachePath.trim()) {
    throw new Error(
      `Candidate ${candidate.key} requires an offline cache path`
    );
  }
}

/** Validates the versioned candidate file and enforces a real comparison. */
function validateCandidateConfiguration(
  configuration: CandidateConfiguration
): void {
  if (configuration.schemaVersion !== 1) {
    throw new Error("Unsupported candidate configuration schema version");
  }
  if (configuration.candidates.length < 2) {
    throw new Error("The benchmark requires at least two candidates");
  }

  const keys = new Set<string>();
  for (const candidate of configuration.candidates) {
    validateCandidate(candidate);
    if (keys.has(candidate.key)) {
      throw new Error(`Duplicate candidate key: ${candidate.key}`);
    }
    keys.add(candidate.key);
  }

  for (const [name, value] of Object.entries(configuration.budgets)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Budget ${name} must be finite and positive`);
    }
  }
}

/** Validates committed fixtures before any adapter is loaded. */
function validateBenchmarkFixtures(
  corpus: BenchmarkCorpus,
  questionSet: BenchmarkQuestionSet
): void {
  if (corpus.schemaVersion !== 1 || questionSet.schemaVersion !== 1) {
    throw new Error("Unsupported fixture schema version");
  }
  if (questionSet.questions.length < 30) {
    throw new Error("At least 30 representative questions are required");
  }

  const segmentIds = new Set<string>();
  const formats = new Set<SegmentFormat>();
  for (const segment of corpus.segments) {
    if (segmentIds.has(segment.id)) {
      throw new Error(`Duplicate segment id: ${segment.id}`);
    }
    if (!segment.text.trim() || !segment.locator.trim()) {
      throw new Error(`Segment ${segment.id} requires text and a locator`);
    }
    segmentIds.add(segment.id);
    formats.add(segment.format);
  }
  for (const format of REQUIRED_FORMATS) {
    if (!formats.has(format)) {
      throw new Error(
        `Corpus must include ${format.toUpperCase()}-like segments`
      );
    }
  }

  const categories = new Set<QuestionCategory>();
  const questionIds = new Set<string>();
  const questionLanguages = new Set<string>();
  for (const question of questionSet.questions) {
    if (questionIds.has(question.id)) {
      throw new Error(`Duplicate question id: ${question.id}`);
    }
    if (!question.text.trim() || question.relevantSegmentIds.length === 0) {
      throw new Error(
        `Question ${question.id} requires text and relevant segments`
      );
    }
    for (const segmentId of question.relevantSegmentIds) {
      if (!segmentIds.has(segmentId)) {
        throw new Error(
          `Question ${question.id} references missing ${segmentId}`
        );
      }
    }
    questionIds.add(question.id);
    categories.add(question.category);
    questionLanguages.add(question.language);
  }
  for (const category of REQUIRED_CATEGORIES) {
    if (!categories.has(category)) {
      throw new Error(`Questions must cover category ${category}`);
    }
  }

  if (corpus.multilingual.required) {
    for (const language of corpus.multilingual.languages) {
      if (!questionLanguages.has(language)) {
        throw new Error(`Multilingual corpus requires ${language} questions`);
      }
    }
  }
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
  // Near-zero vectors make cosine similarity unstable even when finite.
  if (squaredNorm <= 1e-24) {
    throw new Error(`${label} has a near-zero norm`);
  }
}

export {
  validateBenchmarkFixtures,
  validateCandidate,
  validateCandidateConfiguration,
  validateEmbeddingVector,
};
