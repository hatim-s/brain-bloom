import type { BenchmarkReport } from "./types.ts";

/** Recursively sorts object keys while preserving configured array order. */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)])
    );
  }
  return value;
}

/** Serializes a stable machine-readable artifact suitable for diffing in review. */
function createJsonReport(report: BenchmarkReport): string {
  return `${JSON.stringify(sortJsonValue(report), null, 2)}\n`;
}

/** Renders measurements side by side while explicitly withholding selection. */
function createMarkdownReport(report: BenchmarkReport): string {
  const rows = report.results.map((result) => {
    const recall = result.recall.overall;
    return `| ${result.candidate.key} | ${result.candidate.modelId} | ${result.candidate.revision} | ${result.candidate.dimensions} | ${result.offlineCache.status} (${result.offlineCache.bytes} B) | ${result.offlineCache.checksum} | ${recall["5"].toFixed(3)} | ${recall["10"].toFixed(3)} | ${recall["20"].toFixed(3)} | ${result.latency.coldLoadMs.toFixed(2)} | ${result.latency.coldQueryMs.toFixed(2)} | ${result.latency.warmQuery.p95Ms.toFixed(2)} | ${result.ingestion.segmentsPerSecond.toFixed(2)} | ${(result.resources.residentMemoryDeltaBytes / (1024 * 1024)).toFixed(2)} |`;
  });
  const detailSections = report.results.flatMap((result) => {
    const languageRows = Object.entries(result.multilingual.languages).map(
      ([language, recall]) =>
        `| ${language} | ${recall["5"].toFixed(3)} | ${recall["10"].toFixed(3)} | ${recall["20"].toFixed(3)} |`
    );
    return [
      `### ${result.candidate.key} details`,
      "",
      "| Category | R@5 | R@10 | R@20 |",
      "| --- | ---: | ---: | ---: |",
      ...Object.entries(result.recall.byCategory).map(
        ([category, recall]) =>
          `| ${category} | ${recall["5"].toFixed(3)} | ${recall["10"].toFixed(3)} | ${recall["20"].toFixed(3)} |`
      ),
      "",
      `Multilingual behavior required: ${result.multilingual.required ? "yes" : "no"}.`,
      ...(languageRows.length > 0
        ? [
            "",
            "| Language | R@5 | R@10 | R@20 |",
            "| --- | ---: | ---: | ---: |",
            ...languageRows,
          ]
        : []),
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

  return [
    "# Local embedding candidate comparison",
    "",
    "> Decision: **not selected**. This report compares measurements only; a human review must choose and activate any model.",
    "",
    "## Environment",
    "",
    `- Platform: ${report.environment.platform} (${report.environment.architecture})`,
    `- Node: ${report.environment.nodeVersion}`,
    `- CPU: ${report.environment.cpuModel} x ${report.environment.cpuCount}`,
    "",
    "## Candidate measurements",
    "",
    "| Candidate | Model | Exact revision | Dimensions | Offline cache | Artifact checksum | R@5 | R@10 | R@20 | Cold load ms | Cold query ms | Warm p95 ms | Segments/s | RSS delta MiB |",
    "| --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    "Budget status is observational and does not select a winner.",
    "",
    ...detailSections,
    "## Budgets",
    "",
    "```json",
    JSON.stringify(report.budgets, null, 2),
    "```",
    "",
  ].join("\n");
}

export { createJsonReport, createMarkdownReport, sortJsonValue };
