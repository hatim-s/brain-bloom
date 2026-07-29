"use server";

import { fetchMutation } from "convex/nextjs";
import { ConvexError } from "convex/values";

import { ROOT_NODE_ID } from "@/components/flow/const";
import { createEdge } from "@/components/flow/mindmap/createEdge";
import {
  getNewNodeID,
  getNodeTypeFromId,
} from "@/components/flow/mindmap/createNode";
import {
  PartialBaseFlowEdge as FlowEdgeSnapshot,
  PartialBaseFlowNode as FlowNodeSnapshot,
} from "@/components/flow/mindmap/mindmapNodesToFlowNodes";
import { NodeTypes } from "@/components/flow/types";
import { api } from "@/convex/_generated/api";
import type { NodeSnapshot } from "@/convex/lib/nodeOps";
import {
  type AIActionErrorCode,
  getAIActionErrorCode,
} from "@/lib/ai/actionErrors";
import { AIConfigurationError } from "@/lib/ai/errors";
import {
  generatedMindmapSchema,
  type GeneratedTreeNode,
} from "@/lib/ai/generatedTree";
import { generateAIStructured } from "@/lib/ai/providerRouter";
import { getConvexAuthToken } from "@/lib/convex-server";
import { AIMindmap } from "@/types/AI";

import { editAIMindmap } from "./ai-node-edit";

const MINDMAP_GENERATION_INSTRUCTIONS = `You generate a deep, useful mindmap
from the user's prompt. Return a concise map name and a nested node tree. Aim
for four to ten levels where the topic supports it, no more than three children
per non-root node, and enough breadth to feel complete without filler.
Descriptions and reference links are optional.`;

/** Flattens a generated tree into the relationship contract used by the canvas. */
function flattenGeneratedMindmap(
  name: string,
  nodes: GeneratedTreeNode[]
): AIMindmap[] {
  let sequence = 0;
  const flattened: AIMindmap[] = [];

  /** Assigns internal ids used only to express generated relationships. */
  function visit(node: GeneratedTreeNode): string {
    sequence += 1;
    const nodeId = `generated-${sequence}`;
    const childrenNodes = node.children.map(visit);

    flattened.push({
      nodeId,
      title: node.title,
      description: node.description ?? null,
      link: node.link ?? null,
      childrenNodes,
    });

    return nodeId;
  }

  const childrenNodes = nodes.map(visit);

  return [
    {
      nodeId: "root",
      title: name,
      description: null,
      link: null,
      childrenNodes,
    },
    ...flattened,
  ];
}

/** Generates and validates a strict nested mindmap with the selected provider. */
async function generateAIMindmap(userPrompt: string) {
  if (!userPrompt) {
    throw new Error("User prompt is required");
  }

  try {
    const result = await generateAIStructured({
      instructions: MINDMAP_GENERATION_INSTRUCTIONS,
      prompt: userPrompt,
      schema: generatedMindmapSchema,
    });

    return {
      rawOutput: result.rawOutput,
      mindmap: flattenGeneratedMindmap(result.output.name, result.output.nodes),
    };
  } catch (error) {
    if (error instanceof AIConfigurationError) {
      throw new ConvexError(error.message);
    }

    throw error;
  }
}

function sanitizeParentId(parentId: string) {
  if (parentId === `l-${ROOT_NODE_ID}` || parentId === `r-${ROOT_NODE_ID}`) {
    return ROOT_NODE_ID;
  }

  return parentId;
}

function dfsHelper(
  aiNodesMap: Map<string, AIMindmap>,
  aiNode: AIMindmap,
  parentId: string,
  nodes: FlowNodeSnapshot[],
  edges: FlowEdgeSnapshot[]
) {
  const parentNodeType = getNodeTypeFromId(parentId);

  if (!parentNodeType) {
    throw new Error(`Parent node type not found for ${parentId}`);
  }

  // 1. node should add itself to the nodes array
  const baseFlowNode: FlowNodeSnapshot = {
    id: getNewNodeID(parentNodeType),
    type: parentNodeType,
    data: {
      title: aiNode.title,
      description: aiNode.description ?? undefined,
      link: aiNode.link ?? undefined,
    },
  };

  nodes.push(baseFlowNode);

  // 2. node should connect itself to the parent
  edges.push(createEdge(sanitizeParentId(parentId), baseFlowNode.id));

  // iterate over children
  aiNode.childrenNodes?.forEach((childNodeId) => {
    const childNode = aiNodesMap.get(childNodeId);
    if (!childNode) {
      // eslint-disable-next-line no-console -- needed for logging
      console.warn(`Child node ${childNodeId} not found`);
      return;
      // throw new Error(`Child node ${childNodeId} not found`);
    }

    dfsHelper(aiNodesMap, childNode, baseFlowNode.id, nodes, edges);
  });
}

