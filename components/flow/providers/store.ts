import { applyNodeChanges, Edge } from "@xyflow/react";
import { createStore, StoreApi } from "zustand";

import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { generateLeveledNodes } from "../layout/generateLeveledNodes";
import { layoutGrove } from "../layout/grove";
import { estimateNodeSize } from "../layout/nodeSize";
import { createFlowEdgeFromPartialBaseFlowEdge } from "../mindmap/createEdge";
import {
  createBaseFlowNodeFromPartialBaseFlowNode,
  createNode,
} from "../mindmap/createNode";
import {
  addChildToMindmapNode,
  createMindmapNodeFromFlowNode,
  transformFlowNodesAndEdgesToMindmapNodes,
} from "../mindmap/flowNodeToMindmapNode";
import {
  PartialBaseFlowEdge,
  PartialBaseFlowNode,
  transformConvexNodesToFlowNodesAndEdges,
  transformMindmapNodesToFlowNodesAndEdges,
} from "../mindmap/mindmapNodesToFlowNodes";
import { appendPendingOp, PendingNodePatch } from "../mindmap/pendingOps";
import {
  BaseFlowNode,
  FlowEdge,
  FlowNode,
  MindmapNode,
  NodeTypes,
} from "../types";
import { MindmapFlowContext, ServerMindmapState } from "./types";

type MindmapStore = MindmapFlowContext;

type MindmapStoreSeedBase = {
  readOnly?: boolean;
  mindmapDB: MindmapDB;
};

type MindmapStoreSeed =
  | (MindmapStoreSeedBase & {
      serverNodes: MindmapNodeProjection[];
    })
  | (MindmapStoreSeedBase & {
      initialNodes: BaseFlowNode[];
      initialEdges: Edge[];
    });

type SeededGraphState = Pick<
  MindmapStore,
  "nodes" | "edges" | "nodesMap" | "mindmapNodesMap" | "leveledNodes"
>;

type FlowGraphSeed = {
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
 * Runs the canonical layout pipeline and derives every graph representation.
 */
function createSeededGraphState({
  initialNodes,
  initialEdges,
}: FlowGraphSeed): SeededGraphState {
  // An empty server snapshot is authoritative: there is no grove to grow, so
  // the empty seed is preserved rather than invented around.
  if (initialNodes.length === 0) {
    return {
      nodes: [],
      edges: initialEdges,
      nodesMap: {},
      mindmapNodesMap: {},
      leveledNodes: [],
    };
  }

  const nodes = layoutGrove(initialNodes, initialEdges);
  const edges = initialEdges;
  const mindmapNodesMap = transformFlowNodesAndEdgesToMindmapNodes(
    nodes,
    edges
  );

  return {
    nodes,
    edges,
    nodesMap: deriveNodesMap(nodes),
    mindmapNodesMap,
    leveledNodes: deriveLeveledNodes(mindmapNodesMap),
  };
}

/**
 * Re-grows the whole grove from the authoritative mindmap tree.
 *
 * The layout is a pure function of the tree, so every mutation re-lays out from
 * scratch instead of patching a mutable graph: cheap at map sizes (hundreds of
 * nodes at most) and it removes any chance of incremental drift between the
 * seeded layout and the live one.
 */
function relayoutFromMindmapNodes(
  mindmapNodesMap: Record<string, MindmapNode>
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const graph = transformMindmapNodesToFlowNodesAndEdges(mindmapNodesMap);
  const baseNodes = graph.nodes.map((node) =>
    createBaseFlowNodeFromPartialBaseFlowNode(node)
  );

  return { nodes: layoutGrove(baseNodes, graph.edges), edges: graph.edges };
}

/**
 * Transforms one sorted Convex projection through the canonical seed pipeline.
 */
function createSeededGraphStateFromServer(
  serverNodes: MindmapNodeProjection[]
): SeededGraphState {
  const graph = transformConvexNodesToFlowNodesAndEdges(serverNodes);
  const initialNodes = graph.nodes.map((node) =>
    createBaseFlowNodeFromPartialBaseFlowNode(node as PartialBaseFlowNode)
  );
  const initialEdges = graph.edges.map((edge) =>
    createFlowEdgeFromPartialBaseFlowEdge(edge as PartialBaseFlowEdge)
  );

  return createSeededGraphState({ initialNodes, initialEdges });
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

/** Reports an ignored read-only mutation during local development. */
function warnReadOnlyMutation(action: string): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console -- read-only violations should be visible during development
    console.warn(`[MindmapFlowProvider] ignored ${action} in read-only mode`);
  }
}

/**
 * Creates an isolated mindmap store seeded from one provider instance.
 *
 * Graph objects stay mutable as before, while each state write also refreshes
 * every derived view affected by that write.
 */
