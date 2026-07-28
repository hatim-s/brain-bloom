import { tool } from "ai";
import type { Value } from "convex/values";
import { ConvexError } from "convex/values";
import { z } from "zod";

import { getNewNodeID } from "@/components/flow/mindmap/createNode";
import { NodeTypes } from "@/components/flow/types";

import {
  type SerializableMindmap,
  type SerializableMindmapNode,
  serializeMindmap,
} from "./serializeMindmap";

type MindmapSide = "left" | "right";

type ToolMindmapNode = SerializableMindmapNode & {
  type: "root" | MindmapSide;
};

type ToolMindmap = Omit<SerializableMindmap, "nodes"> & {
  nodes: ToolMindmapNode[];
};

type WireNodeOp =
  | {
      kind: "create";
      node: ToolMindmapNode;
    }
  | {
      kind: "update";
      nodeId: string;
      patch: {
        title?: string;
        description?: string | null;
        link?: string | null;
        parentId?: string;
        order?: number;
      };
    }
  | { kind: "delete"; nodeId: string };

type AppliedOperation = {
  operationId: string;
  seq: number;
};

type HistoryPage = {
  page: Array<{
    _id: string;
    seq: number;
    description: string;
    undone: boolean;
    source: "user" | "ai";
    _creationTime: number;
  }>;
};

type MindmapToolConvexLayer = {
  getMindmap: (mindmapId: string) => Promise<ToolMindmap>;
  applyOps: (args: {
    mindmapId: string;
    ops: WireNodeOp[];
    description: string;
    source: "ai";
  }) => Promise<AppliedOperation>;
  renameMindmap: (args: {
    mindmapId: string;
    name: string;
    source: "ai";
  }) => Promise<AppliedOperation>;
  getHistory: (args: {
    mindmapId: string;
    paginationOpts: { cursor: null; numItems: number };
  }) => Promise<HistoryPage>;
  undoTo: (operationId: string) => Promise<{
    undoneCount: number;
    seq: number;
  }>;
};

type CreateMindmapToolsOptions = {
  mindmapId: string;
  convex: MindmapToolConvexLayer;
  createNodeId?: (side: MindmapSide) => string;
  onOperationApplied?: (operation: AppliedOperation) => void;
};

const createNodesInputSchema = z.object({
  nodes: z
    .array(
      z.object({
        parentId: z.string().min(1),
        side: z.enum(["left", "right"]).optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        link: z.string().optional(),
      })
    )
    .min(1),
});

const updateNodeInputSchema = z
  .object({
    nodeId: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
  })
  .refine(
    ({ title, description, link }) =>
      title !== undefined || description !== undefined || link !== undefined,
    { message: "At least one update field is required" }
  );

/** Returns the user-actionable payload carried by a Convex validation error. */
function getConvexErrorMessage(error: ConvexError<Value>): string {
  return typeof error.data === "string" ? error.data : error.message;
}

/**
 * Runs a mutation tool without letting expected Convex validation failures
 * terminate the model stream.
 */
async function runMutationTool<Result>(
  mutation: () => Promise<Result>
): Promise<Result | { error: string }> {
  try {
    return await mutation();
  } catch (error) {
    if (error instanceof ConvexError) {
      return { error: getConvexErrorMessage(error) };
    }

    throw error;
  }
}

/** Allocates one unused id with the canvas's existing side-prefixed helper. */
function allocateNodeId(
  side: MindmapSide,
  usedNodeIds: Set<string>,
  createNodeId: (side: MindmapSide) => string
): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const nodeId = createNodeId(side);

    if (!usedNodeIds.has(nodeId)) {
      usedNodeIds.add(nodeId);
      return nodeId;
    }
  }

  throw new ConvexError("Unable to allocate a unique node id");
}

/** Picks the less-populated root side when the model omits a preference. */
function chooseBalancedRootSide(nodes: ToolMindmapNode[]): MindmapSide {
  const rootChildren = nodes.filter((node) => node.parentId === "root");
  const leftCount = rootChildren.filter((node) => node.type === "left").length;
  const rightCount = rootChildren.length - leftCount;

  return leftCount <= rightCount ? "left" : "right";
}

/**
 * Builds the server-executed AI tool set around one authenticated Convex
 * request layer and one owned mindmap.
 */
