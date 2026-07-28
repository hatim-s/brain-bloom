"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect } from "react";
import type { StoreApi } from "zustand";

import { api } from "@/convex/_generated/api";

import { describePendingOps, type NodeOp } from "../mindmap/pendingOps";
import { useMindmapStoreApi } from "../providers/MindmapFlowProvider";
import type { MindmapStore } from "../providers/store";

const DEBOUNCE_MS = 1_500;
const MAX_WAIT_MS = 5_000;
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 30_000] as const;

/**
 * Coordinates flush ownership across StrictMode effect instances per store.
 */
const flushPromises = new WeakMap<StoreApi<MindmapStore>, Promise<boolean>>();

type PendingRun = {
  count: number;
  ops: NodeOp[];
  source: NodeOp["source"];
};

/** Converts an unknown mutation failure into the store's display-safe text. */
function getSyncErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    return typeof error.data === "string"
      ? error.data
      : "The server rejected these changes";
  }

  return error instanceof Error ? error.message : "Failed to save mindmap";
}

/** Splits a queue snapshot into ordered runs with one provenance value each. */
function groupPendingOpsBySource(ops: NodeOp[]): PendingRun[] {
  const runs: PendingRun[] = [];

  for (const op of ops) {
    const currentRun = runs.at(-1);

    if (currentRun?.source === op.source) {
      currentRun.ops.push(op);
      currentRun.count += 1;
    } else {
      runs.push({ count: 1, ops: [op], source: op.source });
    }
  }

  return runs;
}

/** Removes client-only provenance before sending a run to Convex. */
function toWireOps(ops: NodeOp[]): Array<Omit<NodeOp, "source">> {
  return ops.map((op) => {
    if (op.kind === "create") {
      return { kind: op.kind, node: op.node };
    }

    if (op.kind === "update") {
      return { kind: op.kind, nodeId: op.nodeId, patch: op.patch };
    }

    return { kind: op.kind, nodeId: op.nodeId };
  });
}

/**
 * Peeks and sends recorded canvas operations without removing unsaved data.
 *
 * Browser teardown has no beacon-compatible Convex transport. A request that
 * is killed after pagehide can therefore remain unsaved, but its queue is
 * retained for bfcache recovery. A true tab close still has the unavoidable
 * residual risk that both the request and in-memory queue disappear.
 */
