import { createHash } from "node:crypto";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  executeWithVerifiedAdapterArtifacts,
  preflightAdapterArtifacts,
} from "./adapter-artifact.ts";
import { loadVerifiedAdapterFactory } from "./adapter-module.ts";
import type { AdapterBundleContract, CandidateConfiguration } from "./types.ts";

const sha256 = (contents: string) =>
  `sha256:${createHash("sha256").update(contents).digest("hex")}`;
const moduleContents = `
import { createHash } from "node:crypto";
class EmbeddedTokenizer {
  tokenize(input) { return input.trim().split(/\\s+/u); }
}
const tokenizer = new EmbeddedTokenizer();
const runtimeDigest = createHash("sha256").update("embedded-runtime-v1").digest("hex");
export const createEmbeddingAdapterFactory = () => ({
  async create() {
    return {
      identity: {
        adapter: { id: "adapter", version: "1.0.0", revision: "${"a".repeat(40)}" },
        runtime: { id: "runtime", version: "1.0.0" },
        preprocessing: {
          id: "prep", version: "1.0.0", pooling: "mean", normalize: true,
          queryPrefix: "query: ", documentPrefix: "document: "
        }
      },
      async load() {},
      async embed(texts, role) {
        return texts.map((text) => [
          tokenizer.tokenize(text).length,
          role === "query" ? 1 : 2,
          Number.parseInt(runtimeDigest.slice(0, 2), 16)
        ]);
      }
    };
  }
});
`;
const bundleContract = {
  format: "self-contained-esm-bundle/v1" as const,
  executionBoundary: "node-vm-source-text-module/v1" as const,
  allowedNodeBuiltins: ["node:crypto"],
  executionEvidence: {
    modelArtifactAccess: "none" as const,
    evidenceClass: "sandbox-smoke-only" as const,
    selectionEligibility: "invalid" as const,
    selectionIneligibilityReason: "no-model-artifact-capability" as const,
  },
};
const emptyBundleContract = {
  format: "self-contained-esm-bundle/v1" as const,
  executionBoundary: "node-vm-source-text-module/v1" as const,
  allowedNodeBuiltins: [],
  executionEvidence: bundleContract.executionEvidence,
};

/** Creates two candidates pinned to the same module and distinct signed manifests. */
async function createFixture() {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "adapter-preflight-")
  );
  const adapterRootRelative = "adapters";
  const bundleDirectory = path.join(
    workspaceRoot,
    adapterRootRelative,
    "bundle"
  );
  await mkdir(bundleDirectory, { recursive: true });
  await writeFile(path.join(bundleDirectory, "adapter.mjs"), moduleContents);
  const moduleChecksum = sha256(moduleContents);
  const common = {
    adapter: { id: "adapter", version: "1.0.0", revision: "a".repeat(40) },
    runtime: { id: "runtime", version: "1.0.0" },
    preprocessing: {
      id: "prep",
      version: "1.0.0",
      pooling: "mean" as const,
      normalize: true,
      queryPrefix: "query: ",
      documentPrefix: "document: ",
    },
  };
  const manifests = Array.from({ length: 2 }, () =>
    JSON.stringify({
      schemaVersion: 1,
      moduleChecksum,
      bundle: bundleContract,
      ...common,
    })
  );
  await Promise.all(
    manifests.map((contents, index) =>
      writeFile(path.join(bundleDirectory, `${index}.json`), contents)
    )
  );
  const configuration: CandidateConfiguration = {
    schemaVersion: 1,
    budgets: {
      maxColdLoadMs: 1,
      maxWarmQueryP95Ms: 1,
      minIngestionSegmentsPerSecond: 1,
      maxResidentMemoryMb: 1,
      maxCacheBytes: 10_000,
    },
    cacheLimits: { maxBytes: 10_000, maxFiles: 10, maxDepth: 2 },
    adapterLimits: { maxBytes: 10_000, maxFiles: 4, maxDepth: 2 },
    measurement: { warmQueryPasses: 2, candidateTimeoutMs: 1000 },
    candidates: ["a", "b"].map((candidateKey, index) => ({
      key: candidateKey,
      modelId: `model-${candidateKey}`,
      revision: candidateKey.repeat(40),
      dimensions: 3,
      artifactChecksum: `sha256:${"b".repeat(64)}`,
      offlineCachePath: `model-${candidateKey}`,
      adapter: {
        ...common.adapter,
        modulePath: "bundle/adapter.mjs",
        artifactChecksum: moduleChecksum,
        manifestPath: `bundle/${index}.json`,
        manifestChecksum: sha256(manifests[index]),
        bundle: bundleContract,
      },
      runtime: common.runtime,
      preprocessing: common.preprocessing,
    })),
  };
  return { workspaceRoot, adapterRootRelative, configuration };
}

