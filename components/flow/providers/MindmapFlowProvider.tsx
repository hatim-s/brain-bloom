import { graphlib } from "@dagrejs/dagre";
import {
  addNodeToGraph,
  // initGraph,
  initGraphs,
  initLayout,
} from "../layout/init";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Edge, Node, ReactFlowProps } from "@xyflow/react";
import { createNode } from "../mindmap/createNode";
import { createEdge } from "../mindmap/createEdge";
import { BaseFlowNode, FlowNode, NodeTypes } from "../types";
import { ROOT_NODE_ID } from "../const";
import { useCreateXYFlowActions } from "./useCreateXYFlowActions";

export type MindmapFlowContext = {
  layout: {
    leftGraph: graphlib.Graph<{}>;
    rightGraph: graphlib.Graph<{}>;
  };
  nodes: Node[];
  edges: Edge[];
  nodesMap: Record<string, FlowNode>;
  actions: {
    onNodesChange: NonNullable<ReactFlowProps["onNodesChange"]>;
    // onEdgesChange: NonNullable<ReactFlowProps["onEdgesChange"]>;
    // onConnect: NonNullable<ReactFlowProps["onConnect"]>;
    onAddNode: (
      type: NodeTypes.LEFT | NodeTypes.RIGHT,
      parentNodeId: string
    ) => void;
  };
};

const MindmapFlowContext = createContext<MindmapFlowContext | null>(null);

export const useMindmapFlow = () => {
  const context = useContext(MindmapFlowContext);
  if (!context) {
    throw new Error("useMindmapFlow must be used within a MindmapFlowProvider");
  }
  return context;
};

type MindmapFlowProviderProps = {
  children: React.ReactNode;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
};

export const MindmapFlowProvider = ({
  children,
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

  const onAddNode = useCallback<
    NonNullable<MindmapFlowContext["actions"]["onAddNode"]>
  >(
    (type, parentNodeId) => {
      if (!nodesMap[parentNodeId]) {
        console.error(
          `[MindmapFlowProvider] onAddNode: parent node ${parentNodeId} not found`
        );
        return;
      }

      const newNode = createNode(type, "new node");
      const newEdge = createEdge(parentNodeId, newNode.id);

      const newGraph = type === NodeTypes.LEFT ? leftGraph : rightGraph;

      addNodeToGraph(newGraph, newNode, newEdge);

      const nodesNotInCurrentGraph = nodes.filter(
        (node) => node.type !== type && node.id !== ROOT_NODE_ID
      );

      const newRootNode = newGraph.node(ROOT_NODE_ID);

      const updatedNodes = [
        ...nodesNotInCurrentGraph,
        ...newGraph.nodes().map((nodeId) => {
          const _node = nodesMap[nodeId];
          const _graphnode = newGraph.node(nodeId);
          return {
            ...(_node ?? newNode),
            position: {
              x: _graphnode.x - newRootNode.x,
              y: _graphnode.y - newRootNode.y,
            },
          };
        }),
      ] as FlowNode[];

      setNodes(updatedNodes);

      setEdges((edges) => {
        return [...edges, newEdge];
      });
    },
    [nodes, nodesMap, leftGraph, rightGraph]
  );

  const context = useMemo<MindmapFlowContext>(() => {
    return {
      layout: {
        leftGraph,
        rightGraph,
      },
      nodes: nodes,
      edges: edges,
      nodesMap: nodesMap,
      actions: {
        onNodesChange,
        // onEdgesChange,
        // onConnect,
        onAddNode,
      },
    };
  }, [
    leftGraph,
    rightGraph,
    // onNodesChange,
    // onEdgesChange,
    // onConnect,
    nodes,
    edges,
    nodesMap,
    onAddNode,
  ]);

  return (
    <MindmapFlowContext.Provider value={context}>
      {children}
    </MindmapFlowContext.Provider>
  );
};
