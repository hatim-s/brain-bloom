import { useCallback, useState } from "react";

import { useKey } from "@/hooks/use-key";

import { ROOT_NODE_ID } from "../const";
import { navigate, Operation } from "../layout/navigate";
import { MindmapNode, NodeTypes } from "../types";

export function useMindmapNavigation(
  mindmapNodesMap: Record<string, MindmapNode>,
  leveledNodes: MindmapNode[][],
  onAddNode: (
    type: NodeTypes.LEFT | NodeTypes.RIGHT,
    parentNodeId: string
  ) => void
) {
  const [activeNode, setActiveNode] = useState<string | null>(ROOT_NODE_ID);

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
    [activeNode, mindmapNodesMap, leveledNodes]
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
