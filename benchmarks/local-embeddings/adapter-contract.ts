import type { AdapterExecutionEvidence } from "./types.ts";

const SUPPORTED_ADAPTER_NODE_BUILTINS = ["node:crypto"] as const;
const SANDBOX_SMOKE_EXECUTION_EVIDENCE = {
  modelArtifactAccess: "none",
  evidenceClass: "sandbox-smoke-only",
  selectionEligibility: "invalid",
  selectionIneligibilityReason: "no-model-artifact-capability",
} as const satisfies AdapterExecutionEvidence;

/** Identifies built-ins with an audited sandbox facade for this contract version. */
function isSupportedAdapterNodeBuiltin(specifier: string): boolean {
  return SUPPORTED_ADAPTER_NODE_BUILTINS.some(
    (supported) => supported === specifier
  );
}

export {
  isSupportedAdapterNodeBuiltin,
  SANDBOX_SMOKE_EXECUTION_EVIDENCE,
  SUPPORTED_ADAPTER_NODE_BUILTINS,
};
