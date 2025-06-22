import { graphlib } from "@dagrejs/dagre";
import { Dispatch, SetStateAction, useCallback } from "react";

import { ROOT_NODE_ID } from "../../const";
import { addNodeToGraph } from "../../layout/init";
import { createEdge } from "../../mindmap/createEdge";
import {
  createBaseFlowNodeFromPartialBaseFlowNode,
  createNode,
} from "../../mindmap/createNode";
import {
  addChildToMindmapNode,
  createMindmapNodeFromFlowNode,
} from "../../mindmap/flowNodeToMindmapNode";
import { transformMindmapNodesToFlowNodesAndEdges } from "../../mindmap/mindmapNodesToFlowNodes";
import { FlowEdge, FlowNode, MindmapNode, NodeTypes } from "../../types";
import { MindmapFlowContext as MindmapFlowContextType } from "../types";

type UseCreateMindmapActionsProps = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<FlowEdge[]>>;
  nodesMap: Record<string, FlowNode>;
  mindmapNodesMap: Record<string, MindmapNode>;
  setMindmapNodesMap: Dispatch<SetStateAction<Record<string, MindmapNode>>>;
  graphs: {
    leftGraph: graphlib.Graph<object>;
    rightGraph: graphlib.Graph<object>;
  };
};

export function useCreateMindmapActions({
  nodes,
  edges,
  nodesMap,
  setNodes,
  setEdges,
  mindmapNodesMap,
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
      if (!mindmapNodesMap[parentNodeId]) {
        // eslint-disable-next-line no-console -- needed
        console.error(
          `[MindmapFlowProvider] onAddNode: parent node ${parentNodeId} not found`
        );
        return;
      }

      const newNode = createNode(type, "New Node");
      const newEdge = createEdge(parentNodeId, newNode.id);

      const newGraph = type === NodeTypes.LEFT ? leftGraph : rightGraph;
      const oldGraph = type === NodeTypes.LEFT ? rightGraph : leftGraph;

      addNodeToGraph(newGraph, newNode, newEdge);

      let mindmapNodesMapSync: Record<string, MindmapNode> = mindmapNodesMap;

      mindmapNodesMapSync = {
        ...mindmapNodesMapSync,
        [newNode.id]: createMindmapNodeFromFlowNode(
          newNode,
          parentNodeId,
          mindmapNodesMapSync[parentNodeId].level
        ),
      };

      if (parentNodeId) {
        mindmapNodesMapSync[parentNodeId] = addChildToMindmapNode(
          mindmapNodesMapSync[parentNodeId],
          mindmapNodesMapSync[newNode.id]
        );
      }

      setMindmapNodesMap(mindmapNodesMapSync);

      const newRootNode = newGraph.node(ROOT_NODE_ID);

      const { nodes: newGraphNodes, edges: newGraphEdges } =
        transformMindmapNodesToFlowNodesAndEdges(mindmapNodesMapSync);

      const updatedNodes = newGraphNodes.map<FlowNode>((_node) => {
        const node = createBaseFlowNodeFromPartialBaseFlowNode(_node);

        if (node.type === NodeTypes.ROOT) {
          return {
            ...node,
            position: {
              x: newGraph.node(node.id).x - newRootNode.x,
              y: newGraph.node(node.id).y - newRootNode.y,
            },
          };
        }

        if (node.type !== type) {
          return {
            ...node,
            // leave the position of the node in the old graph as is
            position: {
              x: oldGraph.node(node.id).x - oldGraph.node(ROOT_NODE_ID).x,
              y: oldGraph.node(node.id).y - oldGraph.node(ROOT_NODE_ID).y,
            },
          };
        }

        return {
          ...node,
          selected: node.id === parentNodeId, // when adding a node, the parentNode is the activeNode
          position: {
            x: newGraph.node(node.id).x - newRootNode.x,
            y: newGraph.node(node.id).y - newRootNode.y,
          },
        };
      });

      setNodes(updatedNodes);
      setEdges(newGraphEdges);
    },
    [
      leftGraph,
      rightGraph,
      setNodes,
      setEdges,
      mindmapNodesMap,
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
