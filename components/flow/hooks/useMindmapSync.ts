"use client";

import { useMutation } from "convex/react";
import { useEffect } from "react";

import { api } from "@/convex/_generated/api";

import { useMindmapStoreApi } from "../providers/MindmapFlowProvider";

const DEBOUNCE_MS = 1_500;
const MAX_WAIT_MS = 5_000;
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

/** Converts an unknown mutation failure into the store's display-safe text. */
function getSyncErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to save mindmap";
}

/**
 * Flushes recorded canvas operations to Convex with bounded retry backoff.
 *
 * Browser lifecycle events can only start the async mutation; Convex does not
 * expose a beacon-compatible transport. The persistent dirty/error state is
 * therefore the source of truth when a page closes before the request settles.
 */
function useMindmapSync(): void {
  const store = useMindmapStoreApi();
  const applyOps = useMutation(api.ops.apply);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;
    let isFlushing = false;
    let isRestoring = false;
    let isDisposed = false;

    /** Clears trailing and max-wait timers for the current mutation burst. */
    const clearBurstTimers = () => {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      if (maxWaitTimer !== undefined) clearTimeout(maxWaitTimer);
      debounceTimer = undefined;
      maxWaitTimer = undefined;
    };

    /** Drains and sends the current queue, restoring it on mutation failure. */
    const flush = async (): Promise<void> => {
      if (isFlushing || isDisposed) return;

      clearBurstTimers();
      const batch = store.getState().actions.drainPendingOps();

      if (batch === null) return;

      isFlushing = true;
      store.getState().actions.markSyncState("saving");

      try {
        await applyOps({
          mindmapId: store.getState().mindmapDB._id,
          ops: batch.ops,
          description: batch.description,
          source: "user",
        });
        consecutiveFailures = 0;

        if (store.getState().pendingOps.length === 0) {
          store.getState().actions.markSyncState("idle");
        } else {
          store.getState().actions.markSyncState("dirty");
          schedulePending();
        }
      } catch (error) {
        // Edits made during the failed request may already have timers. Keep
        // the restored combined queue behind the explicit retry backoff.
        clearBurstTimers();
        isRestoring = true;
        store.getState().actions.restorePendingOps(batch.ops);
        isRestoring = false;
        consecutiveFailures += 1;
        store
          .getState()
          .actions.markSyncState("error", getSyncErrorMessage(error));

        const retryDelay = RETRY_DELAYS_MS[consecutiveFailures - 1];
        if (retryDelay !== undefined) {
          retryTimer = setTimeout(() => void flush(), retryDelay);
        }
      } finally {
        isFlushing = false;
      }
    };

    /** Schedules trailing and maximum-wait flushes for pending user edits. */
    function schedulePending(): void {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void flush(), DEBOUNCE_MS);
      maxWaitTimer ??= setTimeout(() => void flush(), MAX_WAIT_MS);
    }

    const unsubscribe = store.subscribe((state, previousState) => {
      if (
        state.pendingOps === previousState.pendingOps ||
        state.pendingOps.length === 0 ||
        isRestoring
      ) {
        return;
      }

      // A fresh canvas mutation releases a queue held after three retries.
      consecutiveFailures = 0;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      state.actions.markSyncState("dirty");
      schedulePending();
    });

    /** Starts the only best-effort flush available during browser teardown. */
    const flushBeforeExit = () => {
      void flush();
    };

    window.addEventListener("beforeunload", flushBeforeExit);
    window.addEventListener("pagehide", flushBeforeExit);

    if (store.getState().pendingOps.length > 0) {
      schedulePending();
    }

    return () => {
      isDisposed = true;
      unsubscribe();
      clearBurstTimers();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      window.removeEventListener("beforeunload", flushBeforeExit);
      window.removeEventListener("pagehide", flushBeforeExit);
    };
  }, [applyOps, store]);
}

export { getSyncErrorMessage, useMindmapSync };
