import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { executeWithVerifiedAdapterArtifacts } from "./adapter-artifact.ts";
import { executeCandidateInFreshProcess } from "./candidate-process.ts";
import {
  ensureConfinedDirectory,
  inspectConfinedPath,
  safeWriteFile,
  validateRelativePath,
} from "./paths.ts";
import { validateCliDownloadFlags } from "./policy.ts";
import { createJsonReport, createMarkdownReport } from "./report.ts";
import { preflightCandidateCaches, runBenchmarkIsolated } from "./runner.ts";
import {
  validateBenchmarkFixtures,
  validateCandidateConfiguration,
} from "./validation.ts";

type CliOptions = {
  run: boolean;
  allowDownloads: boolean;
  adapterModule?: string;
  outputDirectoryRelative: string;
};

type DryRunMetadataInspector = typeof inspectConfinedPath;

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT_RELATIVE = ".cache/local-embeddings";
const ADAPTER_ROOT_RELATIVE = ".cache/local-embedding-adapters";
const REPORT_ROOT_RELATIVE = "benchmarks/local-embeddings/results";

/** Parses the intentionally small dry-run-first command line. */
function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    run: false,
    allowDownloads: false,
    outputDirectoryRelative: "latest",
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
      validateRelativePath(value, "--adapter-module");
      options.adapterModule = value;
      index += 1;
    } else if (argument === "--output-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--output-dir requires a relative directory path");
      }
      validateRelativePath(value, "--output-dir");
      options.outputDirectoryRelative = value;
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

/** Parses fixture text with a stable actionable error before schema validation. */
function parseJsonFixture(contents: string, filename: string): unknown {
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`Fixture ${filename} is not valid JSON`);
  }
}

/** Reads JSON as unknown so callers must perform complete runtime validation. */
async function readJsonFixture(filename: string): Promise<unknown> {
  return parseJsonFixture(
    await readFile(path.join(benchmarkDirectory, filename), "utf8"),
    filename
  );
}

/** Reports lstat-only cache readiness without opening or hashing artifact contents. */
async function createDryRunSummary(
  configurationInput: unknown,
  workspaceRoot = process.cwd(),
  inspectMetadata: DryRunMetadataInspector = inspectConfinedPath
): Promise<string> {
  const configuration = validateCandidateConfiguration(configurationInput);
  const lines = [
    "Local embedding benchmark dry run",
    "No cache contents or model code were opened; network downloads are denied.",
    "",
  ];
  for (const candidate of configuration.candidates) {
    const metadata = await inspectMetadata(
      workspaceRoot,
      CACHE_ROOT_RELATIVE,
      candidate.offlineCachePath
    );
    const status = metadata.exists
      ? `${metadata.kind} exists (entry metadata ${metadata.size} bytes; checksum not read)`
      : "missing";
    lines.push(
      `- ${candidate.key}: ${candidate.modelId}@${candidate.revision}, ${candidate.dimensions}d, cache ${status}`
    );
  }
  lines.push(
    "",
    "Execution requires --run --adapter-module <path>. A cache miss additionally requires --allow-downloads.",
    "Content checksums are verified only during approved execution preflight.",
    "Contract v1 execution is sandbox-smoke-only and invalid for model selection; it cannot access model cache bytes.",
    "The harness never selects or activates a candidate."
  );
  return `${lines.join("\n")}\n`;
}

/** Validates fixtures, defaults to metadata-only status, and writes safely on --run. */
async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(argv);
  const configuration = validateCandidateConfiguration(
    await readJsonFixture("candidates.v1.json")
  );
  const fixtures = validateBenchmarkFixtures(
    await readJsonFixture("corpus.v1.json"),
    await readJsonFixture("questions.v1.json")
  );
  const workspaceRoot = process.cwd();

  if (!options.run) {
    process.stdout.write(
      await createDryRunSummary(configuration, workspaceRoot)
    );
    return;
  }

  // Byte verification happens before arbitrary adapter-module code is imported.
  await preflightCandidateCaches({
    configuration,
    workspaceRoot,
    cacheRootRelative: CACHE_ROOT_RELATIVE,
    run: true,
    allowDownloads: options.allowDownloads,
  });
  const adapterModule = options.adapterModule;
  if (!adapterModule)
    throw new Error("Adapter module is required for execution");
  const report = await executeWithVerifiedAdapterArtifacts(
    {
      configuration,
      workspaceRoot,
      adapterRootRelative: ADAPTER_ROOT_RELATIVE,
      suppliedModulePath: adapterModule,
    },
    (adapterPreflights) =>
      runBenchmarkIsolated({
        configuration,
        corpus: fixtures.corpus,
        questionSet: fixtures.questionSet,
        verifiedAdapters: adapterPreflights.map((entry) => entry.verified),
        absoluteModulePaths: adapterPreflights.map(
          (entry) => entry.absoluteModulePath
        ),
        adapterRootRelative: ADAPTER_ROOT_RELATIVE,
        executeCandidate: executeCandidateInFreshProcess,
        workspaceRoot,
        cacheRootRelative: CACHE_ROOT_RELATIVE,
        run: true,
        allowDownloads: options.allowDownloads,
      })
  );
  const outputDirectory = await ensureConfinedDirectory(
    workspaceRoot,
    REPORT_ROOT_RELATIVE,
    options.outputDirectoryRelative
  );
  await Promise.all([
    safeWriteFile(outputDirectory, "comparison.json", createJsonReport(report)),
    safeWriteFile(
      outputDirectory,
      "comparison.md",
      createMarkdownReport(report)
    ),
  ]);
  process.stdout.write(
    `Wrote comparison artifacts beneath ${REPORT_ROOT_RELATIVE}/${options.outputDirectoryRelative}; no candidate was selected or activated.\n`
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
  ADAPTER_ROOT_RELATIVE,
  CACHE_ROOT_RELATIVE,
  createDryRunSummary,
  main,
  parseCliOptions,
  parseJsonFixture,
  readJsonFixture,
  REPORT_ROOT_RELATIVE,
};
