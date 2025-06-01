import { Dispatch, SetStateAction } from "react";
import { Edge, Node } from "@xyflow/react";

// type UseCreateXYFlowActionsReturnType = Pick<
// MindmapFlowContext["actions"],
// "onNodesChange" | "onEdgesChange" | "onConnect"
// >;

export function useCreateXYFlowActions({
  setNodes: _setNodes,
  setEdges: _setEdges,
}: {
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}): null {
  // const onNodesChange = useCallback<
  //   NonNullable<ReactFlowProps["onNodesChange"]>
  // >((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), [setNodes]);

  // const onEdgesChange = useCallback<
  //   NonNullable<ReactFlowProps["onEdgesChange"]>
  // >((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [setEdges]);

  // const onConnect = useCallback<NonNullable<ReactFlowProps["onConnect"]>>(
  //   (connection) => setEdges((eds) => addEdge(connection, eds)),
  //   [setEdges]
  // );

  return null;
  // return {
  //   onNodesChange,
  //   onEdgesChange,
  //   onConnect,
  // };
}
