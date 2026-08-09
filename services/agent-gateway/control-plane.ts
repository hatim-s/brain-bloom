type ControlPlaneOperationContext = Readonly<{
  signal: AbortSignal;
  deadlineAtMilliseconds: number;
}>;

type ControlPlaneOutcome<T> =
  | Readonly<{ status: "fulfilled"; value: T }>
  | Readonly<{ status: "rejected"; error: unknown }>
  | Readonly<{ status: "aborted" }>
  | Readonly<{ status: "timed_out" }>;

const SKIPPED_OPERATION = Symbol("skipped control-plane operation");

/**
 * Awaits one control-plane dependency behind a finite deadline and caller abort.
 *
 * The operation always receives a derived, reason-free signal. Late resolution
 * or rejection remains observed after this function settles, while the caller's
 * abort listener and deadline timer are removed by one idempotent settle path.
 */
function awaitControlPlaneOperation<T>(
  operation: (context: ControlPlaneOperationContext) => T | PromiseLike<T>,
  timeoutMs: number,
  requestSignal?: AbortSignal
): Promise<ControlPlaneOutcome<T>> {
  const operationController = new AbortController();
  const deadlineAtMilliseconds = Date.now() + timeoutMs;

  return new Promise<ControlPlaneOutcome<T>>((resolve) => {
    let settled = false;
    const finish = (
      outcome: ControlPlaneOutcome<T>,
      cancelOperation: boolean
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", handleRequestAbort);
      if (cancelOperation) operationController.abort();
      resolve(outcome);
    };
    const handleRequestAbort = (): void => {
      finish({ status: "aborted" }, true);
    };

    const timeout = setTimeout(() => {
      finish({ status: "timed_out" }, true);
    }, timeoutMs);
    requestSignal?.addEventListener("abort", handleRequestAbort, {
      once: true,
    });

    if (requestSignal?.aborted) {
      handleRequestAbort();
    }

    // The state check closes the same queued-microtask race as provider handoff:
    // an already aborted request never calls the dependency at all.
    Promise.resolve()
      .then(() => {
        if (settled) return SKIPPED_OPERATION;
        return operation(
          Object.freeze({
            signal: operationController.signal,
            deadlineAtMilliseconds,
          })
        );
      })
      .then(
        (value) => {
          if (value !== SKIPPED_OPERATION) {
            finish({ status: "fulfilled", value: value as T }, false);
          }
        },
        (error: unknown) => {
          // This handler remains attached after timeout/abort, so a late store
          // rejection is observed and cannot become an unhandled rejection.
          finish({ status: "rejected", error }, false);
        }
      );
  });
}

export {
  awaitControlPlaneOperation,
  type ControlPlaneOperationContext,
  type ControlPlaneOutcome,
};