function createMindmapTools({
  mindmapId,
  convex,
  createNodeId = (side) =>
    getNewNodeID(side === "left" ? NodeTypes.LEFT : NodeTypes.RIGHT),
  onOperationApplied,
}: CreateMindmapToolsOptions) {
  /** Records successful apply-like mutations for assistant-message linkage. */
  function recordOperation(operation: AppliedOperation): AppliedOperation {
    onOperationApplied?.(operation);
    return operation;
  }

  return {
    readMindmap: tool({
      description:
        "Read the latest mindmap state after edits and return a compact node-id outline.",
      inputSchema: z.object({}),
      execute: async () => ({
        outline: serializeMindmap(await convex.getMindmap(mindmapId)),
      }),
    }),
    createNodes: tool({
      description:
        "Create one related batch of mindmap nodes. Parent ids must already exist.",
      inputSchema: createNodesInputSchema,
      execute: async ({ nodes: requestedNodes }) =>
        runMutationTool(async () => {
          const current = await convex.getMindmap(mindmapId);
          const nodesById = new Map(
            current.nodes.map((node) => [node.nodeId, node])
          );
          const usedNodeIds = new Set(nodesById.keys());
          const nextOrderByParent = new Map<string, number>();
          const evolvingNodes = [...current.nodes];
          const createdNodeIds: string[] = [];
          const ops: WireNodeOp[] = [];

          for (const requestedNode of requestedNodes) {
            const parent = nodesById.get(requestedNode.parentId);
            if (!parent) {
              throw new ConvexError(
                `Parent node does not exist: ${requestedNode.parentId}`
              );
            }

            const side =
              parent.nodeId === "root"
                ? (requestedNode.side ?? chooseBalancedRootSide(evolvingNodes))
                : parent.type === "left"
                  ? "left"
                  : "right";
            const nodeId = allocateNodeId(side, usedNodeIds, createNodeId);
            const nextOrder =
              nextOrderByParent.get(parent.nodeId) ??
              evolvingNodes
                .filter((node) => node.parentId === parent.nodeId)
                .reduce(
                  (highest, sibling) => Math.max(highest, sibling.order + 1),
                  0
                );
            const node = {
              nodeId,
              parentId: parent.nodeId,
              type: side,
              title: requestedNode.title,
              ...(requestedNode.description === undefined
                ? {}
                : { description: requestedNode.description }),
              ...(requestedNode.link === undefined
                ? {}
                : { link: requestedNode.link }),
              order: nextOrder,
            };

            nextOrderByParent.set(parent.nodeId, nextOrder + 1);
            evolvingNodes.push(node);
            nodesById.set(nodeId, node);
            createdNodeIds.push(nodeId);
            ops.push({ kind: "create", node });
          }

          const operation = recordOperation(
            await convex.applyOps({
              mindmapId,
              ops,
              description: `Created ${createdNodeIds.length} node${createdNodeIds.length === 1 ? "" : "s"}`,
              source: "ai",
            })
          );

          return {
            createdNodeIds,
            operationId: operation.operationId,
          };
        }),
    }),
    updateNode: tool({
      description:
        "Update a node. Pass null for description or link to remove that field.",
      inputSchema: updateNodeInputSchema,
      execute: async ({ nodeId, ...patch }) =>
        runMutationTool(async () => {
          const operation = recordOperation(
            await convex.applyOps({
              mindmapId,
              ops: [{ kind: "update", nodeId, patch }],
              description: `Updated node ${nodeId}`,
              source: "ai",
            })
          );

          return { operationId: operation.operationId };
        }),
    }),
    deleteNode: tool({
      description:
        "Delete a childless node. If it has children, the result explains the rejection.",
      inputSchema: z.object({ nodeId: z.string().min(1) }),
      execute: async ({ nodeId }) =>
        runMutationTool(async () => {
          const operation = recordOperation(
            await convex.applyOps({
              mindmapId,
              ops: [{ kind: "delete", nodeId }],
              description: `Deleted node ${nodeId}`,
              source: "ai",
            })
          );

          return { operationId: operation.operationId };
        }),
    }),
    moveNode: tool({
      description:
        "Move a node under an existing parent, optionally to a zero-based sibling position.",
      inputSchema: z.object({
        nodeId: z.string().min(1),
        newParentId: z.string().min(1),
        position: z.number().int().nonnegative().optional(),
      }),
      execute: async ({ nodeId, newParentId, position }) =>
        runMutationTool(async () => {
          const current = await convex.getMindmap(mindmapId);
          const movingNode = current.nodes.find(
            (node) => node.nodeId === nodeId
          );
          const newParent = current.nodes.find(
            (node) => node.nodeId === newParentId
          );

          if (!movingNode) {
            throw new ConvexError(`Node does not exist: ${nodeId}`);
          }

          if (!newParent) {
            throw new ConvexError(`Parent node does not exist: ${newParentId}`);
          }

          const destinationSiblings = current.nodes
            .filter(
              (node) => node.parentId === newParentId && node.nodeId !== nodeId
            )
            .sort(
              (left, right) =>
                left.order - right.order ||
                left.nodeId.localeCompare(right.nodeId)
            );
          const destinationIndex =
            position === undefined
              ? destinationSiblings.length
              : Math.min(position, destinationSiblings.length);
          const orderedDestination = [...destinationSiblings];
          orderedDestination.splice(destinationIndex, 0, movingNode);
          const ops: WireNodeOp[] = orderedDestination.flatMap(
            (node, order): WireNodeOp[] => {
              if (node.nodeId === nodeId) {
                return [
                  {
                    kind: "update",
                    nodeId,
                    patch: { parentId: newParentId, order },
                  },
                ];
              }

              return node.order === order
                ? []
                : [{ kind: "update", nodeId: node.nodeId, patch: { order } }];
            }
          );
          const operation = recordOperation(
            await convex.applyOps({
              mindmapId,
              ops,
              description: `Moved node ${nodeId}`,
              source: "ai",
            })
          );

          return { operationId: operation.operationId };
        }),
    }),
    renameMindmap: tool({
      description: "Rename the mindmap and its root node.",
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: async ({ name }) =>
        runMutationTool(async () => {
          const operation = recordOperation(
            await convex.renameMindmap({
              mindmapId,
              name,
              source: "ai",
            })
          );

          return { operationId: operation.operationId };
        }),
    }),
    getHistory: tool({
      description:
        "Return the first page of recent mindmap operations, newest first.",
      inputSchema: z.object({}),
      execute: async () => {
        const history = await convex.getHistory({
          mindmapId,
          paginationOpts: { cursor: null, numItems: 20 },
        });

        return { operations: history.page };
      },
    }),
    undoOperation: tool({
      description:
        "Undo the target operation and every later active operation atomically.",
      inputSchema: z.object({ operationId: z.string().min(1) }),
      execute: async ({ operationId }) =>
        runMutationTool(async () => convex.undoTo(operationId)),
    }),
  };
}

export {
  type AppliedOperation,
  createMindmapTools,
  type CreateMindmapToolsOptions,
  type MindmapToolConvexLayer,
  type WireNodeOp,
};
