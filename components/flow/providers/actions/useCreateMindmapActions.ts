import { graphlib } from "@dagrejs/dagre";
import { Dispatch, SetStateAction, useCallback } from "react";

import { ROOT_NODE_ID } from "../../const";
import { addNodeToGraph } from "../../layout/init";
import { createEdge } from "../../mindmap/createEdge";
import { createNode } from "../../mindmap/createNode";
import {
  addChildToMindmapNode,
  createMindmapNodeFromFlowNode,
} from "../../mindmap/flowNodeToMindmapNode";
import { FlowEdge, FlowNode, MindmapNode, NodeTypes } from "../../types";
import { MindmapFlowContext as MindmapFlowContextType } from "../types";

type UseCreateMindmapActionsProps = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<FlowEdge[]>>;
  nodesMap: Record<string, FlowNode>;
  setMindmapNodesMap: Dispatch<SetStateAction<Record<string, MindmapNode>>>;
  graphs: {
    leftGraph: graphlib.Graph<object>;
    rightGraph: graphlib.Graph<object>;
  };
};

export function useCreateMindmapActions({
  nodes,
  edges: _edges,
  setNodes,
  setEdges,
  nodesMap,
  setMindmapNodesMap,
  graphs: { leftGraph, rightGraph },
}: UseCreateMindmapActionsProps): Pick<
  MindmapFlowContextType["actions"],
  "onAddNode" | "onUpdateNode"
> {
  const onAddNode = useCallback<
    NonNullable<MindmapFlowContextType["actions"]["onAddNode"]>
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
    [
      nodes,
      nodesMap,
      leftGraph,
      rightGraph,
      setNodes,
      setEdges,
      setMindmapNodesMap,
    ]
  );

  const onUpdateNode = useCallback<
    NonNullable<MindmapFlowContextType["actions"]["onUpdateNode"]>
  >(
    (nodeId, data) => {
      setNodes((nodes) => {
        return nodes.map((node) => {
          if (node.id === nodeId) {
            return { ...node, data };
          }
          return node;
        });
      });
    },
    [setNodes]
  );

  return {
    onAddNode,
    onUpdateNode,
  };
}
