const SUPPORTED_ADAPTER_NODE_BUILTINS = ["node:crypto"] as const;

/** Identifies built-ins with an audited sandbox facade for this contract version. */
function isSupportedAdapterNodeBuiltin(specifier: string): boolean {
  return SUPPORTED_ADAPTER_NODE_BUILTINS.some(
    (supported) => supported === specifier
  );
}

export { isSupportedAdapterNodeBuiltin, SUPPORTED_ADAPTER_NODE_BUILTINS };
