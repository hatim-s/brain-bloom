import { applyNodeChanges, Edge } from "@xyflow/react";
import { createStore, StoreApi } from "zustand";

import { MindmapDB } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { generateLeveledNodes } from "../layout/generateLeveledNodes";
import {
  addNodeToGraph,
  calculateNodeHeight,
  initGraphs,
  initLayout,
  NODE_DIMENSIONS,
} from "../layout/init";
import { createEdge } from "../mindmap/createEdge";
import {
  createBaseFlowNodeFromPartialBaseFlowNode,
  createNode,
} from "../mindmap/createNode";
import {
  addChildToMindmapNode,
  createMindmapNodeFromFlowNode,
  transformFlowNodesAndEdgesToMindmapNodes,
} from "../mindmap/flowNodeToMindmapNode";
import { transformMindmapNodesToFlowNodesAndEdges } from "../mindmap/mindmapNodesToFlowNodes";
import {
  appendPendingOp,
  describePendingOps,
  PendingNodePatch,
} from "../mindmap/pendingOps";
import { BaseFlowNode, FlowNode, MindmapNode, NodeTypes } from "../types";
import { MindmapFlowContext } from "./types";

type MindmapStore = MindmapFlowContext;

type MindmapStoreSeed = {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
};

/** Builds the id-addressable node view kept in sync with the nodes array. */
function deriveNodesMap(nodes: FlowNode[]): Record<string, FlowNode> {
  return nodes.reduce<Record<string, FlowNode>>((nodesMap, node) => {
    nodesMap[node.id] = node;
    return nodesMap;
  }, {});
}

/** Builds the breadth-first levels kept in sync with the mindmap node map. */
function deriveLeveledNodes(
  mindmapNodesMap: Record<string, MindmapNode>
): MindmapNode[][] {
  return generateLeveledNodes(mindmapNodesMap);
}

/** Builds a minimal wire patch while preserving explicit optional removals. */
function createNodeDataPatch(
  previous: FlowNode["data"],
  next: FlowNode["data"]
): PendingNodePatch {
  const patch: PendingNodePatch = {};

  if (previous.title !== next.title) {
    patch.title = next.title;
  }

  if (previous.description !== next.description) {
    patch.description = next.description ?? null;
  }

  if (previous.link !== next.link) {
    patch.link = next.link ?? null;
  }

  return patch;
}

/**
 * Creates an isolated mindmap store seeded from one provider instance.
 *
 * Graph objects stay mutable as before, while each state write also refreshes
 * every derived view affected by that write.
 */
