import { useCallback } from "react";

import { useKey } from "@/hooks/use-key";

import { ROOT_NODE_ID } from "../const";
import { navigate, Operation } from "../layout/navigate";
import { MindmapNode, NodeTypes } from "../types";

export function useMindmapNavigation({
  activeNode,
  setActiveNode,
  mindmapNodesMap,
  leveledNodes,
  onAddNode,
}: {
  mindmapNodesMap: Record<string, MindmapNode>;
  leveledNodes: MindmapNode[][];
  activeNode: string | null;
  setActiveNode: (nodeId: string | null) => void;
  onAddNode: (
    type: NodeTypes.LEFT | NodeTypes.RIGHT,
    parentNodeId: string
  ) => void;
}) {
  const handleNavigate = useCallback(
    (operation: Operation) => {
      if (!activeNode) return;
      const newNode = navigate(
        operation,
        mindmapNodesMap[activeNode],
        mindmapNodesMap,
        leveledNodes
      );
      setActiveNode(newNode.id);
    },
    [activeNode, mindmapNodesMap, leveledNodes, setActiveNode]
  );

  useKey("ArrowLeft", () => {
    handleNavigate(Operation.LEFT);
  });

  useKey("ArrowRight", () => {
    handleNavigate(Operation.RIGHT);
  });

  useKey("ArrowUp", () => {
    handleNavigate(Operation.UP);
  });

  useKey("ArrowDown", () => {
    handleNavigate(Operation.DOWN);
  });

  const addNode = useCallback(() => {
    if (!activeNode || activeNode === ROOT_NODE_ID) return;
    const parentNode = mindmapNodesMap[activeNode];
    if (!parentNode) return;

    onAddNode(
      parentNode.type as NodeTypes.LEFT | NodeTypes.RIGHT,
      parentNode.id
    );
  }, [activeNode, mindmapNodesMap, onAddNode]);

  useKey("Tab", () => {
    addNode();
  });

  return {
    activeNode,
    setActiveNode,
  };
}
