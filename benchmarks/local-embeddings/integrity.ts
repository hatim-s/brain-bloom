import { rankSegments } from "./metrics.ts";
import type {
  BenchmarkCorpus,
  IntegrityEvaluation,
  IntegrityQuestion,
  IntegrityScenario,
} from "./types.ts";

const INTEGRITY_SCENARIOS: IntegrityScenario[] = [
  "cross-owner",
  "out-of-scope",
  "inactive-version",
  "adversarial",
  "malformed",
  "limit",
];

/** Evaluates scoped top-20 rankings and fails closed on every leakage dimension. */
function evaluateIntegrity(options: {
  corpus: BenchmarkCorpus;
  questions: IntegrityQuestion[];
  queryVectors: Map<string, number[]>;
  segmentVectors: Map<string, number[]>;
}): IntegrityEvaluation {
  const sourcesById = new Map(
    options.corpus.sources.map((source) => [source.sourceId, source] as const)
  );
  const segmentsById = new Map(
    options.corpus.segments.map((segment) => [segment.id, segment] as const)
  );
  let crossOwnerLeakageCount = 0;
  let outOfScopeLeakageCount = 0;
  let inactiveVersionLeakageCount = 0;
  let excludedSourceLeakageCount = 0;
  let expectedSegments = 0;
  let expectedHitsAt20 = 0;
  let forbiddenSegments = 0;
  let forbiddenHitsAt20 = 0;
  const scenarios = Object.fromEntries(
    INTEGRITY_SCENARIOS.map((scenario) => [
      scenario,
      {
        questionCount: 0,
        expectedSegments: 0,
        expectedHitsAt20: 0,
        forbiddenSegments: 0,
        forbiddenHitsAt20: 0,
        passed: true,
      },
    ])
  ) as IntegrityEvaluation["scenarios"];

  for (const question of options.questions) {
    const queryVector = options.queryVectors.get(question.id);
    if (!queryVector)
      throw new Error(`Missing integrity vector for ${question.id}`);
    const eligibleSegments = options.corpus.segments.filter((segment) => {
      const source = sourcesById.get(segment.sourceId);
      return (
        source?.ownerId === question.ownerId &&
        source.scopeId === question.scopeId &&
        source.active &&
        source.retrievable
      );
    });
    const ranking = rankSegments(
      queryVector,
      eligibleSegments.map((segment) => {
        const vector = options.segmentVectors.get(segment.id);
        if (!vector)
          throw new Error(`Missing segment vector for ${segment.id}`);
        return { id: segment.id, vector };
      })
    ).slice(0, 20);
    const retrieved = new Set(ranking);
    for (const segmentId of ranking) {
      const segment = segmentsById.get(segmentId);
      const source = segment ? sourcesById.get(segment.sourceId) : undefined;
      if (!source)
        throw new Error(`Integrity ranking references unknown ${segmentId}`);
      if (source.ownerId !== question.ownerId) crossOwnerLeakageCount += 1;
      if (source.scopeId !== question.scopeId) outOfScopeLeakageCount += 1;
      if (!source.active) inactiveVersionLeakageCount += 1;
      if (!source.retrievable) excludedSourceLeakageCount += 1;
    }

    const scenario = scenarios[question.scenario];
    const questionExpectedHits = question.expectedSegmentIds.filter((id) =>
      retrieved.has(id)
    ).length;
    const questionForbiddenHits = question.forbiddenSegmentIds.filter((id) =>
      retrieved.has(id)
    ).length;
    scenario.questionCount += 1;
    scenario.expectedSegments += question.expectedSegmentIds.length;
    scenario.expectedHitsAt20 += questionExpectedHits;
    scenario.forbiddenSegments += question.forbiddenSegmentIds.length;
    scenario.forbiddenHitsAt20 += questionForbiddenHits;
    expectedSegments += question.expectedSegmentIds.length;
    expectedHitsAt20 += questionExpectedHits;
    forbiddenSegments += question.forbiddenSegmentIds.length;
    forbiddenHitsAt20 += questionForbiddenHits;
  }

  for (const scenario of INTEGRITY_SCENARIOS) {
    const result = scenarios[scenario];
    result.passed =
      result.questionCount > 0 &&
      result.expectedHitsAt20 === result.expectedSegments &&
      result.forbiddenHitsAt20 === 0;
  }
  const passed =
    crossOwnerLeakageCount === 0 &&
    outOfScopeLeakageCount === 0 &&
    inactiveVersionLeakageCount === 0 &&
    excludedSourceLeakageCount === 0 &&
    forbiddenHitsAt20 === 0 &&
    expectedHitsAt20 === expectedSegments &&
    INTEGRITY_SCENARIOS.every((scenario) => scenarios[scenario].passed);
  return {
    required: true,
    passed,
    questionCount: options.questions.length,
    crossOwnerLeakageCount,
    outOfScopeLeakageCount,
    inactiveVersionLeakageCount,
    excludedSourceLeakageCount,
    forbiddenSegments,
    forbiddenHitsAt20,
    forbiddenHitRate:
      forbiddenSegments === 0 ? 0 : forbiddenHitsAt20 / forbiddenSegments,
    expectedHitRateAt20:
      expectedSegments === 0 ? 1 : expectedHitsAt20 / expectedSegments,
    scenarios,
  };
}

export { evaluateIntegrity, INTEGRITY_SCENARIOS };
