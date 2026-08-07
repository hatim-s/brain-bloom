import type {
  BenchmarkQuestion,
  LatencySummary,
  QuestionCategory,
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

/** Aggregates overall and required category-specific recall. */
function calculateRecallMetrics(
  questions: BenchmarkQuestion[],
  rankings: Map<string, string[]>
): RecallMetrics {
  const average = (selected: BenchmarkQuestion[], depth: number): number => {
    if (selected.length === 0) return 0;
    const total = selected.reduce((sum, question) => {
      const ranking = rankings.get(question.id);
      if (!ranking) throw new Error(`Missing ranking for ${question.id}`);
      return sum + recallAtDepth(question.relevantSegmentIds, ranking, depth);
    }, 0);
    return total / selected.length;
  };

  const overall = Object.fromEntries(
    RECALL_DEPTHS.map((depth) => [String(depth), average(questions, depth)])
  ) as RecallMetrics["overall"];
  const byCategory = Object.fromEntries(
    QUESTION_CATEGORIES.map((category) => {
      const selected = questions.filter(
        (question) => question.category === category
      );
      return [
        category,
        Object.fromEntries(
          RECALL_DEPTHS.map((depth) => [
            String(depth),
            average(selected, depth),
          ])
        ),
      ];
    })
  ) as RecallMetrics["byCategory"];

  return { overall, byCategory };
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
  calculateRecallMetrics,
  cosineSimilarity,
  rankSegments,
  recallAtDepth,
  summarizeLatencies,
};