function createMindmapStore({
  mindmapDB,
  initialNodes,
  initialEdges,
}: MindmapStoreSeed): StoreApi<MindmapStore> {
  const layout = initGraphs();
  const nodes = initLayout(layout, initialNodes, initialEdges);
  const edges = initialEdges;
  const initialMindmapNodesMap = transformFlowNodesAndEdgesToMindmapNodes(
    nodes,
    edges
  );

  return createStore<MindmapStore>((set, get) => {
    /** Applies XYFlow node changes and refreshes the node lookup atomically. */
    const onNodesChange: MindmapFlowContext["actions"]["onNodesChange"] = (
      changes
    ) => {
      set((state) => {
        const updatedNodes = applyNodeChanges(
          changes,
          state.nodes
        ) as FlowNode[];

        // Source and derived state are committed atomically.
        return {
          nodes: updatedNodes,
          nodesMap: deriveNodesMap(updatedNodes),
        };
      });
    };

    /** Adds and lays out one node while synchronizing every graph view. */
    const onAddNode: MindmapFlowContext["actions"]["onAddNode"] = (
      type,
      parentNodeId,
      id,
      data
    ) => {
      const currentMindmapNodesMap = get().mindmapNodesMap;

      if (!currentMindmapNodesMap[parentNodeId]) {
        // eslint-disable-next-line no-console -- needed
        console.error(
          `[MindmapFlowProvider] onAddNode: parent node ${parentNodeId} not found`
        );
        return null;
      }

      if (id && currentMindmapNodesMap[id]) {
        // eslint-disable-next-line no-console -- needed
        console.error(
          `[MindmapFlowProvider] onAddNode: node ${id} already exists`
        );
        return null;
      }

      let newNode = createNode(type, "New Node", id, data);
      while (!id && currentMindmapNodesMap[newNode.id]) {
        newNode = createNode(type, "New Node", undefined, data);
      }

      const newGraph =
        type === NodeTypes.LEFT ? layout.leftGraph : layout.rightGraph;
      const oldGraph =
        type === NodeTypes.LEFT ? layout.rightGraph : layout.leftGraph;

      if (!newGraph.hasNode(parentNodeId)) {
        // eslint-disable-next-line no-console -- needed
        console.error(
          `[MindmapFlowProvider] onAddNode: parent node ${parentNodeId} not found in ${type} graph`
        );
        return null;
      }

      const newEdge = createEdge(parentNodeId, newNode.id);
      const siblingOrder = currentMindmapNodesMap[parentNodeId].children.size;
      addNodeToGraph(newGraph, newNode, newEdge);

      let updatedMindmapNodesMap = {
        ...currentMindmapNodesMap,
        [newNode.id]: createMindmapNodeFromFlowNode(
          newNode,
          parentNodeId,
          currentMindmapNodesMap[parentNodeId].level
        ),
      };

      if (parentNodeId) {
        updatedMindmapNodesMap = {
          ...updatedMindmapNodesMap,
          [parentNodeId]: addChildToMindmapNode(
            updatedMindmapNodesMap[parentNodeId],
            updatedMindmapNodesMap[newNode.id]
          ),
        };
      }

      const newRootNode = newGraph.node(ROOT_NODE_ID);
      const { nodes: newGraphNodes, edges: newGraphEdges } =
        transformMindmapNodesToFlowNodesAndEdges(updatedMindmapNodesMap);

      const updatedNodes = newGraphNodes.map<FlowNode>((partialNode) => {
        const node = createBaseFlowNodeFromPartialBaseFlowNode(partialNode);

        if (node.type === NodeTypes.ROOT) {
          return {
            ...node,
            position: {
              x: newGraph.node(node.id).x! - newRootNode.x!,
              y: newGraph.node(node.id).y! - newRootNode.y!,
            },
          };
        }

        if (node.type !== type) {
          return {
            ...node,
            // Keep nodes in the untouched graph at their existing layout.
            position: {
              x: oldGraph.node(node.id).x! - oldGraph.node(ROOT_NODE_ID).x!,
              y: oldGraph.node(node.id).y! - oldGraph.node(ROOT_NODE_ID).y!,
            },
          };
        }

        return {
          ...node,
          selected: node.id === parentNodeId,
          position: {
            x: newGraph.node(node.id).x! - newRootNode.x!,
            y: newGraph.node(node.id).y! - newRootNode.y!,
          },
        };
      });

      set((state) => ({
        nodes: updatedNodes,
        edges: newGraphEdges,
        mindmapNodesMap: updatedMindmapNodesMap,
        nodesMap: deriveNodesMap(updatedNodes),
        leveledNodes: deriveLeveledNodes(updatedMindmapNodesMap),
        pendingOps: appendPendingOp(state.pendingOps, {
          kind: "create",
          node: {
            nodeId: newNode.id,
            parentId: parentNodeId,
            type: newNode.type,
            title: newNode.data.title,
            ...(newNode.data.description === undefined
              ? {}
              : { description: newNode.data.description }),
            ...(newNode.data.link === undefined
              ? {}
              : { link: newNode.data.link }),
            order: siblingOrder,
          },
        }),
        syncState: "dirty",
        lastSyncError: null,
      }));

      return newNode.id;
    };

    /** Replaces one node's data across the flow and mindmap representations. */
    const onUpdateNode: MindmapFlowContext["actions"]["onUpdateNode"] = (
      nodeId,
      data
    ) => {
      set((state) => {
        const currentNode = state.nodesMap[nodeId];

        if (!currentNode) {
          return state;
        }

        const updatedNodes = state.nodes.map((node) =>
          node.id === nodeId ? { ...node, data } : node
        );
        const currentMindmapNode = state.mindmapNodesMap[nodeId];
        const updatedMindmapNodesMap = currentMindmapNode
          ? {
              ...state.mindmapNodesMap,
              [nodeId]: { ...currentMindmapNode, data },
            }
          : state.mindmapNodesMap;

        const updatedNode = { ...currentNode, data };
        const graph =
          updatedNode.type === NodeTypes.LEFT
            ? layout.leftGraph
            : layout.rightGraph;
        const patch = createNodeDataPatch(currentNode.data, data);
        const hasChanges = Object.keys(patch).length > 0;

        graph.setNode(nodeId, {
          height: calculateNodeHeight(updatedNode),
          width: NODE_DIMENSIONS.width,
        });

        return {
          nodes: updatedNodes,
          nodesMap: deriveNodesMap(updatedNodes),
          mindmapNodesMap: updatedMindmapNodesMap,
          leveledNodes: deriveLeveledNodes(updatedMindmapNodesMap),
          ...(hasChanges
            ? {
                pendingOps: appendPendingOp(state.pendingOps, {
                  kind: "update",
                  nodeId,
                  patch,
                }),
                syncState: "dirty" as const,
                lastSyncError: null,
              }
            : {}),
        };
      });
    };

    return {
      layout,
      nodes,
      edges,
      nodesMap: deriveNodesMap(nodes),
      mindmapNodesMap: initialMindmapNodesMap,
      leveledNodes: deriveLeveledNodes(initialMindmapNodesMap),
      activeNode: ROOT_NODE_ID,
      setActiveNode: (activeNode) => set({ activeNode }),
      selectedNode: null,
      setSelectedNode: (selectedNode) => set({ selectedNode }),
      aiEditNode: null,
      setAiEditNode: (aiEditNode) => set({ aiEditNode }),
      mindmapDB,
      pendingOps: [],
      lastSyncError: null,
      syncState: "idle",
      actions: {
        onNodesChange,
        onAddNode,
        onUpdateNode,
        drainPendingOps: () => {
          const ops = get().pendingOps;

          if (ops.length === 0) {
            return null;
          }

          set({ pendingOps: [] });
          return { ops, description: describePendingOps(ops) };
        },
        restorePendingOps: (ops) => {
          set((state) => ({ pendingOps: [...ops, ...state.pendingOps] }));
        },
        markSyncState: (syncState, error) => {
          set({
            syncState,
            lastSyncError: syncState === "error" ? (error ?? null) : null,
          });
        },
      },
    };
  });
}

export {
  createMindmapStore,
  createNodeDataPatch,
  deriveLeveledNodes,
  deriveNodesMap,
  type MindmapStore,
};
