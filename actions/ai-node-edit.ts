"use server";

import { generateText, Output } from "ai";
import { ConvexError } from "convex/values";

import {
  generatedNodeSuggestionsSchema,
  type GeneratedTreeNode,
} from "@/lib/ai/generatedTree";
import { flattenSuggestions } from "@/lib/ai/nodeSuggestions";
import { AIConfigurationError, getAnthropicModel } from "@/lib/anthropic";
import { AIMindmap } from "@/types/AI";

const NODE_EDIT_INSTRUCTIONS = `You extend one selected branch of a mindmap.
Return only useful new child nodes beneath the selected node. Create two to four
levels of concise information, with no more than three children per node. Do not
repeat existing branch content. Descriptions and links are optional.`;

/**
 * Generates nested children for NodeAiEdit while preserving its existing flat
 * server-action response contract.
 */
async function editAIMindmap(
  userPrompt: string,
  currentBranch: AIMindmap[] = [],
  activeNodeId: string
) {
  if (!userPrompt) {
    throw new Error("User prompt is required");
  }

  if (currentBranch.length === 0) {
    throw new Error("Current branch is required");
  }

  const activeNode = currentBranch.find((node) => node.nodeId === activeNodeId);
  if (!activeNode) {
    throw new Error("Active node is required");
  }

  try {
    const result = await generateText({
      model: getAnthropicModel(),
      instructions: NODE_EDIT_INSTRUCTIONS,
      prompt: `${userPrompt}

Selected nodeId: ${activeNodeId}
Current branch: ${JSON.stringify(currentBranch)}`,
      output: Output.object({
        schema: generatedNodeSuggestionsSchema,
        name: "mindmap_node_suggestions",
        description: "Nested child nodes to add beneath the selected node.",
      }),
    });

    return {
      rawOutput: result.text,
      mindmap: flattenSuggestions(result.output.nodes, activeNode),
    };
  } catch (error) {
    if (error instanceof AIConfigurationError) {
      throw new ConvexError(error.message);
    }

    throw error;
  }
}

export { editAIMindmap };
