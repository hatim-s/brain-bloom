import { useCallback } from "react";

import { useEventCallback } from "@/hooks/use-event-callback";
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
  setSelectedNode,
  setAiEditNode,
}: {
  mindmapNodesMap: Record<string, MindmapNode>;
  leveledNodes: MindmapNode[][];
  activeNode: string | null;
  setActiveNode: (nodeId: string | null) => void;
  onAddNode: (
    type: NodeTypes.LEFT | NodeTypes.RIGHT,
    parentNodeId: string
  ) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setAiEditNode: (nodeId: string | null) => void;
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

  const onEditNode = useCallback(() => {
    if (!activeNode) return;

    const node = mindmapNodesMap[activeNode];
    if (!node) return;

    if (node.type === NodeTypes.LEFT || node.type === NodeTypes.RIGHT) {
      setSelectedNode(activeNode);
    }
  }, [activeNode, mindmapNodesMap, setSelectedNode]);

  useKey("Enter", onEditNode);
  useKey(" ", onEditNode); // space is also used to edit nodes

  const onStartAiEditing = useEventCallback(() => {
    setAiEditNode(activeNode);
    setSelectedNode(null); // we unset the selected node to prevent user from editing the node
  });

  useKey("k", onStartAiEditing, { isCtrlKey: true, isMetaKey: true });

  useKey("Escape", () => {
    setSelectedNode(null);
    setAiEditNode(null);
  });
}
