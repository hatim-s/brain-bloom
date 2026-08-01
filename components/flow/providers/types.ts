import { ReactFlowProps } from "@xyflow/react";

import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";

import { NodeOp, PendingOpSource } from "../mindmap/pendingOps";
import { FlowEdge, FlowNode, MindmapNode, NodeTypes } from "../types";

/** The scoped intents the contextual node toolbar can hand to the model. */
type AiEditAction = "grow" | "refine" | "explain";

/** One node-scoped instruction handed from the canvas to the chat surface. */
type AiPromptRequest = {
  requestId: number;
  nodeId: string;
  prompt: string;
};

/** A versioned server graph waiting for the local operation queue to drain. */
type ServerMindmapState = {
  name: string;
  nodes: MindmapNodeProjection[];
  updatedAt: number;
  visibility: MindmapDB["visibility"];
};

/** All mutable and derived state owned by one canvas provider. */
type MindmapFlowContext = {
  readOnly: boolean;
  /**
   * The Grove layout is a pure function of the tree, so the canvas keeps no
   * layout state: every mutation re-lays out from `mindmapNodesMap` + `edges`.
   */
  nodes: FlowNode[];
  edges: FlowEdge[];

  nodesMap: Record<string, FlowNode>;
  mindmapNodesMap: Record<string, MindmapNode>;

  leveledNodes: MindmapNode[][];

  activeNode: string | null;
  setActiveNode: (nodeId: string | null) => void;

  selectedNode: string | null;
  setSelectedNode: (nodeId: string | null) => void;

  aiEditNode: string | null;
  setAiEditNode: (nodeId: string | null) => void;

  /** Which scoped intent the inline node prompt is currently phrased around. */
  aiEditAction: AiEditAction;
  setAiEditAction: (action: AiEditAction) => void;

  /**
   * The node whose contextual toolbar is showing.
   *
   * Set only from a real pointer selection, never from the seed-time root
   * auto-select, so opening a map does not greet the reader with chrome.
   */
  toolbarNode: string | null;
  setToolbarNode: (nodeId: string | null) => void;

  /**
   * A node-scoped instruction waiting for the conversation surface.
   *
   * The inline prompt writes it; the AI panel (which owns the chat transport
   * and thread identity) consumes it and clears it. `requestId` makes each
   * dispatch unique so an identical retry still re-triggers the consumer.
   */
  aiPromptRequest: AiPromptRequest | null;

  /** True while the panel's chat transport has a turn in flight. */
  aiStreaming: boolean;

  /**
   * Nodes the model just created or edited, held only long enough to bloom.
   *
   * The canvas reads this to add `.sprig-ai-touched`; the flash is transient by
   * design, so whoever sets it is also responsible for clearing it.
   */
  aiTouchedNodeIds: string[];
  setAiTouchedNodeIds: (nodeIds: string[]) => void;
  pendingAiTouchedNodeIds: string[];

  mindmapDB: MindmapDB;
  acknowledgedServerVersion: number;
  reseedCount: number;
  seededUpdatedAt: number;
  pendingServerState: ServerMindmapState | null;
  pendingOps: NodeOp[];
  flushedWatermark: number;
  lastSyncError: string | null;
  desyncedSinceRejection: boolean;
  syncRetryNonce: number;
  syncState: "idle" | "dirty" | "saving" | "error";

  actions: {
    onNodesChange: NonNullable<ReactFlowProps["onNodesChange"]>;
    // onEdgesChange: NonNullable<ReactFlowProps["onEdgesChange"]>;
    // onConnect: NonNullable<ReactFlowProps["onConnect"]>;
    onAddNode: (
      type: NodeTypes.LEFT | NodeTypes.RIGHT,
      parentNodeId: string,
      id?: string,
      data?: FlowNode["data"],
      options?: { source?: PendingOpSource }
    ) => string | null;
    onUpdateNode: (
      nodeId: string,
      data: FlowNode["data"],
      options?: { source?: PendingOpSource }
    ) => void;
    reseedFromServer: (serverState: ServerMindmapState) => boolean;
    reconcileServerState: (serverState: ServerMindmapState) => void;
    applyPendingServerState: () => boolean;
    setAiTouchedNodeIdsAfterReseed: (
      nodeIds: string[],
      seededUpdatedAtAtTurnStart: number
    ) => void;
    peekPendingOps: () => {
      ops: NodeOp[];
      count: number;
    } | null;
    commitFlushedOps: (count: number, acknowledgedUpdatedAt?: number) => void;
    releaseFlushedOps: () => void;
    retrySync: () => void;
    flushNow: () => Promise<boolean>;
    registerFlushNow: (flushNow: () => Promise<boolean>) => () => void;
    markSyncRejected: (error: string) => void;
    markSyncState: (
      state: MindmapFlowContext["syncState"],
      error?: string
    ) => void;
    /** Queues one node-scoped instruction for the conversation surface. */
    requestAiPrompt: (nodeId: string, prompt: string) => void;
    /** Acknowledges the queued instruction once the chat surface owns it. */
    clearAiPromptRequest: () => void;
    /** Mirrors the chat transport's streaming state into canvas reach. */
    setAiStreaming: (isStreaming: boolean) => void;
  };
};

export {
  type AiEditAction,
  type AiPromptRequest,
  type MindmapFlowContext,
  type ServerMindmapState,
};
