import { Loader } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, useTransition } from "react";

import { editMindmapWithAI } from "@/actions/mindmap";
import { AuroraText } from "@/components/aurora-text";
import {
  AutosizeTextarea,
  AutosizeTextAreaRef,
} from "@/components/auto-resizer-textarea";
import { Box } from "@/components/ui/box";
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
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<AutosizeTextAreaRef>(null);

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

    let aiResponse: Awaited<ReturnType<typeof editMindmapWithAI>>;

    startTransition(async () => {
      aiResponse = await editMindmapWithAI(
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
  });

  const handleKeyDown = useEventCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        (e.key === "Enter" && !e.shiftKey) ||
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
        if (e.shiftKey) {
          // setValue((prev) => prev + "\n");
        } else handleSubmit();
      }

      if (e.key === " ") {
        setValue((prev) => prev + " ");
      }
    }
  );

  const width = textareaRef.current?.textArea.clientWidth ?? 0;
  const height = textareaRef.current?.textArea.clientHeight ?? 0;

  const textAreaDimensions = useMemo(() => {
    return { width, height };
  }, [width, height]);

  // selectedNode is not null
  const node = nodesMap[aiEditNode!];
  if (!node) return null;

  return (
    <Box>
      <AutosizeTextarea
        className="h-full w-full !min-h-[30px] !outline-none !border-none resize-none"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Edit the mindmap with AI ✨"
        ref={textareaRef}
      />
      {isPending && (
        <AnimatePresence mode="wait">
          <motion.div
            className="absolute top-0 left-0 justify-center items-center bg-white rounded-md gap-x-2 flex flex-row"
            style={textAreaDimensions}
            initial={{
              y: 0,
              opacity: 0,
            }}
            animate={{
              y: 0,
              opacity: 1,
            }}
            transition={{
              duration: 0.2,
              ease: "linear",
            }}
          >
            <AuroraText className="text-lg font-medium">
              Generating with AI
            </AuroraText>
            <Loader className="animate-spin-slow text-primary" />
          </motion.div>
        </AnimatePresence>
      )}
    </Box>
  );
}
