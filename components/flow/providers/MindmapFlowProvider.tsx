import { graphlib } from "@dagrejs/dagre";
import { Edge, Node, ReactFlowProps } from "@xyflow/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { useKey } from "@/hooks/use-key";

import { ROOT_NODE_ID } from "../const";
import { bfs } from "../layout/bfs";
import {
  addNodeToGraph,
  // initGraph,
  initGraphs,
  initLayout,
} from "../layout/init";
import { createEdge } from "../mindmap/createEdge";
import {
  addChildToMindmapNode,
  createMindmapNodeFromFlowNode,
  getParentNodeIdFromFLow,
} from "../mindmap/createMindmapNodeFromFlowNode";
import { createNode } from "../mindmap/createNode";
import { BaseFlowNode, FlowNode, MindmapNode, NodeTypes } from "../types";
import { useCreateXYFlowActions } from "./useCreateXYFlowActions";

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

  const [mindmapNodesMap, setMindmapNodesMap] = useState<
    Record<string, MindmapNode>
  >(() => {
    return nodes.reduce<Record<string, MindmapNode>>((acc, node) => {
      const parentNodeId = getParentNodeIdFromFLow(node, edges);
      acc[node.id] = createMindmapNodeFromFlowNode(
        node,
        parentNodeId,
        parentNodeId ? acc[parentNodeId].level : 0
      );

      // if the node has a parent, add it to the parent's children
      if (parentNodeId) {
        acc[parentNodeId] = addChildToMindmapNode(
          acc[parentNodeId],
          acc[node.id]
        );
      }
      return acc;
    }, {});
  });

  // todo: perf optimize this by manually adding/deleting nodes from the leveledNodes
  const leveledNodes = useMemo(() => bfs(mindmapNodesMap), [mindmapNodesMap]);

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
        // eslint-disable-next-line no-console -- needed
        console.error(
          `[MindmapFlowProvider] onAddNode: parent node ${parentNodeId} not found`
        );
        return;
      }

      const newNode = createNode(type, "new node");
      const newEdge = createEdge(parentNodeId, newNode.id);

      const newGraph = type === NodeTypes.LEFT ? leftGraph : rightGraph;

      addNodeToGraph(newGraph, newNode, newEdge);

      setMindmapNodesMap((prevMindmapNodesMap) => {
        const newMindmapNodesMap = {
          ...prevMindmapNodesMap,
          [newNode.id]: createMindmapNodeFromFlowNode(
            newNode,
            parentNodeId,
            prevMindmapNodesMap[parentNodeId].level
          ),
        };

        if (parentNodeId) {
          newMindmapNodesMap[parentNodeId] = addChildToMindmapNode(
            newMindmapNodesMap[parentNodeId],
            newMindmapNodesMap[newNode.id]
          );
        }

        return newMindmapNodesMap;
      });

      const nodesNotInCurrentGraph = nodes.filter(
        (node) => node.type !== type && node.id !== ROOT_NODE_ID
      );

      const newRootNode = newGraph.node(ROOT_NODE_ID);

      const updatedNodes = [
        // root node should come in first
        {
          ...nodesMap[ROOT_NODE_ID],
          position: {
            x: newRootNode.x - newRootNode.x,
            y: newRootNode.y - newRootNode.y,
          },
        },
        ...nodesNotInCurrentGraph,
        ...newGraph
          .nodes()
          .filter((nodeId) => nodeId !== ROOT_NODE_ID) // root node is already added
          .map((nodeId) => {
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

  const onUpdateNode = useCallback<
    NonNullable<MindmapFlowContext["actions"]["onUpdateNode"]>
  >((nodeId, data) => {
    setNodes((nodes) => {
      return nodes.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data };
        }
        return node;
      });
    });
  }, []);

  const [activeNode, setActiveNode] = useState<string | null>(ROOT_NODE_ID);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const context = useMemo<MindmapFlowContext>(() => {
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
      actions: {
        onNodesChange,
        // onEdgesChange,
        // onConnect,
        onAddNode,
        onUpdateNode,
      },
    } as MindmapFlowContext;
  }, [
    leftGraph,
    rightGraph,
    // onNodesChange,
    // onEdgesChange,
    // onConnect,
    mindmapNodesMap,
    leveledNodes,
    nodes,
    edges,
    nodesMap,
    onAddNode,
    onUpdateNode,
    onNodesChange,
    activeNode,
    selectedNode,
  ]);

  const debugLogger = useCallback(() => {
    console.log("mindmap", context);
  }, [context]);

  useKey("d", debugLogger, { isAltKey: true });

  return (
    <MindmapFlowContext.Provider value={context}>
      {children}
    </MindmapFlowContext.Provider>
  );
};
