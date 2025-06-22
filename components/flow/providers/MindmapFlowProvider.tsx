import { Edge } from "@xyflow/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { useKey } from "@/hooks/use-key";
import { MindmapDB } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { generateLeveledNodes } from "../layout/generateLeveledNodes";
import { initGraphs, initLayout } from "../layout/init";
import { transformFlowNodesAndEdgesToMindmapNodes } from "../mindmap/flowNodeToMindmapNode";
import { BaseFlowNode, FlowNode, MindmapNode } from "../types";
import { useCreateMindmapActions } from "./actions/useCreateMindmapActions";
import { useCreateXYFlowActions } from "./actions/useCreateXYFlowActions";
import { MindmapFlowContext as MindmapFlowContextType } from "./types";

const MindmapFlowContext = createContext<MindmapFlowContextType | null>(null);

export const useMindmapFlow = () => {
  const context = useContext(MindmapFlowContext);
  if (!context) {
    throw new Error("useMindmapFlow must be used within a MindmapFlowProvider");
  }
  return context;
};

type MindmapFlowProviderProps = {
  children: React.ReactNode;
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
};

export const MindmapFlowProvider = ({
  children,
  mindmapDB,
  initialNodes,
  initialEdges,
}: MindmapFlowProviderProps) => {
  const { leftGraph, rightGraph } = useMemo(() => initGraphs(), []);

  const nodeWithPositions = useMemo(
    () => initLayout({ leftGraph, rightGraph }, initialNodes, initialEdges),
    [leftGraph, rightGraph, initialNodes, initialEdges]
  );

  const [nodes, setNodes] = useState(nodeWithPositions);
  const [edges, setEdges] = useState(initialEdges);

  const [mindmapNodesMap, setMindmapNodesMap] = useState<
    Record<string, MindmapNode>
  >(() => transformFlowNodesAndEdgesToMindmapNodes(nodes, edges));

  // todo: perf optimize this by manually adding/deleting nodes from the leveledNodes
  const leveledNodes = useMemo(
    () => generateLeveledNodes(mindmapNodesMap),
    [mindmapNodesMap]
  );

  const nodesMap = useMemo(
    () =>
      nodes.reduce(
        (acc, node) => {
          acc[node.id] = node;
          return acc;
        },
        {} as Record<string, FlowNode>
      ),
    [nodes]
  );

  const {
    onNodesChange,
    //  onEdgesChange, onConnect
  } = useCreateXYFlowActions({
    setNodes,
    setEdges,
  });

  const { onAddNode, onUpdateNode } = useCreateMindmapActions({
    nodes,
    setNodes,
    edges,
    setEdges,
    nodesMap,
    mindmapNodesMap,
    setMindmapNodesMap,
    graphs: { leftGraph, rightGraph },
  });

  const [activeNode, setActiveNode] = useState<string | null>(ROOT_NODE_ID);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const context = useMemo<MindmapFlowContextType>(() => {
    return {
      layout: {
        leftGraph,
        rightGraph,
      },
      nodes: nodes,
      edges: edges,
      nodesMap: nodesMap,
      mindmapNodesMap: mindmapNodesMap,
      leveledNodes: leveledNodes,
      activeNode,
      setActiveNode,
      selectedNode,
      setSelectedNode,
      mindmapDB,
      actions: {
        onNodesChange,
        // onEdgesChange,
        // onConnect,
        onAddNode,
        onUpdateNode,
      },
    } as MindmapFlowContextType;
  }, [
    leftGraph,
    rightGraph,
    onNodesChange,
    // onEdgesChange,
    // onConnect,
    mindmapNodesMap,
    leveledNodes,
    nodes,
    edges,
    nodesMap,
    onAddNode,
    onUpdateNode,
    activeNode,
    selectedNode,
    mindmapDB,
  ]);

  const debugLogger = useCallback(() => {
    // eslint-disable-next-line no-console -- needed for debug logging
    console.log("mindmap", context);
  }, [context]);

  useKey("d", debugLogger, { isAltKey: true });

  return (
    <MindmapFlowContext.Provider value={context}>
      {children}
    </MindmapFlowContext.Provider>
  );
};
