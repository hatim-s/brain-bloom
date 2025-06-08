/* eslint-disable no-console -- testing */
import { useCallback, useState } from "react";

import { useKey } from "@/hooks/use-key";

import { navigate, Operation } from "../layout/navigate";
import { MindmapNode } from "../types";

export function useMindmapNavigation(
  mindmapNodesMap: Record<string, MindmapNode>
) {
  const [activeNode, setActiveNode] = useState<string | null>(null);

  const handleNavigate = useCallback(
    (operation: Operation) => {
      if (!activeNode) return;
      const newNode = navigate(
        operation,
        mindmapNodesMap[activeNode],
        mindmapNodesMap
      );
      setActiveNode(newNode.id);
    },
    [activeNode, mindmapNodesMap]
  );

  useKey("ArrowLeft", () => {
    handleNavigate(Operation.LEFT);
    console.log("ArrowLeft");
  });

  useKey("ArrowRight", () => {
    handleNavigate(Operation.RIGHT);
    console.log("ArrowRight");
  });

  useKey("ArrowUp", () => {
    handleNavigate(Operation.UP);
    console.log("ArrowUp");
  });

  useKey("ArrowDown", () => {
    handleNavigate(Operation.DOWN);
    console.log("ArrowDown");
  });

  return {
    activeNode,
    setActiveNode,
  };
}
