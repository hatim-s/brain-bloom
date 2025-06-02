import { Dispatch, SetStateAction, useCallback } from "react";
import { applyNodeChanges, Edge, Node, ReactFlowProps } from "@xyflow/react";
import { MindmapFlowContext } from "./MindmapFlowProvider";
import { FlowNode } from "../types";

type UseCreateXYFlowActionsReturnType = Pick<
  MindmapFlowContext["actions"],
  "onNodesChange" // | "onEdgesChange" | "onConnect"
>;

export function useCreateXYFlowActions({
  setNodes,
  setEdges: _setEdges,
}: {
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}): UseCreateXYFlowActionsReturnType {
  const onNodesChange = useCallback<
    NonNullable<ReactFlowProps["onNodesChange"]>
  >(
    (changes) =>
      setNodes((nds) => applyNodeChanges(changes, nds) as FlowNode[]),
    [setNodes]
  );

  // const onEdgesChange = useCallback<
  //   NonNullable<ReactFlowProps["onEdgesChange"]>
  // >((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [setEdges]);

  // const onConnect = useCallback<NonNullable<ReactFlowProps["onConnect"]>>(
  //   (connection) => setEdges((eds) => addEdge(connection, eds)),
  //   [setEdges]
  // );

  return {
    onNodesChange,
  };
  // return {
  //   onNodesChange,
  //   onEdgesChange,
  //   onConnect,
  // };
}
