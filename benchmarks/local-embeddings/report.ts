import { compareCodeUnits } from "./ordering.ts";
import type { BenchmarkReport } from "./types.ts";
import { validateBenchmarkReport } from "./validation.ts";

/** Recursively sorts object keys while preserving configured array order. */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, nested]) => [key, sortJsonValue(nested)])
    );
  }
  return value;
}

/** Serializes a runtime-validated machine-readable artifact for review diffs. */
function createJsonReport(reportInput: BenchmarkReport): string {
  const report = validateBenchmarkReport(reportInput);
  return `${JSON.stringify(sortJsonValue(report), null, 2)}\n`;
}

/** Renders measurements side by side while explicitly withholding selection. */
function createMarkdownReport(reportInput: BenchmarkReport): string {
  const report = validateBenchmarkReport(reportInput);
  const rows = report.results.map((result) => {
    const recall = result.recall.overall.recall;
    const peakMiB = result.resources.residentMemoryPeakBytes / (1024 * 1024);
    const bundleIdentity = `${result.verifiedAdapter.bundle.format}; ${result.verifiedAdapter.bundle.executionBoundary}; builtins ${result.verifiedAdapter.bundle.allowedNodeBuiltins.join(", ") || "none"}`;
    const evidence = `${result.executionEvidence.evidenceClass}; model access ${result.executionEvidence.modelArtifactAccess}; ${result.executionEvidence.selectionEligibility}`;
    return `| ${result.candidate.key} | ${result.candidate.modelId} | ${result.candidate.revision} | ${evidence} | ${result.verifiedAdapter.adapter.id}@${result.verifiedAdapter.adapter.version} (${result.verifiedAdapter.adapter.revision}; ${result.verifiedAdapter.moduleChecksum}) | ${bundleIdentity} | ${result.verifiedAdapter.runtime.id}@${result.verifiedAdapter.runtime.version} | ${result.verifiedAdapter.preprocessing.id}@${result.verifiedAdapter.preprocessing.version} | ${result.candidate.dimensions} | ${result.offlineCache.status} (${result.offlineCache.bytes} B) | ${result.offlineCache.checksum} | ${recall["5"].toFixed(3)} | ${recall["10"].toFixed(3)} | ${recall["20"].toFixed(3)} | ${result.integrity.passed ? "pass" : "fail"} (${result.integrity.forbiddenHitRate.toFixed(3)}) | ${result.latency.coldLoadMs.toFixed(2)} | ${result.latency.coldQueryMs.toFixed(2)} | ${result.latency.warmQuery.p95Ms.toFixed(2)} | ${result.ingestion.segmentsPerSecond.toFixed(2)} | ${result.resources.residentMemoryBeforeBytes} / ${result.resources.residentMemoryPeakBytes} / ${result.resources.residentMemoryAfterBytes} (${peakMiB.toFixed(2)} MiB absolute peak; ${result.resources.residentMemoryMeasurement}) |`;
  });
  const detailSections = report.results.flatMap((result) => {
    const languageRows = Object.entries(result.multilingual.languages).map(
      ([language, aggregate]) =>
        `| ${language} | ${aggregate.questionCount} | ${aggregate.relevantSegmentCount} | ${aggregate.recall["5"].toFixed(3)} | ${aggregate.recall["10"].toFixed(3)} | ${aggregate.recall["20"].toFixed(3)} |`
    );
    return [
      `### ${result.candidate.key} details`,
      "",
      "| Category | Questions | Relevant segments | R@5 | R@10 | R@20 |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
      ...Object.entries(result.recall.byCategory).map(
        ([category, aggregate]) =>
          `| ${category} | ${aggregate.questionCount} | ${aggregate.relevantSegmentCount} | ${aggregate.recall["5"].toFixed(3)} | ${aggregate.recall["10"].toFixed(3)} | ${aggregate.recall["20"].toFixed(3)} |`
      ),
      "",
      `Multilingual behavior required: ${result.multilingual.required ? "yes" : "no"}.`,
      "",
      "| Language | Questions | Relevant segments | R@5 | R@10 | R@20 |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
      ...languageRows,
      "",
      `Integrity gate: ${result.integrity.passed ? "pass" : "fail"}; cross-owner ${result.integrity.crossOwnerLeakageCount}, out-of-scope ${result.integrity.outOfScopeLeakageCount}, inactive-version ${result.integrity.inactiveVersionLeakageCount}, excluded-source ${result.integrity.excludedSourceLeakageCount}, forbidden-hit rate ${result.integrity.forbiddenHitRate.toFixed(3)}.`,
      "",
      "| Budget measurement | Observed | Budget | Status |",
      "| --- | ---: | ---: | --- |",
      ...Object.entries(result.budgets).map(
        ([measurement, observation]) =>
          `| ${measurement} | ${observation.observed.toFixed(2)} | ${observation.budget.toFixed(2)} | ${observation.status} |`
      ),
      "",
    ];
  });
  const lexical = report.baselines.lexical.overall;

  return [
    "# Local embedding candidate comparison",
    "",
    "> **INVALID FOR MODEL SELECTION.** This is sandbox-smoke-only evidence: model artifact access is `none`, every budget status is invalid, and no configured model was evaluated.",
    ">",
    `> Stable reason: \`${report.executionEvidence.selectionIneligibilityReason}\`. Decision: **not selected**.`,
    "",
    "## Environment",
    "",
    `- Platform: ${report.environment.platform} (${report.environment.architecture})`,
    `- Node: ${report.environment.nodeVersion}`,
    `- CPU: ${report.environment.cpuModel} x ${report.environment.cpuCount}`,
    "",
    "## Baselines",
    "",
    `- Random expected recall: R@5 ${report.baselines.randomExpected["5"].toFixed(3)}, R@10 ${report.baselines.randomExpected["10"].toFixed(3)}, R@20 ${report.baselines.randomExpected["20"].toFixed(3)}.`,
    `- Lexical (${lexical.questionCount} questions): R@5 ${lexical.recall["5"].toFixed(3)}, R@10 ${lexical.recall["10"].toFixed(3)}, R@20 ${lexical.recall["20"].toFixed(3)}.`,
    "",
    "## Candidate measurements",
    "",
    "| Candidate | Configured model label | Exact revision | Execution evidence | Verified adapter identity/digest | Bundle contract | Runtime identity | Preprocessing identity | Dimensions | Offline cache verification only | Artifact checksum | R@5 | R@10 | R@20 | Integrity / forbidden rate | Cold load ms | Cold query ms | Warm p95 ms | Segments/s | RSS before / peak / after |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    "All budget statuses are invalid because these observations are not model-backed.",
    "",
    ...detailSections,
    "## Budgets",
    "",
    "```json",
    JSON.stringify(report.budgets, null, 2),
    "```",
    "",
    "## Measurement protocol and cache limits",
    "",
    "```json",
    JSON.stringify(
      {
        measurement: report.measurement,
        cacheLimits: report.cacheLimits,
        adapterLimits: report.adapterLimits,
      },
      null,
      2
    ),
    "```",
    "",
  ].join("\n");
}

export { createJsonReport, createMarkdownReport, sortJsonValue };
