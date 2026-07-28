// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { Edge } from "@xyflow/react";
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

  it("restores a failed batch, exposes the error, and retries successfully", async () => {
    mutationMock
      .mockRejectedValueOnce(new Error("Convex unavailable"))
      .mockResolvedValueOnce({ operationId: "operation-2", seq: 2 });
    renderSyncHarness();

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "Changed" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(store.getState().pendingOps).toHaveLength(1);
    expect(store.getState().syncState).toBe("error");
    expect(store.getState().lastSyncError).toBe("Convex unavailable");

    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(mutationMock).toHaveBeenCalledTimes(2);
    expect(store.getState().pendingOps).toEqual([]);
    expect(store.getState().syncState).toBe("idle");
    expect(store.getState().lastSyncError).toBeNull();
  });
});

/** Mounts the real provider with only the Convex mutation hook mocked. */
function renderSyncHarness(): void {
  render(
    <MindmapFlowProvider {...createSyncFixture()}>
      <SyncHarness />
    </MindmapFlowProvider>
  );
}

/** Captures the store for assertions and mounts the synchronization effect. */
function SyncHarness() {
  store = useMindmapStoreApi();
  useMindmapSync();
  return null;
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
