// @vitest-environment node

import { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { MindmapDB } from "@/types/Mindmap";

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
    expectDerivedStateInvariant(state);
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
    id: 1,
    name: "Store fixture",
    created_at: "2026-07-28T00:00:00.000Z",
    owner_user_id: "00000000-0000-0000-0000-000000000000",
    nodes: [],
    edges: [],
  };

  return { mindmapDB, initialNodes, initialEdges };
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
