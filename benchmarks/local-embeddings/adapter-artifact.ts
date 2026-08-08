import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { readBoundedFile, verifyCacheArtifact } from "./cache.ts";
import { inspectConfinedPath, validateRelativePath } from "./paths.ts";
import type {
  CandidateConfiguration,
  VerifiedAdapterArtifact,
} from "./types.ts";
import { validateCandidateConfiguration } from "./validation.ts";

type AdapterArtifactPreflight = {
  candidateKey: string;
  absoluteModulePath: string;
  verified: VerifiedAdapterArtifact;
};

const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const versionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
const adapterManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  moduleChecksum: checksumSchema,
  adapter: z.strictObject({
    id: z.string().trim().min(1),
    version: versionSchema,
    revision: z.string().regex(/^[a-f0-9]{40,64}$/),
  }),
  runtime: z.strictObject({
    id: z.string().trim().min(1),
    version: versionSchema,
  }),
  preprocessing: z.strictObject({
    id: z.string().trim().min(1),
    version: versionSchema,
    pooling: z.enum(["mean", "cls", "last-token"]),
    normalize: z.boolean(),
    queryPrefix: z.string(),
    documentPrefix: z.string(),
  }),
});

/** Verifies confined adapter bytes and derives identity only from its manifest. */
async function preflightAdapterArtifacts(options: {
  configuration: CandidateConfiguration;
  workspaceRoot: string;
  adapterRootRelative: string;
  suppliedModulePath: string;
}): Promise<AdapterArtifactPreflight[]> {
  const configuration = validateCandidateConfiguration(options.configuration);
  validateRelativePath(options.suppliedModulePath, "--adapter-module");
  const preflights: AdapterArtifactPreflight[] = [];
  for (const candidate of configuration.candidates) {
    if (candidate.adapter.modulePath !== options.suppliedModulePath) {
      throw new Error(
        `Supplied adapter module does not match pinned path for ${candidate.key}`
      );
    }
    const moduleInspection = await inspectConfinedPath(
      options.workspaceRoot,
      options.adapterRootRelative,
      candidate.adapter.modulePath
    );
    const manifestInspection = await inspectConfinedPath(
      options.workspaceRoot,
      options.adapterRootRelative,
      candidate.adapter.manifestPath
    );
    if (!moduleInspection.exists || moduleInspection.kind !== "file") {
      throw new Error(
        `Pinned adapter module is missing: ${candidate.adapter.modulePath}`
      );
    }
    if (!manifestInspection.exists || manifestInspection.kind !== "file") {
      throw new Error(
        `Pinned adapter manifest is missing: ${candidate.adapter.manifestPath}`
      );
    }

    const moduleMetadata = await verifyCacheArtifact(
      moduleInspection.path,
      candidate.adapter.artifactChecksum,
      configuration.adapterLimits
    );
    const manifestMetadata = await verifyCacheArtifact(
      manifestInspection.path,
      candidate.adapter.manifestChecksum,
      configuration.adapterLimits
    );
    const manifest = adapterManifestSchema.parse(
      JSON.parse(
        (
          await readBoundedFile(
            manifestInspection.path,
            configuration.adapterLimits.maxBytes
          )
        ).toString("utf8")
      )
    );
    const expectedAdapter = {
      id: candidate.adapter.id,
      version: candidate.adapter.version,
      revision: candidate.adapter.revision,
    };
    if (
      manifest.moduleChecksum !== moduleMetadata.checksum ||
      !isDeepStrictEqual(manifest.adapter, expectedAdapter) ||
      !isDeepStrictEqual(manifest.runtime, candidate.runtime) ||
      !isDeepStrictEqual(manifest.preprocessing, candidate.preprocessing)
    ) {
      throw new Error(
        `Adapter manifest identity mismatch for ${candidate.key}`
      );
    }
    preflights.push({
      candidateKey: candidate.key,
      absoluteModulePath: moduleInspection.path,
      verified: {
        status: "verified",
        modulePath: candidate.adapter.modulePath,
        moduleChecksum: moduleMetadata.checksum,
        manifestPath: candidate.adapter.manifestPath,
        manifestChecksum: manifestMetadata.checksum,
        adapter: manifest.adapter,
        runtime: manifest.runtime,
        preprocessing: manifest.preprocessing,
      },
    });
  }
  return preflights;
}

/** Invokes execution only after all configured artifacts pass byte verification. */
async function executeWithVerifiedAdapterArtifacts<T>(
  options: Parameters<typeof preflightAdapterArtifacts>[0],
  execute: (preflights: AdapterArtifactPreflight[]) => Promise<T>
): Promise<T> {
  const preflights = await preflightAdapterArtifacts(options);
  return execute(preflights);
}

export {
  type AdapterArtifactPreflight,
  adapterManifestSchema,
  executeWithVerifiedAdapterArtifacts,
  preflightAdapterArtifacts,
};
