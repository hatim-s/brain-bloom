import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonReport, createMarkdownReport } from "./report.ts";
import { runBenchmarkIsolated, runSingleCandidate } from "./runner.ts";
import type {
  BenchmarkClock,
  BenchmarkCorpus,
  BenchmarkQuestionSet,
  CandidateConfiguration,
  EmbeddingAdapterFactory,
  RuntimeProbe,
  VerifiedAdapterArtifact,
} from "./types.ts";
import { validateBenchmarkReport } from "./validation.ts";

let workspaceRoot = "";
const cacheRootRelative = "cache";
const artifactContents = "deterministic fake model artifact";
const artifactChecksum = `sha256:${createHash("sha256").update(artifactContents).digest("hex")}`;
const adapterChecksum = `sha256:${"d".repeat(64)}`;
const manifestChecksum = `sha256:${"e".repeat(64)}`;
const dimensions = 72;

const configuration: CandidateConfiguration = {
  schemaVersion: 1,
  budgets: {
    maxColdLoadMs: 100,
    maxWarmQueryP95Ms: 100,
    minIngestionSegmentsPerSecond: 1,
    maxResidentMemoryMb: 10,
    maxCacheBytes: 1_000,
  },
  cacheLimits: { maxBytes: 1_000, maxFiles: 10, maxDepth: 2 },
  adapterLimits: { maxBytes: 1_000, maxFiles: 4, maxDepth: 2 },
  measurement: { warmQueryPasses: 2, candidateTimeoutMs: 1000 },
  candidates: ["a", "b"].map((key) => ({
    key: `candidate-${key}`,
    modelId: `local/candidate-${key}`,
    revision: key.repeat(40),
    dimensions,
    artifactChecksum,
    offlineCachePath: `candidate-${key}.bin`,
    adapter: {
      id: "fake-adapter",
      version: "1.0.0",
      revision: "c".repeat(40),
      modulePath: "bundle/adapter.mjs",
      artifactChecksum: adapterChecksum,
      manifestPath: `bundle/${key}.json`,
      manifestChecksum,
      bundle: {
        format: "self-contained-esm-bundle/v1",
        executionBoundary: "node-vm-source-text-module/v1",
        allowedNodeBuiltins: [],
      },
    },
    runtime: { id: "fake-runtime", version: "1.0.0" },
    preprocessing: {
      id: "fake-preprocessing",
      version: "1.0.0",
      pooling: "mean" as const,
      normalize: true,
      queryPrefix: "query: ",
      documentPrefix: "document: ",
    },
  })),
};