function createMindmapStore(seed: MindmapStoreSeed): StoreApi<MindmapStore> {
  const { mindmapDB } = seed;
  const readOnly = seed.readOnly ?? false;
  const initialGraphState =
    "serverNodes" in seed
      ? createSeededGraphStateFromServer(seed.serverNodes)
      : createSeededGraphState(seed);

  return createStore<MindmapStore>((set, get) => {
    /**
     * Replaces server-backed graph views while retaining local and UI state.
     */
    const reseedFromServer = (serverState: ServerMindmapState): boolean => {
      const current = get();

      if (readOnly) {
        warnReadOnlyMutation("reseedFromServer");
        return false;
      }

      if (
        serverState.updatedAt <= current.seededUpdatedAt ||
        serverState.updatedAt < current.acknowledgedServerVersion
      ) {
        return false;
      }

      const graphState = createSeededGraphStateFromServer(serverState.nodes);
      const liveNodeIds = new Set(Object.keys(graphState.nodesMap));
      const pendingTouchedNodeIds = current.pendingAiTouchedNodeIds;

      // The first commit mounts the server nodes; the second starts any queued
      // bloom only after those nodes can receive the CSS class.
      set((state) => ({
        ...graphState,
        activeNode:
          state.activeNode !== null && liveNodeIds.has(state.activeNode)
            ? state.activeNode
            : null,
        selectedNode:
          state.selectedNode !== null && liveNodeIds.has(state.selectedNode)
            ? state.selectedNode
            : null,
        aiEditNode:
          state.aiEditNode !== null && liveNodeIds.has(state.aiEditNode)
            ? state.aiEditNode
            : null,
        toolbarNode:
          state.toolbarNode !== null && liveNodeIds.has(state.toolbarNode)
            ? state.toolbarNode
            : null,
        mindmapDB: {
          ...state.mindmapDB,
          name: serverState.name,
          updatedAt: serverState.updatedAt,
          visibility: serverState.visibility,
        },
        reseedCount: state.reseedCount + 1,
        seededUpdatedAt: serverState.updatedAt,
        pendingServerState:
          state.pendingServerState !== null &&
          state.pendingServerState.updatedAt > serverState.updatedAt
            ? state.pendingServerState
            : null,
        pendingAiTouchedNodeIds: [],
      }));

      if (pendingTouchedNodeIds.length > 0) {
        set({ aiTouchedNodeIds: pendingTouchedNodeIds });
      }

      return true;
    };

    /** Applies XYFlow node changes and refreshes the node lookup atomically. */
    const onNodesChange: MindmapFlowContext["actions"]["onNodesChange"] = (
      changes
    ) => {
      const applicableChanges = readOnly
        ? changes.filter((change) => change.type !== "remove")
        : changes;

      if (applicableChanges.length !== changes.length) {
        warnReadOnlyMutation("onNodesChange remove");
      }

      if (applicableChanges.length === 0) {
        return;
      }

      set((state) => {
        const updatedNodes = applyNodeChanges(
          applicableChanges,
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
      data,
      options
    ) => {
      if (readOnly) {
        warnReadOnlyMutation("onAddNode");
        return null;
      }

      const currentState = get();
      const currentMindmapNodesMap = currentState.mindmapNodesMap;
      const parentMindmapNode = currentMindmapNodesMap[parentNodeId];

      if (!parentMindmapNode) {
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

      // A branch only ever grows into its own hemisphere: the root can seed
      // either side, but a left node can never sprout a right child.
      if (
        parentMindmapNode.type !== NodeTypes.ROOT &&
        parentMindmapNode.type !== type
      ) {
        // eslint-disable-next-line no-console -- needed
        console.error(
          `[MindmapFlowProvider] onAddNode: parent node ${parentNodeId} is not on the ${type} side`
        );
        return null;
      }

      let newNode = createNode(type, "New Node", id, data);
      while (!id && currentMindmapNodesMap[newNode.id]) {
        newNode = createNode(type, "New Node", undefined, data);
      }

      const siblingOrder = parentMindmapNode.children.size;

      let updatedMindmapNodesMap = {
        ...currentMindmapNodesMap,
        [newNode.id]: createMindmapNodeFromFlowNode(
          newNode,
          parentNodeId,
          parentMindmapNode.level
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

      const { nodes: laidOutNodes, edges: newGraphEdges } =
        relayoutFromMindmapNodes(updatedMindmapNodesMap);

      // The grown-from node keeps the selection, so the reader's place on the
      // canvas is the branch they just extended.
      const updatedNodes = laidOutNodes.map<FlowNode>((node) =>
        node.id === parentNodeId ? { ...node, selected: true } : node
      );

      set((state) => ({
        nodes: updatedNodes,
        edges: newGraphEdges,
        mindmapNodesMap: updatedMindmapNodesMap,
        nodesMap: deriveNodesMap(updatedNodes),
        leveledNodes: deriveLeveledNodes(updatedMindmapNodesMap),
        pendingOps: appendPendingOp(
          state.pendingOps,
          {
            kind: "create",
            source: options?.source ?? "user",
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
          },
          state.flushedWatermark
        ),
        syncState: state.syncState === "error" ? "error" : "dirty",
        lastSyncError: state.syncState === "error" ? state.lastSyncError : null,
      }));

      return newNode.id;
    };

    /** Replaces one node's data across the flow and mindmap representations. */
    const onUpdateNode: MindmapFlowContext["actions"]["onUpdateNode"] = (
      nodeId,
      data,
      options
    ) => {
      if (readOnly) {
        warnReadOnlyMutation("onUpdateNode");
        return;
      }

      set((state) => {
        const currentNode = state.nodesMap[nodeId];

        if (!currentNode) {
          return state;
        }

        const currentMindmapNode = state.mindmapNodesMap[nodeId];
        const updatedMindmapNodesMap = currentMindmapNode
          ? {
              ...state.mindmapNodesMap,
              [nodeId]: { ...currentMindmapNode, data },
            }
          : state.mindmapNodesMap;
        const patch = createNodeDataPatch(currentNode.data, data);
        const hasChanges = Object.keys(patch).length > 0;

        // New copy only moves the grove when it changes how much room the card
        // takes (gaining or losing its description). A title edit keeps every
        // position, so the canvas is not re-rendered wholesale on each save.
        const resizesCard =
          currentMindmapNode !== undefined &&
          estimateNodeSize(currentNode, currentMindmapNode.level).height !==
            estimateNodeSize({ data }, currentMindmapNode.level).height;

        // Transient XYFlow flags (selection) are carried across the relayout.
        const updatedNodes = resizesCard
          ? relayoutFromMindmapNodes(
              updatedMindmapNodesMap
            ).nodes.map<FlowNode>((node) => {
              const previous = state.nodesMap[node.id];
              return previous === undefined
                ? node
                : { ...node, selected: previous.selected };
            })
          : state.nodes.map((node) =>
              node.id === nodeId ? { ...node, data } : node
            );

        return {
          nodes: updatedNodes,
          nodesMap: deriveNodesMap(updatedNodes),
          mindmapNodesMap: updatedMindmapNodesMap,
          leveledNodes: deriveLeveledNodes(updatedMindmapNodesMap),
          ...(hasChanges
            ? {
                pendingOps: appendPendingOp(
                  state.pendingOps,
                  {
                    kind: "update",
                    source: options?.source ?? "user",
                    nodeId,
                    patch,
                  },
                  state.flushedWatermark
                ),
                syncState:
                  state.syncState === "error"
                    ? ("error" as const)
                    : ("dirty" as const),
                lastSyncError:
                  state.syncState === "error" ? state.lastSyncError : null,
              }
            : {}),
        };
      });
    };

    return {
      readOnly,
      ...initialGraphState,
      activeNode: ROOT_NODE_ID,
      setActiveNode: (activeNode) => set({ activeNode }),
      selectedNode: null,
      setSelectedNode: (selectedNode) => {
        if (!readOnly) {
          set({ selectedNode });
        }
      },
      aiEditNode: null,
      setAiEditNode: (aiEditNode) => {
        if (!readOnly) {
          set({ aiEditNode });
        }
      },
      aiEditAction: "grow",
      setAiEditAction: (aiEditAction) => {
        if (!readOnly) {
          set({ aiEditAction });
        }
      },
      toolbarNode: null,
      setToolbarNode: (toolbarNode) => {
        if (!readOnly) {
          set({ toolbarNode });
        }
      },
      aiPromptRequest: null,
      aiStreaming: false,
      aiTouchedNodeIds: [],
      pendingAiTouchedNodeIds: [],
      setAiTouchedNodeIds: (nodeIds) => {
        if (readOnly) {
          warnReadOnlyMutation("setAiTouchedNodeIds");
          return;
        }

        // Created ids may arrive before their server-refreshed nodes mount.
        set({ aiTouchedNodeIds: nodeIds });
      },
      mindmapDB,
      acknowledgedServerVersion: mindmapDB.updatedAt,
      reseedCount: 0,
      seededUpdatedAt: mindmapDB.updatedAt,
      pendingServerState: null,
      pendingOps: [],
      flushedWatermark: 0,
      lastSyncError: null,
      desyncedSinceRejection: false,
      syncRetryNonce: 0,
      syncState: "idle",
      actions: {
        onNodesChange,
        onAddNode,
        onUpdateNode,
        reseedFromServer,
        reconcileServerState: (serverState) => {
          const state = get();

          if (
            readOnly ||
            serverState.updatedAt <= state.seededUpdatedAt ||
            serverState.updatedAt < state.acknowledgedServerVersion
          ) {
            return;
          }

          if (state.pendingOps.length > 0 || state.syncState === "saving") {
            if (
              state.pendingServerState === null ||
              serverState.updatedAt > state.pendingServerState.updatedAt
            ) {
              set({ pendingServerState: serverState });
            }
            return;
          }

          reseedFromServer(serverState);
        },
        applyPendingServerState: () => {
          const state = get();

          if (
            state.pendingServerState === null ||
            state.pendingOps.length > 0 ||
            state.syncState === "saving"
          ) {
            return false;
          }

          if (
            state.pendingServerState.updatedAt < state.acknowledgedServerVersion
          ) {
            set({ pendingServerState: null });
            return false;
          }

          return reseedFromServer(state.pendingServerState);
        },
        setAiTouchedNodeIdsAfterReseed: (
          nodeIds,
          seededUpdatedAtAtTurnStart
        ) => {
          if (readOnly) {
            warnReadOnlyMutation("setAiTouchedNodeIdsAfterReseed");
            return;
          }

          const state = get();
          const touchedNodesAreMounted = nodeIds.every(
            (nodeId) => state.nodesMap[nodeId] !== undefined
          );
          if (
            state.seededUpdatedAt > seededUpdatedAtAtTurnStart &&
            touchedNodesAreMounted
          ) {
            state.setAiTouchedNodeIds(nodeIds);
            return;
          }

          set((current) => ({
            pendingAiTouchedNodeIds: Array.from(
              new Set([...current.pendingAiTouchedNodeIds, ...nodeIds])
            ),
          }));
        },
        peekPendingOps: () => {
          const ops = get().pendingOps;

          if (ops.length === 0) {
            return null;
          }

          // Protect exactly this prefix from coalescing until it is committed.
          set({ flushedWatermark: ops.length });
          return { ops: [...ops], count: ops.length };
        },
        commitFlushedOps: (count, acknowledgedUpdatedAt) => {
          set((state) => {
            if (
              count < 0 ||
              count > state.flushedWatermark ||
              count > state.pendingOps.length
            ) {
              throw new Error("Cannot commit outside the flushed prefix");
            }

            const acknowledgedServerVersion =
              acknowledgedUpdatedAt === undefined
                ? state.acknowledgedServerVersion
                : Math.max(
                    state.acknowledgedServerVersion,
                    acknowledgedUpdatedAt
                  );

            return {
              acknowledgedServerVersion,
              pendingOps: state.pendingOps.slice(count),
              flushedWatermark: state.flushedWatermark - count,
              pendingServerState:
                state.pendingServerState !== null &&
                state.pendingServerState.updatedAt < acknowledgedServerVersion
                  ? null
                  : state.pendingServerState,
            };
          });
        },
        releaseFlushedOps: () => {
          set({ flushedWatermark: 0 });
        },
        retrySync: () => {
          set((state) => ({ syncRetryNonce: state.syncRetryNonce + 1 }));
        },
        flushNow: async () => {
          const state = get();
          return state.pendingOps.length === 0 && state.syncState === "idle";
        },
        registerFlushNow: (flushNow) => {
          set((state) => ({
            actions: { ...state.actions, flushNow },
          }));

          return () => {
            if (get().actions.flushNow !== flushNow) {
              return;
            }

            set((state) => ({
              actions: {
                ...state.actions,
                flushNow: async () => {
                  const current = get();
                  return (
                    current.pendingOps.length === 0 &&
                    current.syncState === "idle"
                  );
                },
              },
            }));
          };
        },
        markSyncRejected: (error) => {
          set({
            desyncedSinceRejection: true,
            syncState: "error",
            lastSyncError: error,
          });
        },
        markSyncState: (syncState, error) => {
          set({
            syncState,
            lastSyncError: syncState === "error" ? (error ?? null) : null,
          });
        },
        requestAiPrompt: (nodeId, prompt) => {
          if (readOnly) {
            warnReadOnlyMutation("requestAiPrompt");
            return;
          }

          set((state) => ({
            aiPromptRequest: {
              requestId: (state.aiPromptRequest?.requestId ?? 0) + 1,
              nodeId,
              prompt,
            },
          }));
        },
        clearAiPromptRequest: () => {
          set({ aiPromptRequest: null });
        },
        setAiStreaming: (aiStreaming) => {
          set({ aiStreaming });
        },
      },
    };
  });
}

export {
  createMindmapStore,
  createNodeDataPatch,
  createSeededGraphStateFromServer,
  deriveLeveledNodes,
  deriveNodesMap,
  type MindmapStore,
};
