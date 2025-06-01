import { Dispatch, SetStateAction, useCallback } from "react";
import { applyNodeChanges, Edge, Node, ReactFlowProps } from "@xyflow/react";
import { applyEdgeChanges } from "@xyflow/react";
import { addEdge } from "@xyflow/react";
import { MindmapFlowContext } from "./MindmapFlowProvider";

export function useCreateXYFlowActions({
  setNodes,
  setEdges,
}: {
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}): Pick<
  MindmapFlowContext["actions"],
  "onNodesChange" | "onEdgesChange" | "onConnect"
> {
  const onNodesChange = useCallback<
    NonNullable<ReactFlowProps["onNodesChange"]>
  >((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), [setNodes]);

  const onEdgesChange = useCallback<
    NonNullable<ReactFlowProps["onEdgesChange"]>
  >((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [setEdges]);

  const onConnect = useCallback<NonNullable<ReactFlowProps["onConnect"]>>(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  return {
    onNodesChange,
    onEdgesChange,
    onConnect,
  };
}
