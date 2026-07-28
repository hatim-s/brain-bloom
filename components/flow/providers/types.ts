import { EdgeLabel, GraphLabel, graphlib, NodeLabel } from "@dagrejs/dagre";
import { ReactFlowProps } from "@xyflow/react";

import { MindmapDB } from "@/types/Mindmap";

import { NodeOp } from "../mindmap/pendingOps";
import { FlowEdge, FlowNode, MindmapNode, NodeTypes } from "../types";

type DagreGraph = graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>;

// todo: add documentation for the context
export type MindmapFlowContext = {
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

  mindmapDB: MindmapDB;
  pendingOps: NodeOp[];
  lastSyncError: string | null;
  syncState: "idle" | "dirty" | "saving" | "error";

  actions: {
    onNodesChange: NonNullable<ReactFlowProps["onNodesChange"]>;
    // onEdgesChange: NonNullable<ReactFlowProps["onEdgesChange"]>;
    // onConnect: NonNullable<ReactFlowProps["onConnect"]>;
    onAddNode: (
      type: NodeTypes.LEFT | NodeTypes.RIGHT,
      parentNodeId: string,
      id?: string,
      data?: FlowNode["data"]
    ) => string | null;
    onUpdateNode: (nodeId: string, data: FlowNode["data"]) => void;
    drainPendingOps: () => {
      ops: NodeOp[];
      description: string;
    } | null;
    restorePendingOps: (ops: NodeOp[]) => void;
    markSyncState: (
      state: MindmapFlowContext["syncState"],
      error?: string
    ) => void;
  };
};
