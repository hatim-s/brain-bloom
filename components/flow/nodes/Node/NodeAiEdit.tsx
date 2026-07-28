import { motion, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState, useTransition } from "react";

import { editMindmapWithAI } from "@/actions/mindmap";
import {
  AutosizeTextarea,
  AutosizeTextAreaRef,
} from "@/components/auto-resizer-textarea";
import { Box } from "@/components/ui/box";
import { Typography } from "@/components/ui/typography";
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

/**
 * Prompt box for extending a branch with the model.
 *
 * It is the in-canvas shorthand for what the Sprig panel does at length, so it
 * borrows the panel's vocabulary: mono status copy and the same bloom pulse
 * dot, rather than a spinner of its own.
 */
function NodeAiEdit() {
  const aiEditNode = useMindmapFlow((state) => state.aiEditNode);
  const nodesMap = useMindmapFlow((state) => state.nodesMap);
  const prefersReducedMotion = useReducedMotion();

  const [value, setValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<AutosizeTextAreaRef>(null);

  const handleChange = useEventCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      e.stopPropagation();
      e.preventDefault();
      setValue(e.target.value);
    }
  );

  const mindmapNodesMap = useMindmapFlow((state) => state.mindmapNodesMap);
  const activeNodeId = useMindmapFlow((state) => state.activeNode);
  const setAiEditNode = useMindmapFlow((state) => state.setAiEditNode);
  const onAddNode = useMindmapFlow((state) => state.actions.onAddNode);
  const edges = useMindmapFlow((state) => state.edges);

  const handleSubmit = useEventCallback(async () => {
    const currentBranch = getCurrentBranch(mindmapNodesMap, activeNodeId);

    startTransition(async () => {
      setErrorMessage(null);
      const aiResponse = await editMindmapWithAI(
        value,
        currentBranch,
        activeNodeId ?? ""
      );

      if (!aiResponse.ok) {
        setErrorMessage(
          aiResponse.code === "not-configured"
            ? "AI is not configured."
            : aiResponse.code === "too-many-nodes"
              ? "Sprig returned too many nodes. Try a narrower request."
              : "Sprig could not grow this branch. Try again."
        );
        return;
      }

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
          node.data,
          { source: "ai" }
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
        // The focus ring is never suppressed; it is only pulled flush with the
        // popover edge, which the borderless field sits directly against.
        className="h-full w-full !min-h-[30px] !border-none resize-none rounded-md px-3 py-2.5 text-sm focus-visible:outline-offset-0"
        disabled={isPending}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Ask Sprig to grow this branch"
        ref={textareaRef}
      />
      {isPending && (
        <motion.div
          className="absolute top-0 left-0 flex flex-row items-center justify-center gap-x-2 rounded-md bg-popover"
          style={textAreaDimensions}
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          role="status"
        >
          <span aria-hidden="true" className="sprig-bloom-dot" />
          <Typography
            className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground"
            variant="p"
          >
            Growing this branch
          </Typography>
        </motion.div>
      )}
      {errorMessage ? (
        <div
          className="absolute left-0 top-full z-10 mt-1 flex w-full items-center gap-2 rounded-md border border-destructive bg-card px-2.5 py-2 text-sm font-medium text-destructive"
          role="alert"
        >
          <span className="flex-1">{errorMessage}</span>
          <button
            className="underline underline-offset-2"
            onClick={() => void handleSubmit()}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
    </Box>
  );
}

export { NodeAiEdit };
