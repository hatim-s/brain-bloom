import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectCacheArtifact, verifyCacheArtifact } from "./cache.ts";
import { assertExecutionPolicy, validateCliDownloadFlags } from "./policy.ts";
import { createJsonReport, createMarkdownReport } from "./report.ts";
import { runBenchmark } from "./runner.ts";
import type {
  BenchmarkCorpus,
  BenchmarkQuestionSet,
  CandidateConfiguration,
  EmbeddingAdapterFactory,
} from "./types.ts";
import {
  validateBenchmarkFixtures,
  validateCandidateConfiguration,
} from "./validation.ts";

type CliOptions = {
  run: boolean;
  allowDownloads: boolean;
  adapterModule?: string;
  outputDirectory: string;
};

type AdapterModule = {
  createEmbeddingAdapterFactory?: () =>
    | EmbeddingAdapterFactory
    | Promise<EmbeddingAdapterFactory>;
};

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Parses the intentionally small dry-run-first command line. */
function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    run: false,
    allowDownloads: false,
    outputDirectory: path.join(benchmarkDirectory, "results"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--run") {
      options.run = true;
    } else if (argument === "--allow-downloads") {
      options.allowDownloads = true;
    } else if (argument === "--adapter-module") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--adapter-module requires a local module path");
      }
      options.adapterModule = value;
      index += 1;
    } else if (argument === "--output-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--output-dir requires a directory path");
      }
      options.outputDirectory = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  validateCliDownloadFlags(options.run, options.allowDownloads);
  if (options.run && !options.adapterModule) {
    throw new Error("--run requires an injected --adapter-module <local path>");
  }
  return options;
}

/** Reads a committed JSON fixture without a runtime validation dependency. */
async function readJsonFixture<T>(filename: string): Promise<T> {
  return JSON.parse(
    await readFile(path.join(benchmarkDirectory, filename), "utf8")
  ) as T;
}

/** Reports cache readiness without importing or executing any model adapter. */
async function createDryRunSummary(
  configuration: CandidateConfiguration
): Promise<string> {
  const lines = [
    "Local embedding benchmark dry run",
    "No model code was loaded and network downloads are denied.",
    "",
  ];
  for (const candidate of configuration.candidates) {
    const cachePath = path.resolve(process.cwd(), candidate.offlineCachePath);
    let status = "missing";
    try {
      await access(cachePath);
      const metadata = await inspectCacheArtifact(cachePath);
      status =
        metadata.checksum === candidate.artifactChecksum
          ? `verified (${metadata.bytes} bytes)`
          : `checksum mismatch (${metadata.checksum})`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    lines.push(
      `- ${candidate.key}: ${candidate.modelId}@${candidate.revision}, ${candidate.dimensions}d, cache ${status}`
    );
  }
  lines.push(
    "",
    "Execution requires --run --adapter-module <path>. A cache miss additionally requires --allow-downloads.",
    "The harness never selects or activates a candidate."
  );
  return `${lines.join("\n")}\n`;
}

/** Verifies every present cache and denies misses before importing adapter code. */
async function preflightExecutionCaches(
  configuration: CandidateConfiguration,
  cacheRoot: string,
  allowDownloads: boolean
): Promise<void> {
  for (const candidate of configuration.candidates) {
    const cachePath = path.resolve(cacheRoot, candidate.offlineCachePath);
    let cacheExists = true;
    try {
      await access(cachePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      cacheExists = false;
    }
    assertExecutionPolicy({ run: true, allowDownloads, cacheExists });
    if (cacheExists) {
      await verifyCacheArtifact(cachePath, candidate.artifactChecksum);
    }
  }
}

/** Loads the explicitly supplied adapter only after execution consent is valid. */
async function loadAdapterFactory(
  modulePath: string
): Promise<EmbeddingAdapterFactory> {
  const imported = (await import(
    pathToFileURL(path.resolve(modulePath)).href
  )) as AdapterModule;
  if (!imported.createEmbeddingAdapterFactory) {
    throw new Error(
      "Adapter module must export createEmbeddingAdapterFactory as a named function"
    );
  }
  return imported.createEmbeddingAdapterFactory();
}

/** Validates fixtures, defaults to a no-side-effect plan, and writes only on --run. */
async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(argv);
  const configuration =
    await readJsonFixture<CandidateConfiguration>("candidates.v1.json");
  const corpus = await readJsonFixture<BenchmarkCorpus>("corpus.v1.json");
  const questionSet =
    await readJsonFixture<BenchmarkQuestionSet>("questions.v1.json");
  validateCandidateConfiguration(configuration);
  validateBenchmarkFixtures(corpus, questionSet);

  if (!options.run) {
    process.stdout.write(await createDryRunSummary(configuration));
    return;
  }

  await preflightExecutionCaches(
    configuration,
    process.cwd(),
    options.allowDownloads
  );
  const report = await runBenchmark({
    configuration,
    corpus,
    questionSet,
    adapterFactory: await loadAdapterFactory(options.adapterModule!),
    cacheRoot: process.cwd(),
    run: true,
    allowDownloads: options.allowDownloads,
  });
  await mkdir(options.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(options.outputDirectory, "comparison.json"),
      createJsonReport(report),
      "utf8"
    ),
    writeFile(
      path.join(options.outputDirectory, "comparison.md"),
      createMarkdownReport(report),
      "utf8"
    ),
  ]);
  process.stdout.write(
    `Wrote comparison artifacts to ${options.outputDirectory}; no candidate was selected or activated.\n`
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

export {
  createDryRunSummary,
  loadAdapterFactory,
  main,
  parseCliOptions,
  preflightExecutionCaches,
  readJsonFixture,
};
