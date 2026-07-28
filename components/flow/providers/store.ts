import { applyNodeChanges, Edge } from "@xyflow/react";
import { createStore, StoreApi } from "zustand";

import { MindmapDB } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { generateLeveledNodes } from "../layout/generateLeveledNodes";
import { addNodeToGraph, initGraphs, initLayout } from "../layout/init";
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

  // This closure preserves the old ref's synchronous multi-add semantics.
  let mindmapNodesMapSync = initialMindmapNodesMap;

  return createStore<MindmapStore>((set) => {
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
      if (!mindmapNodesMapSync[parentNodeId]) {
        // eslint-disable-next-line no-console -- needed
        console.error(
          `[MindmapFlowProvider] onAddNode: parent node ${parentNodeId} not found`
        );
        return null;
      }

      const newNode = createNode(type, "New Node", id, data);
      const newEdge = createEdge(parentNodeId, newNode.id);

      const newGraph =
        type === NodeTypes.LEFT ? layout.leftGraph : layout.rightGraph;
      const oldGraph =
        type === NodeTypes.LEFT ? layout.rightGraph : layout.leftGraph;

      addNodeToGraph(newGraph, newNode, newEdge);

      mindmapNodesMapSync = {
        ...mindmapNodesMapSync,
        [newNode.id]: createMindmapNodeFromFlowNode(
          newNode,
          parentNodeId,
          mindmapNodesMapSync[parentNodeId].level
        ),
      };

      if (parentNodeId) {
        mindmapNodesMapSync[parentNodeId] = addChildToMindmapNode(
          mindmapNodesMapSync[parentNodeId],
          mindmapNodesMapSync[newNode.id]
        );
      }

      const newRootNode = newGraph.node(ROOT_NODE_ID);
      const { nodes: newGraphNodes, edges: newGraphEdges } =
        transformMindmapNodesToFlowNodesAndEdges(mindmapNodesMapSync);

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

      set({
        nodes: updatedNodes,
        edges: newGraphEdges,
        mindmapNodesMap: mindmapNodesMapSync,
        nodesMap: deriveNodesMap(updatedNodes),
        leveledNodes: deriveLeveledNodes(mindmapNodesMapSync),
      });

      return newNode.id;
    };

    /** Replaces one node's data across the flow and mindmap representations. */
    const onUpdateNode: MindmapFlowContext["actions"]["onUpdateNode"] = (
      nodeId,
      data
    ) => {
      set((state) => {
        const updatedNodes = state.nodes.map((node) =>
          node.id === nodeId ? { ...node, data } : node
        );
        const currentMindmapNode = mindmapNodesMapSync[nodeId];

        if (currentMindmapNode) {
          mindmapNodesMapSync = {
            ...mindmapNodesMapSync,
            [nodeId]: { ...currentMindmapNode, data },
          };
        }

        return {
          nodes: updatedNodes,
          nodesMap: deriveNodesMap(updatedNodes),
          mindmapNodesMap: mindmapNodesMapSync,
          leveledNodes: deriveLeveledNodes(mindmapNodesMapSync),
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
      actions: {
        onNodesChange,
        onAddNode,
        onUpdateNode,
      },
    };
  });
}

export {
  createMindmapStore,
  deriveLeveledNodes,
  deriveNodesMap,
  type MindmapStore,
};
