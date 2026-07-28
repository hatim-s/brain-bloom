// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { Edge } from "@xyflow/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MindmapDB } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { createEdge } from "../mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "../mindmap/createNode";
import {
  MindmapFlowProvider,
  useMindmapStoreApi,
} from "../providers/MindmapFlowProvider";
import { BaseFlowNode, NodeTypes } from "../types";
import { useMindmapSync } from "./useMindmapSync";

const mutationMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({ useMutation: () => mutationMock }));

let store: ReturnType<typeof useMindmapStoreApi>;

beforeEach(() => {
  vi.useFakeTimers();
  mutationMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useMindmapSync", () => {
  it("flushes one coalesced batch after a burst's trailing debounce", async () => {
    mutationMock.mockResolvedValue({ operationId: "operation-1", seq: 1 });
    renderSyncHarness();

    act(() => {
      const actions = store.getState().actions;
      actions.onAddNode(NodeTypes.RIGHT, ROOT_NODE_ID, "right-new", {
        title: "Draft",
      });
      actions.onUpdateNode("right-new", { title: "Second" });
      actions.onUpdateNode("right-new", { title: "Final" });
    });

    await act(async () => vi.advanceTimersByTimeAsync(1_499));
    expect(mutationMock).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(mutationMock).toHaveBeenCalledOnce();
    expect(mutationMock).toHaveBeenCalledWith({
      mindmapId: "mindmaps:sync-fixture",
      ops: [
        {
          kind: "create",
          node: {
            nodeId: "right-new",
            parentId: ROOT_NODE_ID,
            type: "right",
            title: "Final",
            order: 1,
          },
        },
      ],
      description: "Added 1 node",
      source: "user",
    });
    expect(store.getState().syncState).toBe("idle");
    expect(store.getState().pendingOps).toEqual([]);
  });

  it("protects an in-flight prefix while both timers fire on newer edits", async () => {
    const firstMutation = createDeferred<{
      operationId: string;
      seq: number;
    }>();
    mutationMock
      .mockReturnValueOnce(firstMutation.promise)
      .mockResolvedValueOnce({ operationId: "operation-2", seq: 2 });
    renderSyncHarness();

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "In flight" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(mutationMock).toHaveBeenCalledOnce();
    expect(store.getState().pendingOps).toHaveLength(1);
    expect(store.getState().flushedWatermark).toBe(1);

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "Newer edit" });
    });
    expect(store.getState().pendingOps).toHaveLength(2);

    // The newer edit's debounce and max-wait both encounter the same mutex.
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mutationMock).toHaveBeenCalledOnce();

    await act(async () => {
      firstMutation.resolve({ operationId: "operation-1", seq: 1 });
      await firstMutation.promise;
    });

    expect(store.getState().pendingOps).toHaveLength(1);
    expect(store.getState().pendingOps[0]).toMatchObject({
      kind: "update",
      patch: { title: "Newer edit" },
    });

    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(mutationMock).toHaveBeenCalledTimes(2);
    expect(mutationMock.mock.calls[1][0].ops).toEqual([
      {
        kind: "update",
        nodeId: "right-child",
        patch: { title: "Newer edit" },
      },
    ]);
    expect(store.getState().pendingOps).toEqual([]);
  });

  it("uses one cross-instance mutex for duplicate hook instances", async () => {
    mutationMock.mockResolvedValue({ operationId: "operation-1", seq: 1 });
    renderSyncHarness(2);

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "One write" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(mutationMock).toHaveBeenCalledOnce();
    expect(store.getState().pendingOps).toEqual([]);
  });

  it("does not write to a disposed store when an in-flight request settles", async () => {
    const pendingMutation = createDeferred<{
      operationId: string;
      seq: number;
    }>();
    mutationMock.mockReturnValue(pendingMutation.promise);
    const rendered = renderSyncHarness();

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "In flight" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    const commit = vi.spyOn(store.getState().actions, "commitFlushedOps");
    const mark = vi.spyOn(store.getState().actions, "markSyncState");
    rendered.unmount();

    await act(async () => {
      pendingMutation.resolve({ operationId: "operation-1", seq: 1 });
      await pendingMutation.promise;
    });

    expect(commit).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
    expect(mutationMock).toHaveBeenCalledOnce();
  });

  it("drops a deterministic Convex rejection and marks permanent desync", async () => {
    mutationMock.mockRejectedValue(
      new ConvexError("Invalid op: parent is on another side")
    );
    renderSyncHarness();

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "Rejected" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(store.getState().pendingOps).toEqual([]);
    expect(store.getState().flushedWatermark).toBe(0);
    expect(store.getState().syncState).toBe("error");
    expect(store.getState().lastSyncError).toBe(
      "Invalid op: parent is on another side"
    );
    expect(store.getState().desyncedSinceRejection).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(mutationMock).toHaveBeenCalledOnce();
  });

  it("keeps transient retries at the 30-second cap without cosmetic reset", async () => {
    mutationMock.mockRejectedValue(new Error("Convex unavailable"));
    renderSyncHarness();

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "Changed" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(store.getState().syncState).toBe("error");
    expect(store.getState().pendingOps).toHaveLength(1);

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "Changed again" });
    });
    expect(store.getState().syncState).toBe("error");
    expect(store.getState().flushedWatermark).toBe(0);

    for (const delay of [2_000, 4_000, 8_000, 30_000, 30_000]) {
      await act(async () => vi.advanceTimersByTimeAsync(delay));
    }

    expect(mutationMock).toHaveBeenCalledTimes(6);
    expect(store.getState().syncState).toBe("error");
    expect(store.getState().pendingOps).toHaveLength(1);
    expect(store.getState().pendingOps[0]).toMatchObject({
      patch: { title: "Changed again" },
    });
  });

  it("retrySync bypasses backoff and flushes immediately", async () => {
    mutationMock
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ operationId: "operation-2", seq: 2 });
    renderSyncHarness();

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "Changed" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    await act(async () => {
      store.getState().actions.retrySync();
      await Promise.resolve();
    });

    expect(mutationMock).toHaveBeenCalledTimes(2);
    expect(store.getState().syncState).toBe("idle");
    expect(store.getState().pendingOps).toEqual([]);
  });

  it("restores persisted pages from queue truth and re-arms saving", async () => {
    mutationMock.mockResolvedValue({ operationId: "operation-1", seq: 1 });
    renderSyncHarness();

    act(() => {
      store.getState().actions.onUpdateNode("right-child", { title: "Queued" });
      store.getState().actions.markSyncState("saving");
      window.dispatchEvent(createPersistedPageShowEvent());
    });

    expect(store.getState().syncState).toBe("dirty");
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(mutationMock).toHaveBeenCalledOnce();
    expect(store.getState().syncState).toBe("idle");
  });

  it("fires a final peeked mutation when unmounting with a dirty queue", async () => {
    mutationMock.mockResolvedValue({ operationId: "operation-1", seq: 1 });
    const rendered = renderSyncHarness();

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "Last edit" });
    });
    rendered.unmount();

    expect(mutationMock).toHaveBeenCalledOnce();
    expect(mutationMock).toHaveBeenCalledWith({
      mindmapId: "mindmaps:sync-fixture",
      ops: [
        {
          kind: "update",
          nodeId: "right-child",
          patch: { title: "Last edit" },
        },
      ],
      description: "Edited 1 node",
      source: "user",
    });
    expect(store.getState().pendingOps).toHaveLength(1);
  });

  it("preserves order while splitting consecutive user and AI runs", async () => {
    mutationMock
      .mockResolvedValueOnce({ operationId: "operation-1", seq: 1 })
      .mockResolvedValueOnce({ operationId: "operation-2", seq: 2 });
    renderSyncHarness();

    act(() => {
      const actions = store.getState().actions;
      actions.onUpdateNode("right-child", { title: "User edit" });
      actions.onAddNode(
        NodeTypes.RIGHT,
        ROOT_NODE_ID,
        "right-ai",
        { title: "AI node" },
        { source: "ai" }
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(mutationMock).toHaveBeenCalledTimes(2);
    expect(mutationMock.mock.calls.map(([args]) => args.source)).toEqual([
      "user",
      "ai",
    ]);
    expect(store.getState().pendingOps).toEqual([]);
  });
});

/** Mounts the real provider with only the Convex mutation hook mocked. */
function renderSyncHarness(hookCount = 1) {
  return render(
    <MindmapFlowProvider {...createSyncFixture()}>
      <StoreProbe />
      {Array.from({ length: hookCount }, (_, index) => (
        <SyncHarness key={index} />
      ))}
    </MindmapFlowProvider>
  );
}

/** Captures the provider store for assertions. */
function StoreProbe() {
  store = useMindmapStoreApi();
  return null;
}

/** Mounts one synchronization effect against the shared provider store. */
function SyncHarness() {
  useMindmapSync();
  return null;
}

/** Creates a manually controlled promise for in-flight lifecycle assertions. */
function createDeferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

/** Creates a pageshow event whose persisted flag represents bfcache restore. */
function createPersistedPageShowEvent(): PageTransitionEvent {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: true });
  return event;
}

/** Creates a rooted graph with one existing child for deterministic ordering. */
function createSyncFixture(): {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
} {
  return {
    mindmapDB: {
      _id: "mindmaps:sync-fixture" as MindmapDB["_id"],
      publicId: "sync-map",
      name: "Sync fixture",
      visibility: "private",
      updatedAt: 1,
      isOwner: true,
    },
    initialNodes: [
      createBaseFlowNodeFromPartialBaseFlowNode({
        id: ROOT_NODE_ID,
        type: NodeTypes.ROOT,
        data: { title: "Root" },
      }),
      createBaseFlowNodeFromPartialBaseFlowNode({
        id: "right-child",
        type: NodeTypes.RIGHT,
        data: { title: "Right child" },
      }),
    ],
    initialEdges: [createEdge(ROOT_NODE_ID, "right-child")],
  };
}
