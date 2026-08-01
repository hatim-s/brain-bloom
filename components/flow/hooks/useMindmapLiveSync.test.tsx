// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { Edge } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { createEdge } from "../mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "../mindmap/createNode";
import {
  MindmapFlowProvider,
  useMindmapStoreApi,
} from "../providers/MindmapFlowProvider";
import { BaseFlowNode, NodeTypes } from "../types";
import { useMindmapLiveSync } from "./useMindmapLiveSync";
import { useMindmapSync } from "./useMindmapSync";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: {
    current: undefined as
      | {
          mindmap: MindmapDB;
          nodes: MindmapNodeProjection[];
        }
      | undefined,
  },
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutation,
  useQuery: (...args: unknown[]) => {
    mocks.useQuery(...args);
    return mocks.query.current;
  },
}));

let store: ReturnType<typeof useMindmapStoreApi>;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.mutation.mockReset();
  mocks.query.current = undefined;
  mocks.useQuery.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useMindmapLiveSync", () => {
  it("no-ops the initial self-echo at the seeded version", () => {
    mocks.query.current = createServerState(1);
    const view = renderLiveHarness();
    const initialNodes = store.getState().nodes;
    const initialMindmapNodes = store.getState().mindmapNodesMap;

    view.rerender(createLiveHarness());

    // Nothing was re-laid-out: the derived graph views keep their identity.
    expect(store.getState().nodes).toBe(initialNodes);
    expect(store.getState().mindmapNodesMap).toBe(initialMindmapNodes);
    expect(store.getState().pendingServerState).toBeNull();
  });

  it("defers a live result during a flush and applies it when the queue drains", async () => {
    const mutation = createDeferred<{
      operationId: string;
      seq: number;
      updatedAt: number;
    }>();
    mocks.mutation.mockReturnValue(mutation.promise);
    const view = renderLiveHarness({ withAutosave: true });

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "Local edit" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(store.getState().syncState).toBe("saving");
    expect(store.getState().pendingOps).toHaveLength(1);

    mocks.query.current = createServerState(2, true);
    view.rerender(createLiveHarness({ withAutosave: true }));

    expect(store.getState().seededUpdatedAt).toBe(1);
    expect(store.getState().nodesMap["l-ai-created"]).toBeUndefined();
    expect(store.getState().pendingServerState?.updatedAt).toBe(2);

    await act(async () => {
      mutation.resolve({
        operationId: "operations:1",
        seq: 1,
        updatedAt: 3,
      });
      await mutation.promise;
    });

    expect(store.getState().pendingOps).toEqual([]);
    expect(store.getState().syncState).toBe("idle");
    expect(store.getState().pendingServerState).toBeNull();
    expect(store.getState().acknowledgedServerVersion).toBe(3);
    expect(store.getState().seededUpdatedAt).toBe(1);
    expect(store.getState().nodesMap["l-ai-created"]).toBeUndefined();
  });

  it("applies a deferred snapshot at or above the flush watermark", async () => {
    const mutation = createDeferred<{
      operationId: string;
      seq: number;
      updatedAt: number;
    }>();
    mocks.mutation.mockReturnValue(mutation.promise);
    const view = renderLiveHarness({ withAutosave: true });

    act(() => {
      store
        .getState()
        .actions.onUpdateNode("right-child", { title: "Local edit" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    mocks.query.current = createServerState(3, true);
    view.rerender(createLiveHarness({ withAutosave: true }));

    await act(async () => {
      mutation.resolve({
        operationId: "operations:1",
        seq: 1,
        updatedAt: 3,
      });
      await mutation.promise;
    });

    expect(store.getState().pendingServerState).toBeNull();
    expect(store.getState().seededUpdatedAt).toBe(3);
    expect(store.getState().nodesMap["l-ai-created"]).toBeDefined();
  });

  it("sets AI touched ids only after a created node is reseeded", () => {
    const view = renderLiveHarness();
    const commits: Array<{ hasNode: boolean; isTouched: boolean }> = [];

    act(() => {
      store
        .getState()
        .actions.setAiTouchedNodeIdsAfterReseed(["l-ai-created"], 1);
    });
    const unsubscribe = store.subscribe((state) => {
      commits.push({
        hasNode: state.nodesMap["l-ai-created"] !== undefined,
        isTouched: state.aiTouchedNodeIds.includes("l-ai-created"),
      });
    });

    mocks.query.current = createServerState(2, true);
    view.rerender(createLiveHarness());

    expect(commits).toContainEqual({ hasNode: true, isTouched: false });
    expect(commits.at(-1)).toEqual({ hasNode: true, isTouched: true });
    unsubscribe();
  });

  it("uses the Convex skip sentinel for a read-only store", () => {
    renderLiveHarness({ readOnly: true });

    expect(mocks.useQuery.mock.calls.at(-1)?.[1]).toBe("skip");
  });
});

/** Renders a provider whose query result can be replaced between rerenders. */
function renderLiveHarness(options?: {
  readOnly?: boolean;
  withAutosave?: boolean;
}) {
  return render(createLiveHarness(options));
}

/** Creates the live-sync element tree used for initial render and rerender. */
function createLiveHarness(options?: {
  readOnly?: boolean;
  withAutosave?: boolean;
}) {
  return (
    <MindmapFlowProvider
      {...createFixture()}
      readOnly={options?.readOnly ?? false}
    >
      <StoreProbe />
      <LiveSyncHarness />
      {options?.withAutosave ? <AutosaveHarness /> : null}
    </MindmapFlowProvider>
  );
}

/** Captures the real provider store for reconciliation assertions. */
function StoreProbe() {
  store = useMindmapStoreApi();
  return null;
}

/** Mounts the inbound Convex live-query effect. */
function LiveSyncHarness() {
  useMindmapLiveSync();
  return null;
}

/** Mounts outbound autosave so flush-success reconciliation is exercised. */
function AutosaveHarness() {
  useMindmapSync();
  return null;
}

/** Creates a manually controlled promise for an in-flight autosave. */
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

/** Returns the initial graph accepted by the provider. */
function createFixture(): {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
} {
  return {
    mindmapDB: createMindmap(1),
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

/** Creates a versioned live-query payload, optionally with a new AI node. */
function createServerState(
  updatedAt: number,
  includeAiNode = false
): {
  mindmap: MindmapDB;
  nodes: MindmapNodeProjection[];
} {
  return {
    mindmap: createMindmap(updatedAt),
    nodes: [
      {
        nodeId: ROOT_NODE_ID,
        parentId: null,
        type: "root",
        title: "Root",
        order: 0,
      },
      {
        nodeId: "right-child",
        parentId: ROOT_NODE_ID,
        type: "right",
        title: "Local edit",
        order: 0,
      },
      ...(includeAiNode
        ? [
            {
              nodeId: "l-ai-created",
              parentId: ROOT_NODE_ID,
              type: "left" as const,
              title: "AI created",
              order: 0,
            },
          ]
        : []),
    ],
  };
}

/** Creates the stable mindmap projection around a supplied version. */
function createMindmap(updatedAt: number): MindmapDB {
  return {
    _id: "mindmaps:live-fixture" as MindmapDB["_id"],
    publicId: "live-map",
    name: "Live fixture",
    visibility: "private",
    updatedAt,
    isOwner: true,
  };
}