/** Converts generated flow records into complete persisted node snapshots. */
function createGeneratedNodeSnapshots(
  nodes: FlowNodeSnapshot[],
  edges: FlowEdgeSnapshot[]
): NodeSnapshot[] {
  const siblingCounts = new Map<string, number>();
  const snapshots: NodeSnapshot[] = [];

  for (const node of nodes) {
    if (node.id === ROOT_NODE_ID) {
      snapshots.push({
        nodeId: ROOT_NODE_ID,
        parentId: null,
        type: "root",
        title: node.data.title,
        ...(node.data.description === undefined
          ? {}
          : { description: node.data.description }),
        ...(node.data.link === undefined ? {} : { link: node.data.link }),
        order: 0,
      });
      continue;
    }

    const parentId = edges.find((edge) => edge.target === node.id)?.source;
    if (!parentId) {
      throw new Error(`Parent edge not found for ${node.id}`);
    }

    const order = siblingCounts.get(parentId) ?? 0;
    siblingCounts.set(parentId, order + 1);
    snapshots.push({
      nodeId: node.id,
      parentId,
      type: node.type,
      title: node.data.title,
      ...(node.data.description === undefined
        ? {}
        : { description: node.data.description }),
      ...(node.data.link === undefined ? {} : { link: node.data.link }),
      order,
    });
  }

  return snapshots;
}

/** Persists a generated mindmap and every node in one Convex transaction. */
async function persistGeneratedMindmap(
  name: string,
  nodes: FlowNodeSnapshot[],
  edges: FlowEdgeSnapshot[]
) {
  const token = await getConvexAuthToken();
  if (token === null) {
    throw new Error("Convex auth is not configured — see docs/ENV.md");
  }

  return fetchMutation(
    api.mindmaps.createWithNodes,
    {
      name,
      nodes: createGeneratedNodeSnapshots(nodes, edges),
    },
    { token }
  );
}

/** Generates and atomically persists a new mindmap from one prompt. */
async function createMindmapFromAI(userPrompt: string) {
  try {
    return await createMindmapFromAIUnsafe(userPrompt);
  } catch (error) {
    return { ok: false as const, code: getAIActionErrorCode(error) };
  }
}

/** Performs generation and persistence before the public action serializes errors. */
async function createMindmapFromAIUnsafe(userPrompt: string) {
  const { mindmap: aiMindmap, rawOutput } = await generateAIMindmap(userPrompt);

  const rootNode = aiMindmap.find((node) => node.nodeId === "root");
  if (!rootNode) {
    throw new Error("Root node not found");
  }

  const aiNodesMap = new Map<string, AIMindmap>();
  aiMindmap.forEach((node) => {
    aiNodesMap.set(node.nodeId, node);
  });

  const nodes: FlowNodeSnapshot[] = [];
  const edges: FlowEdgeSnapshot[] = [];

  nodes.push({
    id: ROOT_NODE_ID,
    type: NodeTypes.ROOT,
    data: {
      title: rootNode.title,
      description: rootNode.description ?? undefined,
      link: rootNode.link ?? undefined,
    },
  });

  rootNode.childrenNodes?.forEach((childNodeId, index) => {
    const childNode = aiNodesMap.get(childNodeId);
    if (!childNode) {
      throw new Error(`Child node ${childNodeId} not found`);
    }

    const prefix = index <= 1 ? "l" : "r";

    // create dummy root node id with prefix so that children nodes can be created with the same type as the parent
    dfsHelper(aiNodesMap, childNode, `${prefix}-${ROOT_NODE_ID}`, nodes, edges);
  });

  // return {
  //   data: {
  //     nodes,
  //     edges,
  //   },
  //   error: null,
  //   rawOutput,
  // };

  const data = await persistGeneratedMindmap(rootNode.title, nodes, edges);

  return {
    ok: true as const,
    data,
    error: null,
    rawOutput,
  };
}

/** Generates a local branch edit whose operations are saved by canvas sync. */
async function editMindmapWithAI(
  userPrompt: string,
  currentBranch: AIMindmap[],
  activeNodeId: string
) {
  try {
    return await editMindmapWithAIUnsafe(
      userPrompt,
      currentBranch,
      activeNodeId
    );
  } catch (error) {
    return { ok: false as const, code: getAIActionErrorCode(error) };
  }
}

/** Builds a local branch edit before the public action serializes errors. */
async function editMindmapWithAIUnsafe(
  userPrompt: string,
  currentBranch: AIMindmap[],
  activeNodeId: string
) {
  const { mindmap: aiMindmap, rawOutput } = await editAIMindmap(
    userPrompt,
    currentBranch,
    activeNodeId
  );
  const aiNodesMap = new Map<string, AIMindmap>();
  aiMindmap.forEach((node) => {
    aiNodesMap.set(node.nodeId, node);
  });

  const nodes: FlowNodeSnapshot[] = [];
  const edges: FlowEdgeSnapshot[] = [];

  const parentNode = currentBranch.find(
    ({ nodeId }) => nodeId === aiMindmap[0].nodeId
  )?.nodeId;

  dfsHelper(aiNodesMap, aiMindmap[0], parentNode ?? ROOT_NODE_ID, nodes, edges);

  if (aiMindmap[0].nodeId === activeNodeId) {
    // we have the first node in the edited nodes, which is the active node
    // therefore, we need to omit duplicate nodes and remove unwanted edges from
    // from the generated edited nodes

    // 1. remove duplicate nodes
    const { id: newId } = nodes.shift()!; // we assume that there is always one new node

    // 2. edit edges to connect to correct active node id
    edges.forEach((edge) => {
      if (edge.source === newId) {
        edge.source = activeNodeId;
      }
    });
  }

  return {
    ok: true as const,
    editedMindmap: {
      nodes,
      edges,
    },
    aiMindmap,
    rawOutput,
  };
}

export {
  type AIActionErrorCode,
  createMindmapFromAI,
  editMindmapWithAI,
  getAIActionErrorCode,
};
