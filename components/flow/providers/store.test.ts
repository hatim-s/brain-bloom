// @vitest-environment node

import { Edge } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { initGraphs, initLayout } from "../layout/init";
import { createEdge } from "../mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "../mindmap/createNode";
import { BaseFlowNode, NodeTypes } from "../types";
import { createMindmapStore, MindmapStore } from "./store";

describe("createMindmapStore", () => {
  it("seeds the same nodes and positions as initLayout", () => {
    const { initialNodes, initialEdges, mindmapDB } = createStoreFixture();
    const expectedNodes = initLayout(initGraphs(), initialNodes, initialEdges);

    const store = createMindmapStore({
      mindmapDB,
      initialNodes,
      initialEdges,
    });

    expect(store.getState().nodes).toEqual(expectedNodes);
    expect(store.getState().edges).toEqual(initialEdges);
    expectDerivedStateInvariant(store.getState());
  });

  it("adds a node and edge while refreshing both derived views", () => {
    const store = createFixtureStore();
    const previousState = store.getState();

    const newNodeId = previousState.actions.onAddNode(
      NodeTypes.RIGHT,
      "r-child",
      "r-grandchild",
      { title: "Right grandchild" }
    );
    const state = store.getState();

    expect(newNodeId).toBe("r-grandchild");
    expect(state.nodes).toHaveLength(previousState.nodes.length + 1);
    expect(state.edges).toHaveLength(previousState.edges.length + 1);
    expect(state.edges).toContainEqual(
      expect.objectContaining({
        source: "r-child",
        target: "r-grandchild",
      })
    );
    expect(state.mindmapNodesMap["r-grandchild"]).toEqual(
      expect.objectContaining({
        id: "r-grandchild",
        parentId: "r-child",
        level: 2,
      })
    );
    expect(state.mindmapNodesMap["r-child"].children.has("r-grandchild")).toBe(
      true
    );
    expect(state.pendingOps).toEqual([
      {
        kind: "create",
        source: "user",
        node: {
          nodeId: "r-grandchild",
          parentId: "r-child",
          type: "right",
          title: "Right grandchild",
          order: 0,
        },
      },
    ]);
    expect(state.syncState).toBe("dirty");
    expectDerivedStateInvariant(state);
  });

  it("updates node data in the source and both addressable maps", () => {
    const store = createFixtureStore();
    const updatedData = {
      title: "Updated right child",
      description: "Updated description",
    };

    store.getState().actions.onUpdateNode("r-child", updatedData);
    const state = store.getState();

    expect(state.nodesMap["r-child"].data).toEqual(updatedData);
    expect(state.nodes.find((node) => node.id === "r-child")?.data).toEqual(
      updatedData
    );
    expect(state.mindmapNodesMap["r-child"].data).toEqual(updatedData);
    expect(state.pendingOps).toEqual([
      {
        kind: "update",
        source: "user",
        nodeId: "r-child",
        patch: {
          title: "Updated right child",
          description: "Updated description",
        },
      },
    ]);
    expectDerivedStateInvariant(state);
  });

  it("records null sentinels only for optional fields that were cleared", () => {
    const store = createFixtureStore();
    store.getState().actions.onUpdateNode("r-child", {
      title: "Right child",
      description: "Existing",
      link: "https://example.com",
    });
    const firstBatch = store.getState().actions.peekPendingOps();
    store.getState().actions.commitFlushedOps(firstBatch!.count);

    store.getState().actions.onUpdateNode("r-child", {
      title: "Right child",
    });

    expect(store.getState().pendingOps).toEqual([
      {
        kind: "update",
        source: "user",
        nodeId: "r-child",
        patch: { description: null, link: null },
      },
    ]);
  });

  it("peeks a protected prefix and commits exactly its successful count", () => {
    const store = createFixtureStore();
    store.getState().actions.onUpdateNode("l-child", { title: "First edit" });
    const peeked = store.getState().actions.peekPendingOps();

    expect(peeked).toEqual({
      ops: [
        {
          kind: "update",
          source: "user",
          nodeId: "l-child",
          patch: { title: "First edit" },
        },
      ],
      count: 1,
    });
    expect(store.getState().pendingOps).toEqual(peeked!.ops);
    expect(store.getState().flushedWatermark).toBe(1);

    store.getState().actions.onUpdateNode("l-child", { title: "Newer edit" });

    expect(store.getState().pendingOps).toHaveLength(2);
    expect(store.getState().pendingOps[0]).toEqual(peeked!.ops[0]);

    store.getState().actions.commitFlushedOps(peeked!.count);

    expect(store.getState().pendingOps).toEqual([
      {
        kind: "update",
        source: "user",
        nodeId: "l-child",
        patch: { title: "Newer edit" },
      },
    ]);
    expect(store.getState().flushedWatermark).toBe(0);
  });

  it("resyncs the owning dagre node height when node data changes", () => {
    const store = createFixtureStore();
    const rightGraph = store.getState().layout.rightGraph;

    expect(rightGraph.node("r-child").height).toBe(52);

    store.getState().actions.onUpdateNode("r-child", {
      title: "Updated right child",
      description: "A description increases the rendered node height",
    });

    expect(rightGraph.node("r-child")).toEqual({
      height: 100,
      width: 300,
    });
  });

  it("reads the current public mindmap map before adding a node", () => {
    const store = createFixtureStore();
    const root = store.getState().mindmapNodesMap[ROOT_NODE_ID];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    store.setState({ mindmapNodesMap: { [ROOT_NODE_ID]: root } });

    const result = store
      .getState()
      .actions.onAddNode(NodeTypes.LEFT, "l-child", "l-grandchild");

    expect(result).toBeNull();
    expect(store.getState().nodesMap["l-grandchild"]).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "[MindmapFlowProvider] onAddNode: parent node l-child not found"
    );
    error.mockRestore();
  });

  it("rejects a parent missing from the target-side graph", () => {
    const store = createFixtureStore();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = store
      .getState()
      .actions.onAddNode(NodeTypes.RIGHT, "l-child", "r-wrong-side");

    expect(result).toBeNull();
    expect(store.getState().layout.rightGraph.hasNode("l-child")).toBe(false);
    expect(error).toHaveBeenCalledWith(
      "[MindmapFlowProvider] onAddNode: parent node l-child not found in right graph"
    );
    error.mockRestore();
  });

  it("rejects explicit id collisions and regenerates generated collisions", () => {
    const store = createFixtureStore();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const explicitResult = store
      .getState()
      .actions.onAddNode(NodeTypes.RIGHT, "r-child", "r-child");

    expect(explicitResult).toBeNull();
    expect(error).toHaveBeenCalledWith(
      "[MindmapFlowProvider] onAddNode: node r-child already exists"
    );

    store.getState().actions.onAddNode(NodeTypes.RIGHT, "r-child", "r-00000");
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1.5 / 36 ** 5);

    const generatedResult = store
      .getState()
      .actions.onAddNode(NodeTypes.RIGHT, "r-child");

    expect(generatedResult).toBe("r-00001");
    expect(store.getState().nodesMap["r-00000"]).toBeDefined();
    expect(store.getState().nodesMap["r-00001"]).toBeDefined();
    random.mockRestore();
    error.mockRestore();
  });

  it("updates active, selected, and AI edit node fields", () => {
    const store = createFixtureStore();

    store.getState().setActiveNode("l-child");
    expect(store.getState().activeNode).toBe("l-child");
    expectDerivedStateInvariant(store.getState());

    store.getState().setSelectedNode("r-child");
    expect(store.getState().selectedNode).toBe("r-child");
    expectDerivedStateInvariant(store.getState());

    store.getState().setAiEditNode("l-child");
    expect(store.getState().aiEditNode).toBe("l-child");
    expectDerivedStateInvariant(store.getState());
  });

  it("reseeds every derived graph while preserving valid UI and sync state", () => {
    const store = createFixtureStore();
    const previousLayout = store.getState().layout;

    store.getState().setActiveNode("l-child");
    store.getState().setSelectedNode("r-child");
    store.getState().setAiEditNode("l-child");
    store.getState().setAiTouchedNodeIds(["l-child"]);
    store
      .getState()
      .actions.onUpdateNode("r-child", { title: "Unsaved local edit" });
    store.getState().actions.markSyncState("saving");

    const reseeded = store.getState().actions.reseedFromServer({
      nodes: createServerNodes(),
      updatedAt: 2,
    });
    const state = store.getState();

    expect(reseeded).toBe(true);
    expect(state.layout).not.toBe(previousLayout);
    expect(state.layout.rightGraph.hasNode("r-server")).toBe(true);
    expect(state.nodesMap["r-server"].data.title).toBe("Server child");
    expect(state.mindmapNodesMap["root"].children.has("r-server")).toBe(true);
    expect(state.activeNode).toBe("l-child");
    expect(state.selectedNode).toBeNull();
    expect(state.aiEditNode).toBe("l-child");
    expect(state.aiTouchedNodeIds).toEqual(["l-child"]);
    expect(state.pendingOps).toEqual([
      {
        kind: "update",
        source: "user",
        nodeId: "r-child",
        patch: { title: "Unsaved local edit" },
      },
    ]);
    expect(state.syncState).toBe("saving");
    expect(state.seededUpdatedAt).toBe(2);
    expectDerivedStateInvariant(state);
  });

  it("does not reseed a read-only store", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createMindmapStore({
      ...createStoreFixture(),
      readOnly: true,
    });
    const previousNodes = store.getState().nodes;

    const reseeded = store.getState().actions.reseedFromServer({
      nodes: createServerNodes(),
      updatedAt: 2,
    });

    expect(reseeded).toBe(false);
    expect(store.getState().nodes).toBe(previousNodes);
    expect(store.getState().seededUpdatedAt).toBe(1);
    expect(warning).toHaveBeenCalledWith(
      "[MindmapFlowProvider] ignored reseedFromServer in read-only mode"
    );
    warning.mockRestore();
  });

  it("rejects mutation actions when seeded read-only", () => {
    const fixture = createStoreFixture();
    const store = createMindmapStore({ ...fixture, readOnly: true });
    const initialState = store.getState();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    const addedNode = initialState.actions.onAddNode(
      NodeTypes.LEFT,
      "l-child",
      "blocked-child"
    );
    initialState.actions.onUpdateNode("l-child", { title: "Blocked edit" });
    initialState.actions.onNodesChange([{ id: "l-child", type: "remove" }]);
    initialState.setSelectedNode("l-child");
    initialState.setAiEditNode("l-child");

    const state = store.getState();
    expect(addedNode).toBeNull();
    expect(state.nodesMap["blocked-child"]).toBeUndefined();
    expect(state.nodesMap["l-child"].data.title).toBe("Left child");
    expect(state.pendingOps).toEqual([]);
    expect(state.selectedNode).toBeNull();
    expect(state.aiEditNode).toBeNull();
    expect(warning.mock.calls).toEqual([
      ["[MindmapFlowProvider] ignored onAddNode in read-only mode"],
      ["[MindmapFlowProvider] ignored onUpdateNode in read-only mode"],
      ["[MindmapFlowProvider] ignored onNodesChange remove in read-only mode"],
    ]);
    warning.mockRestore();
  });

  it("keeps derived state synchronized after every node action", () => {
    const store = createFixtureStore();

    store.getState().actions.onNodesChange([
      {
        id: "l-child",
        type: "position",
        position: { x: -500, y: 25 },
      },
    ]);
    expect(store.getState().nodesMap["l-child"].position).toEqual({
      x: -500,
      y: 25,
    });
    expectDerivedStateInvariant(store.getState());

    store
      .getState()
      .actions.onAddNode(NodeTypes.LEFT, "l-child", "l-grandchild");
    expectDerivedStateInvariant(store.getState());

    store.getState().actions.onUpdateNode("l-grandchild", { title: "Updated" });
    expectDerivedStateInvariant(store.getState());
  });

  it("converges incremental bilateral additions on batch layout positions", () => {
    const store = createFixtureStore();

    store
      .getState()
      .actions.onAddNode(NodeTypes.LEFT, "l-child", "l-grandchild");
    store
      .getState()
      .actions.onAddNode(NodeTypes.RIGHT, "r-child", "r-grandchild");
    store
      .getState()
      .actions.onAddNode(NodeTypes.LEFT, "l-grandchild", "l-great-grandchild");

    const state = store.getState();
    const batchNodes = initLayout(initGraphs(), state.nodes, state.edges);

    expect(toNodePositions(state.nodes)).toEqual(toNodePositions(batchNodes));
  });

  it("blooms only the AI-touched nodes the canvas actually holds", () => {
    const store = createFixtureStore();

    // The model writes straight to Convex, so an id it just created has no
    // node on this canvas until the page is re-seeded from the server.
    store.getState().setAiTouchedNodeIds(["l-child", "l-not-loaded-yet"]);

    expect(store.getState().aiTouchedNodeIds).toEqual([
      "l-child",
      "l-not-loaded-yet",
    ]);

    store.getState().setAiTouchedNodeIds([]);

    expect(store.getState().aiTouchedNodeIds).toEqual([]);
  });

  it("ignores AI bloom state on a read-only canvas", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createMindmapStore({
      ...createStoreFixture(),
      readOnly: true,
    });

    store.getState().setAiTouchedNodeIds(["l-child"]);

    expect(store.getState().aiTouchedNodeIds).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

/** Creates a fresh store so mutable dagre graphs never cross test cases. */
function createFixtureStore() {
  return createMindmapStore(createStoreFixture());
}

/** Creates a small bilateral graph with deterministic node ids. */
function createStoreFixture(): {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
} {
  const initialNodes = [
    createBaseFlowNodeFromPartialBaseFlowNode({
      id: ROOT_NODE_ID,
      type: NodeTypes.ROOT,
      data: { title: "Root" },
    }),
    createBaseFlowNodeFromPartialBaseFlowNode({
      id: "l-child",
      type: NodeTypes.LEFT,
      data: { title: "Left child" },
    }),
    createBaseFlowNodeFromPartialBaseFlowNode({
      id: "r-child",
      type: NodeTypes.RIGHT,
      data: { title: "Right child" },
    }),
  ];
  const initialEdges = [
    createEdge(ROOT_NODE_ID, "l-child"),
    createEdge(ROOT_NODE_ID, "r-child"),
  ];
  const mindmapDB: MindmapDB = {
    _id: "mindmaps:store-fixture" as MindmapDB["_id"],
    publicId: "store-map",
    name: "Store fixture",
    visibility: "private",
    updatedAt: 1,
    isOwner: true,
  };

  return { mindmapDB, initialNodes, initialEdges };
}

/** Creates a newer server projection with one retained and one created node. */
function createServerNodes(): MindmapNodeProjection[] {
  return [
    {
      nodeId: ROOT_NODE_ID,
      parentId: null,
      type: "root",
      title: "Server root",
      order: 0,
    },
    {
      nodeId: "l-child",
      parentId: ROOT_NODE_ID,
      type: "left",
      title: "Left child from server",
      order: 0,
    },
    {
      nodeId: "r-server",
      parentId: ROOT_NODE_ID,
      type: "right",
      title: "Server child",
      order: 0,
    },
  ];
}

/** Checks that every source node appears in exactly one non-empty derived level. */
function expectDerivedStateInvariant(state: MindmapStore): void {
  expect(Object.keys(state.nodesMap).sort()).toEqual(
    state.nodes.map((node) => node.id).sort()
  );

  expect(state.leveledNodes.every((level) => level.length > 0)).toBe(true);
  expect(
    state.leveledNodes
      .flat()
      .map((node) => node.id)
      .sort()
  ).toEqual(Object.keys(state.mindmapNodesMap).sort());
}

/** Reduces flow nodes to the geometry asserted by layout fidelity tests. */
function toNodePositions(nodes: MindmapStore["nodes"]) {
  return nodes.map(({ id, position }) => ({ id, position }));
}
