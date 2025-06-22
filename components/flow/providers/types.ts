import { graphlib } from "@dagrejs/dagre";
import { Edge, Node, ReactFlowProps } from "@xyflow/react";

import { FlowNode, MindmapNode, NodeTypes } from "../types";

// todo: add documentation for the context
export type MindmapFlowContext = {
  layout: {
    leftGraph: graphlib.Graph<object>;
    rightGraph: graphlib.Graph<object>;
  };
  nodes: Node[];
  edges: Edge[];
  nodesMap: Record<string, FlowNode>;
  mindmapNodesMap: Record<string, MindmapNode>;
  leveledNodes: MindmapNode[][];

  activeNode: string | null;
  setActiveNode: (nodeId: string | null) => void;

  selectedNode: string | null;
  setSelectedNode: (nodeId: string | null) => void;

  actions: {
    onNodesChange: NonNullable<ReactFlowProps["onNodesChange"]>;
    // onEdgesChange: NonNullable<ReactFlowProps["onEdgesChange"]>;
    // onConnect: NonNullable<ReactFlowProps["onConnect"]>;
    onAddNode: (
      type: NodeTypes.LEFT | NodeTypes.RIGHT,
      parentNodeId: string
    ) => void;
    onUpdateNode: (nodeId: string, data: FlowNode["data"]) => void;
  };
};