function useMindmapSync(): void {
  const store = useMindmapStoreApi();
  const applyOps = useMutation(api.ops.apply);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;
    let isDisposed = false;

    /** Clears trailing and max-wait timers for the current mutation burst. */
    const clearBurstTimers = () => {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      if (maxWaitTimer !== undefined) clearTimeout(maxWaitTimer);
      debounceTimer = undefined;
      maxWaitTimer = undefined;
    };

    /** Schedules trailing and maximum-wait flushes for pending user edits. */
    function schedulePending(): void {
      if (isDisposed) return;

      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Null before flushing so an in-flight early return can re-arm it.
        debounceTimer = undefined;
        void flush();
      }, DEBOUNCE_MS);
      maxWaitTimer ??= setTimeout(() => {
        // Null before flushing so an in-flight early return can re-arm it.
        maxWaitTimer = undefined;
        void flush();
      }, MAX_WAIT_MS);
    }

    /** Schedules the next transient-failure retry with a permanent 30s cap. */
    function scheduleRetry(): void {
      const delayIndex = Math.min(
        consecutiveFailures - 1,
        RETRY_DELAYS_MS.length - 1
      );
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void flush();
      }, RETRY_DELAYS_MS[delayIndex]);
    }

    /** Sends one immutable snapshot without committing any store state. */
    const sendBestEffortSnapshot = async (ops: NodeOp[]): Promise<void> => {
      for (const run of groupPendingOpsBySource(ops)) {
        await applyOps({
          mindmapId: store.getState().mindmapDB._id,
          ops: toWireOps(run.ops),
          description: describePendingOps(run.ops),
          source: run.source,
        });
      }
    };

    /** Peeks and sends the current queue, committing only successful prefixes. */
    async function performFlush(): Promise<boolean> {
      if (isDisposed) return false;

      clearBurstTimers();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;

      const batch = store.getState().actions.peekPendingOps();
      if (batch === null) {
        const state = store.getState();
        return state.syncState === "idle" && !state.desyncedSinceRejection;
      }

      if (store.getState().syncState !== "error") {
        store.getState().actions.markSyncState("saving");
      }

      try {
        for (const run of groupPendingOpsBySource(batch.ops)) {
          try {
            const result = await applyOps({
              mindmapId: store.getState().mindmapDB._id,
              ops: toWireOps(run.ops),
              description: describePendingOps(run.ops),
              source: run.source,
            });

            if (isDisposed) return false;
            store
              .getState()
              .actions.commitFlushedOps(run.count, result.updatedAt);
          } catch (error) {
            if (isDisposed) return false;

            if (error instanceof ConvexError) {
              // This exact run can never pass the same deterministic server
              // validation, so discard only its protected prefix.
              store.getState().actions.commitFlushedOps(run.count);
              store
                .getState()
                .actions.markSyncRejected(getSyncErrorMessage(error));
              consecutiveFailures = 0;
              continue;
            }

            consecutiveFailures += 1;
            clearBurstTimers();
            // No request can still commit this prefix, so later local edits may
            // safely coalesce again while the retained batch waits to retry.
            store.getState().actions.releaseFlushedOps();
            if (!store.getState().desyncedSinceRejection) {
              store
                .getState()
                .actions.markSyncState("error", getSyncErrorMessage(error));
            }
            scheduleRetry();
            return false;
          }

          consecutiveFailures = 0;
        }

        if (isDisposed) return false;

        const state = store.getState();
        if (state.desyncedSinceRejection) {
          // A successful independent edit does not heal a rejected local edit.
          state.actions.markSyncState(
            "error",
            state.lastSyncError ?? "The server rejected some changes"
          );
        } else if (state.pendingOps.length === 0) {
          state.actions.markSyncState("idle");
        } else {
          state.actions.markSyncState("dirty");
          schedulePending();
        }

        // A live result observed while this batch was in flight was held back
        // so local state stayed ahead. Apply it only after the queue drains.
        store.getState().actions.applyPendingServerState();

        return !state.desyncedSinceRejection;
      } finally {
        if (isDisposed) {
          clearBurstTimers();
        }
      }
    }

    /**
     * Shares an in-flight flush across StrictMode instances and manual callers.
     */
    function flush(): Promise<boolean> {
      const activeFlush = flushPromises.get(store);
      if (activeFlush !== undefined) {
        return activeFlush;
      }

      const nextFlush = performFlush();
      flushPromises.set(store, nextFlush);
      void nextFlush.finally(() => {
        if (flushPromises.get(store) === nextFlush) {
          flushPromises.delete(store);
        }
      });
      return nextFlush;
    }

    /** Drains edits added during an earlier request before navigation proceeds. */
    async function flushNow(): Promise<boolean> {
      while (!isDisposed) {
        const succeeded = await flush();
        const state = store.getState();

        if (!succeeded || state.desyncedSinceRejection) {
          return false;
        }

        if (state.pendingOps.length === 0) {
          if (state.syncState !== "idle") {
            state.actions.markSyncState("idle");
          }
          return true;
        }
      }

      return false;
    }

    const unregisterFlushNow = store
      .getState()
      .actions.registerFlushNow(flushNow);

    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.syncRetryNonce !== previousState.syncRetryNonce) {
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        void flush();
        return;
      }

      if (
        state.pendingOps === previousState.pendingOps ||
        state.pendingOps.length === 0
      ) {
        return;
      }

      // Preserve visible errors during backoff and after a rejection. The next
      // successful attempt, rather than a keystroke, may clear a transient one.
      if (state.syncState !== "error") {
        state.actions.markSyncState("dirty");
      }

      if (retryTimer === undefined) {
        schedulePending();
      }
    });

    /** Starts the only best-effort flush available during browser teardown. */
    const flushBeforeExit = () => {
      void flush();
    };

    /** Restores a bfcache page from queue truth instead of stale "saving". */
    const recoverFromBackForwardCache = (event: PageTransitionEvent) => {
      if (!event.persisted || isDisposed) return;

      const state = store.getState();
      if (state.pendingOps.length > 0) {
        state.actions.markSyncState("dirty");
        schedulePending();
      } else {
        state.actions.markSyncState("idle");
      }
    };

    window.addEventListener("beforeunload", flushBeforeExit);
    window.addEventListener("pagehide", flushBeforeExit);
    window.addEventListener("pageshow", recoverFromBackForwardCache);

    if (store.getState().pendingOps.length > 0) {
      schedulePending();
    }

    return () => {
      // If no request owns the queue, capture one final immutable snapshot
      // before disposal. It intentionally performs no later store commits.
      const finalBatch = flushPromises.has(store)
        ? null
        : store.getState().actions.peekPendingOps();

      isDisposed = true;
      unsubscribe();
      unregisterFlushNow();
      clearBurstTimers();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      window.removeEventListener("beforeunload", flushBeforeExit);
      window.removeEventListener("pagehide", flushBeforeExit);
      window.removeEventListener("pageshow", recoverFromBackForwardCache);

      if (finalBatch !== null) {
        void sendBestEffortSnapshot(finalBatch.ops).catch(() => {
          // Teardown is best effort and no mounted surface remains to report it.
        });
      }
    };
  }, [applyOps, store]);
}

export { getSyncErrorMessage, groupPendingOpsBySource, useMindmapSync };