const specialSources = [
  {
    sourceId: "alpha",
    ownerId: "owner-alpha",
    scopeId: "scope-alpha",
    logicalSourceId: "alpha",
    version: "1",
    active: true,
    retrievable: true,
    scenario: "representative" as const,
  },
  {
    sourceId: "beta",
    ownerId: "owner-beta",
    scopeId: "scope-beta",
    logicalSourceId: "beta",
    version: "1",
    active: true,
    retrievable: true,
    scenario: "cross-owner" as const,
  },
  {
    sourceId: "other-scope",
    ownerId: "owner-alpha",
    scopeId: "scope-other",
    logicalSourceId: "other",
    version: "1",
    active: true,
    retrievable: true,
    scenario: "out-of-scope" as const,
  },
  {
    sourceId: "old",
    ownerId: "owner-study",
    scopeId: "scope-core",
    logicalSourceId: "revision",
    version: "1",
    active: false,
    retrievable: true,
    scenario: "inactive-version" as const,
  },
  {
    sourceId: "current",
    ownerId: "owner-study",
    scopeId: "scope-core",
    logicalSourceId: "revision",
    version: "2",
    active: true,
    retrievable: true,
    scenario: "representative" as const,
  },
  {
    sourceId: "malformed",
    ownerId: "owner-study",
    scopeId: "scope-core",
    logicalSourceId: "malformed",
    version: "1",
    active: true,
    retrievable: false,
    scenario: "malformed" as const,
  },
  {
    sourceId: "limit",
    ownerId: "owner-study",
    scopeId: "scope-core",
    logicalSourceId: "limit",
    version: "1",
    active: true,
    retrievable: false,
    scenario: "limit" as const,
  },
];
const corpus: BenchmarkCorpus = {
  schemaVersion: 1,
  multilingual: { required: false, languages: ["en"] },
  sources: [
    {
      sourceId: "main",
      ownerId: "owner-study",
      scopeId: "scope-core",
      logicalSourceId: "main",
      version: "1",
      active: true,
      retrievable: true,
      scenario: "representative",
    },
    ...specialSources,
  ],
  segments: [
    ...Array.from({ length: 63 }, (_, index) => ({
      id: `segment-${index}`,
      sourceId: index >= 30 && index < 50 ? "alpha" : "main",
      format: (["pdf", "docx", "pptx"] as const)[index % 3],
      locator: `locator ${index}`,
      text: `study segment ${index}`,
      language: "en",
    })),
    {
      id: "alpha-segment",
      sourceId: "alpha",
      format: "pdf" as const,
      locator: "alpha",
      text: "alpha cedar",
      language: "en",
    },
    {
      id: "beta-segment",
      sourceId: "beta",
      format: "pdf" as const,
      locator: "beta",
      text: "beta cedar",
      language: "en",
    },
    {
      id: "other-segment",
      sourceId: "other-scope",
      format: "pdf" as const,
      locator: "other",
      text: "other cedar",
      language: "en",
    },
    {
      id: "old-segment",
      sourceId: "old",
      format: "docx" as const,
      locator: "old",
      text: "old ruby",
      language: "en",
    },
    {
      id: "current-segment",
      sourceId: "current",
      format: "docx" as const,
      locator: "current",
      text: "current emerald",
      language: "en",
    },
    {
      id: "malformed-segment",
      sourceId: "malformed",
      format: "pdf" as const,
      locator: "malformed",
      text: "malformed excluded",
      language: "en",
    },
    {
      id: "limit-segment",
      sourceId: "limit",
      format: "pdf" as const,
      locator: "limit",
      text: "limit excluded",
      language: "en",
    },
  ],
};
const categories = [
  "headings",
  "definitions",
  "slide-bullets",
  "paraphrases",
] as const;
const questionSet: BenchmarkQuestionSet = {
  schemaVersion: 1,
  qualityContext: {
    ownerId: "owner-study",
    scopeId: "scope-core",
    scenario: "retrieval-quality",
  },
  questions: Array.from({ length: 30 }, (_, index) => ({
    id: `question-${index}`,
    text: `study segment ${index}`,
    category: categories[index % categories.length],
    language: "en",
    relevantSegmentIds: [`segment-${index}`],
  })),
  integrityQuestions: [
    {
      id: "cross",
      text: "alpha cedar",
      language: "en",
      ownerId: "owner-alpha",
      scopeId: "scope-alpha",
      scenario: "cross-owner",
      expectedSegmentIds: ["alpha-segment"],
      forbiddenSegmentIds: ["beta-segment"],
    },
    {
      id: "scope",
      text: "alpha cedar",
      language: "en",
      ownerId: "owner-alpha",
      scopeId: "scope-alpha",
      scenario: "out-of-scope",
      expectedSegmentIds: ["alpha-segment"],
      forbiddenSegmentIds: ["other-segment"],
    },
    {
      id: "version",
      text: "current emerald",
      language: "en",
      ownerId: "owner-study",
      scopeId: "scope-core",
      scenario: "inactive-version",
      expectedSegmentIds: ["current-segment"],
      forbiddenSegmentIds: ["old-segment"],
    },
    {
      id: "adversarial",
      text: "study segment 20",
      language: "en",
      ownerId: "owner-study",
      scopeId: "scope-core",
      scenario: "adversarial",
      expectedSegmentIds: ["segment-20"],
      forbiddenSegmentIds: [],
    },
    {
      id: "malformed",
      text: "malformed excluded",
      language: "en",
      ownerId: "owner-study",
      scopeId: "scope-core",
      scenario: "malformed",
      expectedSegmentIds: [],
      forbiddenSegmentIds: ["malformed-segment"],
    },
    {
      id: "limit",
      text: "limit excluded",
      language: "en",
      ownerId: "owner-study",
      scopeId: "scope-core",
      scenario: "limit",
      expectedSegmentIds: [],
      forbiddenSegmentIds: ["limit-segment"],
    },
  ],
};