/** Executes verified synthetic bytes through the measured sandbox create boundary. */
async function createAdapterFromSource(
  source: string,
  bundle: AdapterBundleContract = emptyBundleContract
) {
  const fixture = await createFixture();
  const factory = await loadVerifiedAdapterFactory(
    Buffer.from(source),
    sha256(source),
    bundle
  );
  return factory.create(fixture.configuration.candidates[0], {
    allowDownloads: false,
    offlineCachePath: "/verified/cache",
  });
}

describe("adapter artifact verification", () => {
  it("derives reported identity from bounded verified bytes", async () => {
    const fixture = await createFixture();
    const results = await preflightAdapterArtifacts({
      ...fixture,
      suppliedModulePath: "bundle/adapter.mjs",
    });
    expect(results).toHaveLength(2);
    expect(results[0].verified).toMatchObject({
      status: "verified",
      adapter: { id: "adapter" },
      runtime: { id: "runtime" },
    });
  });

  it("does not start execution when the module checksum is wrong", async () => {
    const fixture = await createFixture();
    const execute = vi.fn(async () => undefined);
    fixture.configuration.candidates[0].adapter.artifactChecksum = `sha256:${"0".repeat(64)}`;
    await expect(
      executeWithVerifiedAdapterArtifacts(
        { ...fixture, suppliedModulePath: "bundle/adapter.mjs" },
        execute
      )
    ).rejects.toThrow(/checksum mismatch/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes the verified module snapshot after its pathname is replaced", async () => {
    const fixture = await createFixture();
    const [preflight] = await preflightAdapterArtifacts({
      ...fixture,
      suppliedModulePath: "bundle/adapter.mjs",
    });
    await writeFile(
      preflight.absoluteModulePath,
      'export const createEmbeddingAdapterFactory = () => ({ marker: "replaced" });\n'
    );

    const factory = await loadVerifiedAdapterFactory(
      preflight.moduleBytes,
      preflight.verified.moduleChecksum,
      preflight.verified.bundle
    );

    const adapter = await factory.create(fixture.configuration.candidates[0], {
      allowDownloads: false,
      offlineCachePath: "/verified/cache",
    });
    await adapter.load();
    const digestPrefix = Number.parseInt(
      createHash("sha256")
        .update("embedded-runtime-v1")
        .digest("hex")
        .slice(0, 2),
      16
    );
    expect(await adapter.embed(["alpha  beta"], "query")).toEqual([
      [2, 1, digestPrefix],
    ]);
    expect(adapter.identity.adapter.id).toBe("adapter");
    await expect(
      preflightAdapterArtifacts({
        ...fixture,
        suppliedModulePath: "bundle/adapter.mjs",
      })
    ).rejects.toThrow(/checksum mismatch/);
  });

  it.each([
    [
      'import { pipeline } from "@xenova/transformers"; export const createEmbeddingAdapterFactory = () => ({});',
      /import "@xenova\/transformers" is forbidden/,
    ],
    [
      'import { tokenize } from "./tokenizer.js"; export const createEmbeddingAdapterFactory = () => ({ tokenize });',
      /import "\.\/tokenizer\.js" is forbidden/,
    ],
    [
      'import runtime from "file:///tmp/runtime.mjs"; export const createEmbeddingAdapterFactory = () => ({ runtime });',
      /import "file:\/\/\/tmp\/runtime\.mjs" is forbidden/,
    ],
    [
      'import { readFile } from "node:fs"; export const createEmbeddingAdapterFactory = () => ({ readFile });',
      /builtin "node:fs" is unsupported/,
    ],
    [
      'const runtime = require("onnxruntime-node"); export const createEmbeddingAdapterFactory = () => ({ runtime });',
      /require\(\) is forbidden/,
    ],
    [
      'export const createEmbeddingAdapterFactory = async () => import("file:///tmp/runtime.mjs");',
      /dynamic import\(\) is forbidden/,
    ],
  ])(
    "rejects an unbundled dependency before module execution",
    async (source, error) => {
      await expect(
        loadVerifiedAdapterFactory(
          Buffer.from(source),
          sha256(source),
          emptyBundleContract
        )
      ).rejects.toThrow(error);
    }
  );

  it("requires every supported Node builtin import to be declared", async () => {
    await expect(
      loadVerifiedAdapterFactory(
        Buffer.from(moduleContents),
        sha256(moduleContents),
        emptyBundleContract
      )
    ).rejects.toThrow(/"node:crypto" is not declared/);
  });

  it.each([
    `const escaped = process.getBuiltinModule("module").createRequire("/tmp/package.json");
     export const createEmbeddingAdapterFactory = () => escaped("zod");`,
    `const escaped = globalThis["pro" + "cess"].getBuiltinModule("module");
     export const createEmbeddingAdapterFactory = () => escaped;`,
    `const escaped = global["process"];
     export const createEmbeddingAdapterFactory = () => escaped;`,
    `const escaped = Function("return process")();
     export const createEmbeddingAdapterFactory = () => escaped;`,
    `const escaped = (0, eval)("process");
     export const createEmbeddingAdapterFactory = () => escaped;`,
    `const escaped = ({}).constructor.constructor("return process")();
     export const createEmbeddingAdapterFactory = () => escaped;`,
    `const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
     const escaped = AsyncFunction("return process")();
     export const createEmbeddingAdapterFactory = () => escaped;`,
    `const escaped = globalThis["Fun" + "ction"]("return process")();
     export const createEmbeddingAdapterFactory = () => escaped;`,
    `const escaped = Reflect.get(globalThis, "process").getBuiltinModule("module");
     export const createEmbeddingAdapterFactory = () => escaped;`,
    `const escaped = globalThis["fetch"]("https://example.invalid");
     export const createEmbeddingAdapterFactory = () => escaped;`,
    `const escaped = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
     export const createEmbeddingAdapterFactory = () => escaped;`,
  ])(
    "denies ambient and evaluator escape routes at runtime",
    async (source) => {
      await expect(createAdapterFromSource(source)).rejects.toThrow(
        /sandbox initialization failed/
      );
    }
  );

  it("does not expose host constructors through an allowed capability", async () => {
    const source = `
      import { createHash } from "node:crypto";
      const escaped = createHash.constructor("return process")();
      export const createEmbeddingAdapterFactory = () => escaped;
    `;
    await expect(
      createAdapterFromSource(source, bundleContract)
    ).rejects.toThrow(/sandbox initialization failed/);
  });

  it("awaits adapter thenables inside the locked context", async () => {
    const source = `
      export const createEmbeddingAdapterFactory = () => ({
        then(resolve) {
          resolve.constructor("return process")();
        }
      });
    `;
    await expect(createAdapterFromSource(source)).rejects.toThrow(
      /sandbox factory creation failed/
    );
  });

  it("JSON-clones factory inputs before invoking adapter code", async () => {
    const fixture = await createFixture();
    const source = `
      export const createEmbeddingAdapterFactory = () => ({
        async create(candidate) {
          candidate.constructor.constructor("return process")();
        }
      });
    `;
    const factory = await loadVerifiedAdapterFactory(
      Buffer.from(source),
      sha256(source),
      emptyBundleContract
    );
    await expect(
      factory.create(fixture.configuration.candidates[0], {
        allowDownloads: false,
        offlineCachePath: "/verified/cache",
      })
    ).rejects.toThrow(/sandbox adapter creation failed/);
  });

  it("rejects symlinked adapter entries and hard byte limits", async () => {
    const fixture = await createFixture();
    const modulePath = path.join(
      fixture.workspaceRoot,
      fixture.adapterRootRelative,
      "bundle",
      "adapter.mjs"
    );
    await writeFile(
      path.join(fixture.workspaceRoot, "outside.mjs"),
      moduleContents
    );
    await import("node:fs/promises").then(({ unlink }) => unlink(modulePath));
    await symlink(path.join(fixture.workspaceRoot, "outside.mjs"), modulePath);
    await expect(
      preflightAdapterArtifacts({
        ...fixture,
        suppliedModulePath: "bundle/adapter.mjs",
      })
    ).rejects.toThrow(/Symlink/);

    const bounded = await createFixture();
    bounded.configuration.adapterLimits.maxBytes = 2;
    await expect(
      preflightAdapterArtifacts({
        ...bounded,
        suppliedModulePath: "bundle/adapter.mjs",
      })
    ).rejects.toThrow(/maxBytes/);
  });
});
