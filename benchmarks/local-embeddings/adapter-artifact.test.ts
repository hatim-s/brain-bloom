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
import type { CandidateConfiguration } from "./types.ts";

const sha256 = (contents: string) =>
  `sha256:${createHash("sha256").update(contents).digest("hex")}`;
const moduleContents =
  'export const createEmbeddingAdapterFactory = () => ({ marker: "verified" });\n';

/** Creates two candidates pinned to the same module and distinct signed manifests. */
async function createFixture() {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "adapter-preflight-")
  );
  const adapterRootRelative = "adapters";
  const bundle = path.join(workspaceRoot, adapterRootRelative, "bundle");
  await mkdir(bundle, { recursive: true });
  await writeFile(path.join(bundle, "adapter.mjs"), moduleContents);
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
    JSON.stringify({ schemaVersion: 1, moduleChecksum, ...common })
  );
  await Promise.all(
    manifests.map((contents, index) =>
      writeFile(path.join(bundle, `${index}.json`), contents)
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
      },
      runtime: common.runtime,
      preprocessing: common.preprocessing,
    })),
  };
  return { workspaceRoot, adapterRootRelative, configuration };
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
      preflight.verified.moduleChecksum
    );

    expect((factory as unknown as { marker: string }).marker).toBe("verified");
    await expect(
      preflightAdapterArtifacts({
        ...fixture,
        suppliedModulePath: "bundle/adapter.mjs",
      })
    ).rejects.toThrow(/checksum mismatch/);
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