const textVectorIndex = new Map(
  corpus.segments.map((segment, index) => [segment.text, index])
);
const sourcesById = new Map(
  corpus.sources.map((source) => [source.sourceId, source] as const)
);
/** Produces explicit content and eligibility signals for scoped fake retrieval. */
function fakeVector(text: string, role: "document" | "query"): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const segmentIndex = textVectorIndex.get(text);
  const negativeIntegrityQuery =
    role === "query" &&
    (text === "malformed excluded" || text === "limit excluded");
  if (segmentIndex !== undefined && !negativeIntegrityQuery)
    vector[segmentIndex] = 2;
  if (role === "document" && segmentIndex !== undefined) {
    const segment = corpus.segments[segmentIndex];
    const source = sourcesById.get(segment.sourceId)!;
    if (source.active && source.retrievable) {
      if (source.ownerId === "owner-study" && source.scopeId === "scope-core")
        vector[70] = 1;
      if (source.ownerId === "owner-alpha" && source.scopeId === "scope-alpha")
        vector[71] = 1;
    }
  } else if (role === "query") {
    vector[text === "alpha cedar" ? 71 : 70] = 1;
  }
  return vector;
}

/** Creates a deterministic absolute/high-water RSS probe for CI. */
function createRuntimeProbe(marker = 100): RuntimeProbe {
  return {
    environment: () => ({
      platform: "test",
      architecture: "test-arch",
      nodeVersion: "v-test",
      cpuModel: "deterministic-cpu",
      cpuCount: 1,
    }),
    residentMemoryBytes: () => marker,
    peakResidentMemoryBytes: () => 150,
  };
}

/** Creates the deterministic role-aware fake adapter used by CI. */
function createAdapterFactory(
  events: string[] = [],
  advance: (amount: number) => void = () => undefined
): EmbeddingAdapterFactory {
  return {
    create: async (candidate) => {
      events.push(`create:${candidate.key}`);
      advance(10);
      return {
        identity: {
          adapter: {
            id: candidate.adapter.id,
            version: candidate.adapter.version,
            revision: candidate.adapter.revision,
          },
          runtime: candidate.runtime,
          preprocessing: candidate.preprocessing,
        },
        load: async () => {
          events.push(`load:${candidate.key}`);
          advance(20);
        },
        embed: async (texts, role) => {
          events.push(`embed:${role}:${texts[0]}`);
          advance(1);
          return texts.map((text) => fakeVector(text, role));
        },
      };
    },
  };
}

function verifiedFor(index: number): VerifiedAdapterArtifact {
  const candidate = configuration.candidates[index];
  return {
    status: "verified",
    modulePath: candidate.adapter.modulePath,
    moduleChecksum: candidate.adapter.artifactChecksum,
    manifestPath: candidate.adapter.manifestPath,
    manifestChecksum: candidate.adapter.manifestChecksum,
    adapter: {
      id: candidate.adapter.id,
      version: candidate.adapter.version,
      revision: candidate.adapter.revision,
    },
    bundle: candidate.adapter.bundle,
    runtime: candidate.runtime,
    preprocessing: candidate.preprocessing,
  };
}

/** Runs one fully offline candidate with fake embeddings. */
async function runFakeCandidate(
  index = 0,
  memoryMode: "isolated" | "in-process-test" = "isolated",
  factory = createAdapterFactory(),
  clock?: BenchmarkClock
) {
  return runSingleCandidate({
    configuration,
    corpus,
    questionSet,
    candidateKey: configuration.candidates[index].key,
    verifiedAdapter: verifiedFor(index),
    adapterFactory: factory,
    workspaceRoot,
    cacheRootRelative,
    run: true,
    allowDownloads: false,
    memoryMode,
    runtimeProbe: createRuntimeProbe(),
    clock,
  });
}

