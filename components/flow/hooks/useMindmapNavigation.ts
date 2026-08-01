import { useCallback } from "react";

import { useEventCallback } from "@/hooks/use-event-callback";
import { useKey } from "@/hooks/use-key";

import { ROOT_NODE_ID } from "../const";
import { navigate, Operation } from "../layout/navigate";
import { MindmapNode, NodeTypes } from "../types";

export function useMindmapNavigation({
  readOnly,
  activeNode,
  setActiveNode,
  mindmapNodesMap,
  leveledNodes,
  onAddNode,
  setSelectedNode,
  setAiEditNode,
  setToolbarNode,
}: {
  readOnly: boolean;
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
  setToolbarNode?: (nodeId: string | null) => void;
}) {
  const handleNavigate = useCallback(
    (operation: Operation) => {
      const currentNode = activeNode ? mindmapNodesMap[activeNode] : undefined;

      // An arrow key is the way *in* as much as the way around: with nothing
      // standing on the map — a fresh page, a click on the empty pane, a node
      // that vanished under a server reseed — the first press lands on the
      // root, which is the only entry point that is always there.
      if (!currentNode) {
        const root = mindmapNodesMap[ROOT_NODE_ID];
        if (root) setActiveNode(root.id);
        return;
      }

      const newNode = navigate(
        operation,
        currentNode,
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

  useKey(
    "Tab",
    () => {
      addNode();
    },
    { enabled: !readOnly }
  );

  const onEditNode = useCallback(() => {
    if (!activeNode) return;

    const node = mindmapNodesMap[activeNode];
    if (!node) return;

    if (node.type === NodeTypes.LEFT || node.type === NodeTypes.RIGHT) {
      setSelectedNode(activeNode);
    }
  }, [activeNode, mindmapNodesMap, setSelectedNode]);

  useKey("Enter", onEditNode, { enabled: !readOnly });
  // Space is also used to edit nodes on an editable canvas.
  useKey(" ", onEditNode, { enabled: !readOnly });

  const onStartAiEditing = useEventCallback(() => {
    setAiEditNode(activeNode);
    setSelectedNode(null); // we unset the selected node to prevent user from editing the node
    setToolbarNode?.(null);
  });

  useKey("k", onStartAiEditing, {
    enabled: !readOnly,
    isCtrlKey: true,
    isMetaKey: true,
  });

  useKey(
    "Escape",
    () => {
      setSelectedNode(null);
      setAiEditNode(null);
      setToolbarNode?.(null);
    },
    { allowWhenTyping: true }
  );
}
