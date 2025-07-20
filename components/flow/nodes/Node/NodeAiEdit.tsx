import { useState } from "react";

import { editMindmapWithAI } from "@/actions/mindmap";
import { Box } from "@/components/ui/box";
import { Textarea } from "@/components/ui/textarea";
import { useEventCallback } from "@/hooks/use-event-callback";
import { AIMindmap } from "@/types/AI";

import { useMindmapFlow } from "../../providers/MindmapFlowProvider";
import { MindmapNode, NodeTypes } from "../../types";

function getNodePathFromParent(
  mindmapNode: MindmapNode,
  mindmapNodesMap: Record<string, MindmapNode>,
  parents: string[] = []
) {
  if (mindmapNode.parentId) {
    parents.push(mindmapNode.parentId);
    const parentNode = mindmapNodesMap[mindmapNode.parentId];

    if (parentNode) {
      return getNodePathFromParent(parentNode, mindmapNodesMap, parents);
    }
  }

  return parents;
}

function convertMindmapNodeToAIMindmapNode(
  mindmapNode: MindmapNode
): AIMindmap {
  return {
    nodeId: mindmapNode.id,
    title: mindmapNode.data.title,
    description: mindmapNode.data.description ?? null,
    link: mindmapNode.data.link ?? null,
    childrenNodes: Array.from(mindmapNode.children.keys()),
  };
}

function getCurrentBranch(
  mindmapNodesMap: Record<string, MindmapNode>,
  activeNodeId: string | null
) {
  const activeNode = mindmapNodesMap[activeNodeId ?? ""];
  if (!activeNode) return [];

  const parentNodes = getNodePathFromParent(activeNode, mindmapNodesMap);
  parentNodes.reverse(); // since we start from the active node and go up, the order we get is reversed

  const children = Array.from(activeNode.children.keys());

  const currentBranchPath = [...parentNodes, activeNode.id, ...children];

  const currentBranch = currentBranchPath
    .map((nodeId) => {
      const node = mindmapNodesMap[nodeId];
      if (!node) return null;
      return convertMindmapNodeToAIMindmapNode(node);
    })
    .filter(Boolean) as AIMindmap[];

  return currentBranch;
}

export default function NodeAiEdit() {
  const { aiEditNode, nodesMap } = useMindmapFlow();

  const [value, setValue] = useState("");

  const handleChange = useEventCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      e.stopPropagation();
      e.preventDefault();
      setValue(e.target.value);
    }
  );

  const {
    mindmapNodesMap,
    activeNode: activeNodeId,
    setAiEditNode,
    actions: { onAddNode },
    edges,
  } = useMindmapFlow();

  const handleSubmit = useEventCallback(async () => {
    const currentBranch = getCurrentBranch(mindmapNodesMap, activeNodeId);
    const aiResponse = await editMindmapWithAI(
      value,
      currentBranch,
      activeNodeId ?? ""
    );

    const edgesMap = [...edges, ...aiResponse.editedMindmap.edges].reduce(
      (acc, edge) => {
        acc[edge.target] = edge.source;
        return acc;
      },
      {} as Record<string, string>
    );

    aiResponse.editedMindmap.nodes.forEach((node) => {
      const nodeId = node.id;
      if (nodesMap[nodeId]) return;

      onAddNode(
        node.type as NodeTypes.LEFT | NodeTypes.RIGHT,
        edgesMap[node.id],
        node.id,
        node.data
      );
    });

    setAiEditNode(null);
  });

  const handleKeyDown = useEventCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.key === "Enter" ||
        // e.key === "Escape" ||
        e.key === " " ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (e.key === "Enter") {
        handleSubmit();
        // setValue((prev) => prev + "\n");
      }

      if (e.key === " ") {
        setValue((prev) => prev + " ");
      }
    }
  );

  // selectedNode is not null
  const node = nodesMap[aiEditNode!];

  if (!node) return null;

  return (
    <Box>
      <Textarea
        className="h-full w-full !min-h-[30px] !outline-none !border-none"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Edit the mindmap with AI ✨"
      />
    </Box>
  );
}
