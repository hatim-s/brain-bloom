import type {
  BenchmarkQuestion,
  BenchmarkSegment,
  LatencySummary,
  QuestionCategory,
  RecallAggregate,
  RecallMetrics,
} from "./types.ts";

const RECALL_DEPTHS = [5, 10, 20] as const;
const QUESTION_CATEGORIES: QuestionCategory[] = [
  "headings",
  "definitions",
  "slide-bullets",
  "paraphrases",
];

/** Calculates cosine similarity for validated non-zero vectors. */
function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** Ranks segment IDs by score with a stable ID tie-breaker. */
function rankSegments(
  queryVector: number[],
  segmentVectors: Array<{ id: string; vector: number[] }>
): string[] {
  return segmentVectors
    .map(({ id, vector }) => ({
      id,
      score: cosineSimilarity(queryVector, vector),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id)
    )
    .map(({ id }) => id);
}

/** Computes recall as the fraction of all relevant segments retrieved by depth. */
function recallAtDepth(
  relevantSegmentIds: string[],
  rankedSegmentIds: string[],
  depth: number
): number {
  const retrieved = new Set(rankedSegmentIds.slice(0, depth));
  const hits = relevantSegmentIds.filter((id) => retrieved.has(id)).length;
  return hits / relevantSegmentIds.length;
}

/** Aggregates recall with explicit sample and relevance counts. */
function createRecallAggregate(
  questions: BenchmarkQuestion[],
  rankings: Map<string, string[]>
): RecallAggregate {
  if (questions.length === 0)
    throw new Error("Recall aggregate cannot be empty");
  const recall = Object.fromEntries(
    RECALL_DEPTHS.map((depth) => {
      const total = questions.reduce((sum, question) => {
        const ranking = rankings.get(question.id);
        if (!ranking) throw new Error(`Missing ranking for ${question.id}`);
        return sum + recallAtDepth(question.relevantSegmentIds, ranking, depth);
      }, 0);
      return [String(depth), total / questions.length];
    })
  ) as RecallAggregate["recall"];
  return {
    questionCount: questions.length,
    relevantSegmentCount: questions.reduce(
      (sum, question) => sum + question.relevantSegmentIds.length,
      0
    ),
    recall,
  };
}

/** Aggregates overall and every required category-specific recall. */
function calculateRecallMetrics(
  questions: BenchmarkQuestion[],
  rankings: Map<string, string[]>
): RecallMetrics {
  return {
    overall: createRecallAggregate(questions, rankings),
    byCategory: Object.fromEntries(
      QUESTION_CATEGORIES.map((category) => [
        category,
        createRecallAggregate(
          questions.filter((question) => question.category === category),
          rankings
        ),
      ])
    ) as RecallMetrics["byCategory"],
  };
}

/** Tokenizes study text for a deterministic dependency-free lexical baseline. */
function lexicalTokens(text: string): Set<string> {
  return new Set(
    text.toLocaleLowerCase("und").match(/[a-z0-9À-ÖØ-öø-ÿ]+/g) ?? []
  );
}

/** Ranks the corpus by token overlap to contextualize semantic candidate recall. */
function calculateLexicalBaseline(
  questions: BenchmarkQuestion[],
  segments: BenchmarkSegment[]
): RecallMetrics {
  const segmentTokens = segments.map((segment) => ({
    id: segment.id,
    tokens: lexicalTokens(segment.text),
  }));
  const rankings = new Map(
    questions.map((question) => {
      const queryTokens = lexicalTokens(question.text);
      const ranking = segmentTokens
        .map((segment) => ({
          id: segment.id,
          score: Array.from(queryTokens).filter((token) =>
            segment.tokens.has(token)
          ).length,
        }))
        .sort(
          (left, right) =>
            right.score - left.score || left.id.localeCompare(right.id)
        )
        .map(({ id }) => id);
      return [question.id, ranking] as const;
    })
  );
  return calculateRecallMetrics(questions, rankings);
}

/** Expected random recall provides a discriminating-pool sanity baseline. */
function calculateRandomExpectedRecall(
  segmentCount: number
): Record<"5" | "10" | "20", number> {
  if (segmentCount < 20)
    throw new Error("Random baseline requires at least 20 segments");
  return {
    "5": Math.min(5, segmentCount) / segmentCount,
    "10": Math.min(10, segmentCount) / segmentCount,
    "20": Math.min(20, segmentCount) / segmentCount,
  };
}

/** Produces a deterministic nearest-rank latency summary. */
function summarizeLatencies(samples: number[]): LatencySummary {
  if (samples.length === 0) throw new Error("Latency samples cannot be empty");
  const sorted = [...samples].sort((left, right) => left - right);
  const nearestRank = (percentile: number) =>
    sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return {
    samples: sorted.length,
    minMs: sorted[0],
    medianMs: median,
    p95Ms: nearestRank(0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

export {
  calculateLexicalBaseline,
  calculateRandomExpectedRecall,
  calculateRecallMetrics,
  cosineSimilarity,
  createRecallAggregate,
  rankSegments,
  recallAtDepth,
  summarizeLatencies,
};
