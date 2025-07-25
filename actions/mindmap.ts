"use server";

import { ROOT_NODE_ID } from "@/components/flow/const";
import { createEdge } from "@/components/flow/mindmap/createEdge";
import {
  getNewNodeID,
  getNodeTypeFromId,
} from "@/components/flow/mindmap/createNode";
import {
  PartialBaseFlowEdge,
  PartialBaseFlowNode,
} from "@/components/flow/mindmap/mindmapNodesToFlowNodes";
import { NodeTypes } from "@/components/flow/types";
import { createMindmap } from "@/data/create-mindmap";
import { AIMindmap } from "@/types/AI";

import { editAIMindmap } from "./ai-edit";
import { generateAIMindmap } from "./ai-gen";

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
  nodes: PartialBaseFlowNode[],
  edges: PartialBaseFlowEdge[]
) {
  const parentNodeType = getNodeTypeFromId(parentId);

  if (!parentNodeType) {
    throw new Error(`Parent node type not found for ${parentId}`);
  }

  // 1. node should add itself to the nodes array
  const baseFlowNode: PartialBaseFlowNode = {
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

export async function createMindmapFromAI(userPrompt: string) {
  const { mindmap: aiMindmap, rawOutput } = await generateAIMindmap(userPrompt);

  const rootNode = aiMindmap.find((node) => node.nodeId === "root");
  if (!rootNode) {
    throw new Error("Root node not found");
  }

  const aiNodesMap = new Map<string, AIMindmap>();
  aiMindmap.forEach((node) => {
    aiNodesMap.set(node.nodeId, node);
  });

  const nodes: PartialBaseFlowNode[] = [];
  const edges: PartialBaseFlowEdge[] = [];

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

  const { data, error } = await createMindmap(rootNode.title, nodes, edges);

  return {
    data,
    error,
    rawOutput,
  };
}

export async function editMindmapWithAI(
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

  const nodes: PartialBaseFlowNode[] = [];
  const edges: PartialBaseFlowEdge[] = [];

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
    editedMindmap: {
      nodes,
      edges,
    },
    aiMindmap,
    rawOutput,
  };
}