describe("local embedding benchmark runner", () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sprig-runner-"));
    await mkdir(path.join(workspaceRoot, cacheRootRelative));
    await Promise.all(
      configuration.candidates.map((candidate) =>
        writeFile(
          path.join(
            workspaceRoot,
            cacheRootRelative,
            candidate.offlineCachePath
          ),
          artifactContents,
          "utf8"
        )
      )
    );
  });

  it("starts cold-load timing before a delayed factory and includes eager preflight", async () => {
    let time = 0;
    const clock: BenchmarkClock = { nowMs: () => time };
    const result = await runFakeCandidate(
      0,
      "isolated",
      createAdapterFactory([], (amount) => {
        time += amount;
      }),
      clock
    );
    expect(result.latency.coldLoadMs).toBe(33);
    expect(result.latency.coldQueryMs).toBe(1);
  });

  it("denies a cache miss before creating an adapter", async () => {
    const create = vi.fn(createAdapterFactory().create);
    await expect(
      runSingleCandidate({
        configuration: {
          ...configuration,
          candidates: configuration.candidates.map((candidate) => ({
            ...candidate,
            offlineCachePath: `missing-${candidate.key}`,
          })),
        },
        corpus,
        questionSet,
        candidateKey: "candidate-a",
        verifiedAdapter: verifiedFor(0),
        adapterFactory: { create },
        workspaceRoot,
        cacheRootRelative,
        run: true,
        allowDownloads: false,
        memoryMode: "isolated",
      })
    ).rejects.toThrow(/downloads remain denied/);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects self-reported identity drift before adapter load", async () => {
    const load = vi.fn(async () => undefined);
    const adapterFactory: EmbeddingAdapterFactory = {
      create: async (candidate) => ({
        identity: {
          adapter: {
            id: candidate.adapter.id,
            version: "9.9.9",
            revision: candidate.adapter.revision,
          },
          runtime: candidate.runtime,
          preprocessing: candidate.preprocessing,
        },
        load,
        embed: async (texts, role) =>
          texts.map((text) => fakeVector(text, role)),
      }),
    };
    await expect(
      runFakeCandidate(0, "isolated", adapterFactory)
    ).rejects.toThrow(/verified manifest/);
    expect(load).not.toHaveBeenCalled();
  });

  it("marks in-process fake memory invalid and non-budget-eligible", async () => {
    const result = await runFakeCandidate(0, "in-process-test");
    expect(result.resources.residentMemoryMeasurement).toBe(
      "invalid-in-process-test"
    );
    expect(result.budgets.residentMemoryMb.status).toBe("invalid");
  });

  it("uses a distinct isolated execution for each candidate in configured order", async () => {
    const calls: string[] = [];
    const probeMarkers = new Set<number>();
    const report = await runBenchmarkIsolated({
      configuration,
      corpus,
      questionSet,
      verifiedAdapters: [verifiedFor(0), verifiedFor(1)],
      absoluteModulePaths: ["/verified/a", "/verified/b"],
      adapterRootRelative: "adapters",
      workspaceRoot,
      cacheRootRelative,
      run: true,
      allowDownloads: false,
      executeCandidate: async (request) => {
        calls.push(request.candidateKey);
        const marker = calls.length * 100;
        probeMarkers.add(marker);
        return runSingleCandidate({
          ...request,
          adapterFactory: createAdapterFactory(),
          memoryMode: "isolated",
          runtimeProbe: createRuntimeProbe(marker),
        });
      },
      environment: createRuntimeProbe().environment(),
    });
    expect(calls).toEqual(["candidate-a", "candidate-b"]);
    expect(probeMarkers.size).toBe(2);
    expect(
      report.results.every(
        (result) =>
          result.resources.residentMemoryMeasurement ===
          "valid-isolated-process"
      )
    ).toBe(true);
  });

  it("produces deterministic validated JSON and reports verified integrity", async () => {
    const execute = async (
      request: Parameters<
        Parameters<typeof runBenchmarkIsolated>[0]["executeCandidate"]
      >[0]
    ) =>
      runSingleCandidate({
        ...request,
        adapterFactory: createAdapterFactory(),
        memoryMode: "isolated",
        runtimeProbe: createRuntimeProbe(),
        clock: {
          nowMs: (() => {
            let time = 0;
            return () => time++;
          })(),
        },
      });
    const options = {
      configuration,
      corpus,
      questionSet,
      verifiedAdapters: [verifiedFor(0), verifiedFor(1)],
      absoluteModulePaths: ["/a", "/b"],
      adapterRootRelative: "adapters",
      workspaceRoot,
      cacheRootRelative,
      run: true,
      allowDownloads: false,
      executeCandidate: execute,
      environment: createRuntimeProbe().environment(),
    };
    const first = await runBenchmarkIsolated(options);
    const second = await runBenchmarkIsolated(options);
    expect(createJsonReport(first)).toBe(createJsonReport(second));
    expect(first.results.every((result) => result.integrity.passed)).toBe(true);
    const markdown = createMarkdownReport(first);
    expect(markdown).toContain("Decision: **not selected**");
    expect(markdown).toContain("node-vm-source-text-module/v1");
    expect(() =>
      validateBenchmarkReport({
        ...first,
        results: first.results.map((result, index) =>
          index === 0
            ? { ...result, integrity: { ...result.integrity, passed: false } }
            : result
        ),
      })
    ).toThrow(/integrity gates/);
    expect(() =>
      validateBenchmarkReport({ ...first, decision: "selected" })
    ).toThrow();
  });
});
