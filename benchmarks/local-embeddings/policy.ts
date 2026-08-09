type ExecutionPolicy = {
  run: boolean;
  allowDownloads: boolean;
  cacheExists: boolean;
};

/** Enforces dry-run-first execution and explicit human download authorization. */
function assertExecutionPolicy(policy: ExecutionPolicy): void {
  if (!policy.run) {
    throw new Error("Embedding execution requires the explicit --run flag");
  }
  if (!policy.cacheExists && !policy.allowDownloads) {
    throw new Error(
      "Offline cache is missing; downloads remain denied without both --run and --allow-downloads"
    );
  }
}

/** Rejects a download flag that could otherwise look effective in dry-run mode. */
function validateCliDownloadFlags(run: boolean, allowDownloads: boolean): void {
  if (allowDownloads && !run) {
    throw new Error("--allow-downloads is valid only together with --run");
  }
}

export {
  assertExecutionPolicy,
  type ExecutionPolicy,
  validateCliDownloadFlags,
};
