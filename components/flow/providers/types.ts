import { EdgeLabel, GraphLabel, graphlib, NodeLabel } from "@dagrejs/dagre";
import { ReactFlowProps } from "@xyflow/react";

import { MindmapDB } from "@/types/Mindmap";

import { NodeOp, PendingOpSource } from "../mindmap/pendingOps";
import { FlowEdge, FlowNode, MindmapNode, NodeTypes } from "../types";

type DagreGraph = graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>;

// todo: add documentation for the context
type MindmapFlowContext = {
  readOnly: boolean;
  layout: {
    leftGraph: DagreGraph;
    rightGraph: DagreGraph;
  };
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

  /**
   * Nodes the model just created or edited, held only long enough to bloom.
   *
   * The canvas reads this to add `.sprig-ai-touched`; the flash is transient by
   * design, so whoever sets it is also responsible for clearing it.
   */
  aiTouchedNodeIds: string[];
  setAiTouchedNodeIds: (nodeIds: string[]) => void;

  mindmapDB: MindmapDB;
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
    peekPendingOps: () => {
      ops: NodeOp[];
      count: number;
    } | null;
    commitFlushedOps: (count: number) => void;
    releaseFlushedOps: () => void;
    retrySync: () => void;
    flushNow: () => Promise<boolean>;
    registerFlushNow: (flushNow: () => Promise<boolean>) => () => void;
    markSyncRejected: (error: string) => void;
    markSyncState: (
      state: MindmapFlowContext["syncState"],
      error?: string
    ) => void;
  };
};

export { type MindmapFlowContext };
