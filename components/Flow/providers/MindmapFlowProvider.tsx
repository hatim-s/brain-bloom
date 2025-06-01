import { graphlib } from "@dagrejs/dagre";
import {
  addNodeToGraph,
  initGraph,
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
import { useCreateXYFlowActions } from "./useCreateXYFlowActions";
import { createNode } from "../mindmap/createNode";
import { createEdge } from "../mindmap/createEdge";
import { BaseFlowNode, FlowNode } from "../types";
import omit from "lodash/omit";

export type MindmapFlowContext = {
  layout: {
    leftGraph: graphlib.Graph<{}>;
    rightGraph: graphlib.Graph<{}>;
  };
  nodes: Node[];
  edges: Edge[];
  actions: {
    onNodesChange: NonNullable<ReactFlowProps["onNodesChange"]>;
    onEdgesChange: NonNullable<ReactFlowProps["onEdgesChange"]>;
    onConnect: NonNullable<ReactFlowProps["onConnect"]>;
    onAddNode: (type: "left" | "right") => void;
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

  const nodeWithPositions = initLayout(
    { leftGraph, rightGraph },
    initialNodes,
    initialEdges
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

  const { onNodesChange, onEdgesChange, onConnect } = useCreateXYFlowActions({
    setNodes,
    setEdges,
  });

  const onAddNode = useCallback(
    (type: "left" | "right") => {
      const newNode = createNode(type, "new node");
      const newEdge = createEdge("left-1", newNode.id);

      const newGraph = type === "left" ? leftGraph : rightGraph;

      // nodes.forEach((node) => {
      //   if (node.type === "root" || node.type === type) {
      //     newGraph.setNode(node.id, omit(node, ["position"]));
      //   }
      // });

      // edges.forEach((edge) => {
      //   if (edge.target.startsWith(type)) {
      //     newGraph.setEdge(edge.source, edge.target);
      //   }
      // });

      addNodeToGraph(newGraph, newNode, newEdge);

      const nodesNotInCurrentGraph = nodes.filter(
        (node) => node.type !== type && node.id !== "root"
      );

      const newRootNode = newGraph.node("root");

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
    [nodes]
  );

  console.log(leftGraph.nodes());

  const context = useMemo<MindmapFlowContext>(() => {
    return {
      layout: {
        leftGraph,
        rightGraph,
      },
      nodes: nodes,
      edges: edges,
      actions: {
        onNodesChange,
        onEdgesChange,
        onConnect,
        onAddNode,
      },
    };
  }, [
    leftGraph,
    rightGraph,
    onNodesChange,
    onEdgesChange,
    onConnect,
    nodes,
    edges,
  ]);

  return (
    <MindmapFlowContext.Provider value={context}>
      {children}
    </MindmapFlowContext.Provider>
  );
};
