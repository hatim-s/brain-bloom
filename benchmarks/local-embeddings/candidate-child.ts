import { isDeepStrictEqual } from "node:util";

import { preflightAdapterArtifacts } from "./adapter-artifact.ts";
import { loadVerifiedAdapterFactory } from "./adapter-module.ts";
import type { CandidateProcessRequest } from "./runner.ts";
import { runSingleCandidate } from "./runner.ts";

/** Re-verifies executable bytes inside the isolated process before importing them. */
async function executeRequest(request: CandidateProcessRequest): Promise<void> {
  const preflights = await preflightAdapterArtifacts({
    configuration: request.configuration,
    workspaceRoot: request.workspaceRoot,
    adapterRootRelative: request.adapterRootRelative,
    suppliedModulePath: request.verifiedAdapter.modulePath,
  });
  const preflight = preflights.find(
    (entry) => entry.candidateKey === request.candidateKey
  );
  if (
    !preflight ||
    preflight.absoluteModulePath !== request.absoluteModulePath ||
    !isDeepStrictEqual(preflight.verified, request.verifiedAdapter)
  )
    throw new Error("Adapter artifact changed after parent preflight");
  const result = await runSingleCandidate({
    ...request,
    adapterFactory: await loadVerifiedAdapterFactory(
      preflight.moduleBytes,
      preflight.verified.moduleChecksum
    ),
    memoryMode: "isolated",
  });
  process.send?.({ ok: true, result });
}

if (process.argv.includes("--protocol-smoke")) {
  process.stdout.write("candidate-child-protocol-ready\n");
} else {
  process.once("message", (message: CandidateProcessRequest) => {
    executeRequest(message).catch((error: unknown) => {
      process.send?.({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    });
  });
}

export { executeRequest };
