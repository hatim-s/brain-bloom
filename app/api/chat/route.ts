import { auth } from "@clerk/nextjs/server";
import {
  convertToModelMessages,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { serializeMindmap } from "@/lib/ai/serializeMindmap";
import {
  type AppliedOperation,
  createMindmapTools,
  type MindmapToolConvexLayer,
} from "@/lib/ai/tools";
import { getAnthropicModel, isAIConfigured } from "@/lib/anthropic";
import { getConvexAuthToken } from "@/lib/convex-server";

const THREAD_TITLE_LENGTH = 60;

const uiMessagePartSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

const uiMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["system", "user", "assistant"]),
  metadata: z.unknown().optional(),
  parts: z.array(uiMessagePartSchema),
});

const chatRequestSchema = z.object({
  mindmapId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  messages: z.array(uiMessageSchema).min(1),
  selectedNodeId: z.string().min(1).optional(),
});

/** Returns a consistent JSON error response for route-level failures. */
function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/** Extracts plain text from the v7 UIMessage text-part representation. */
function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(
      (
        part
      ): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Derives a concise initial thread title from the first user message. */
function getThreadTitle(messages: UIMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const title = firstUserMessage ? getMessageText(firstUserMessage) : "";

  return title.slice(0, THREAD_TITLE_LENGTH) || "New conversation";
}

/**
 * Creates the request-scoped Convex adapter used by tools and persistence so
 * every call shares the one Clerk JWT acquired by the route.
 */
function createConvexLayer(token: string): MindmapToolConvexLayer {
  return {
    getMindmap: (mindmapId) =>
      fetchQuery(
        api.mindmaps.get,
        { mindmapId: mindmapId as Id<"mindmaps"> },
        { token }
      ),
    applyOps: ({ mindmapId, ops, description, source }) =>
      fetchMutation(
        api.ops.apply,
        {
          mindmapId: mindmapId as Id<"mindmaps">,
          ops,
          description,
          source,
        },
        { token }
      ),
    renameMindmap: ({ mindmapId, name, source }) =>
      fetchMutation(
        api.mindmaps.rename,
        {
          mindmapId: mindmapId as Id<"mindmaps">,
          name,
          source,
        },
        { token }
      ),
    getHistory: ({ mindmapId, paginationOpts }) =>
      fetchQuery(
        api.ops.history,
        {
          mindmapId: mindmapId as Id<"mindmaps">,
          paginationOpts,
        },
        { token }
      ),
    undoTo: (operationId) =>
      fetchMutation(
        api.ops.undoTo,
        { operationId: operationId as Id<"operations"> },
        { token }
      ),
  };
}

/** Builds Sprig's behavioral prompt around the current compact map outline. */
function createInstructions(outline: string, selectedNodeId?: string): string {
  const selection = selectedNodeId
    ? `The user selected nodeId ${selectedNodeId}.`
    : "No node is currently selected.";

  return `You are Sprig, an AI collaborator for shaping the user's mindmap.

Current mindmap:
${outline}

${selection}

Use tools whenever the user asks to change or inspect persisted state. Batch related node creations into one createNodes call. Never invent nodeIds: use only ids from the outline, readMindmap, or createNodes results. Preserve a useful left/right balance for root children. A non-root child inherits its parent's side. When a mutation is rejected, read the returned error, adjust the plan, and explain only if it cannot be completed. After editing, use readMindmap when freshness matters.`;
}

/**
 * Streams one authenticated Sprig chat turn and persists its full v7
 * UIMessage parts after the response finishes.
 */
async function POST(request: Request): Promise<Response> {
  const authState = await auth();

  if (!authState.userId) {
    return jsonError("Unauthenticated", 401);
  }

  if (!isAIConfigured()) {
    return jsonError("AI is not configured", 503);
  }

  const token = await getConvexAuthToken(authState);
  if (!token) {
    return jsonError("Convex auth is not configured", 503);
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return jsonError("Invalid request", 400);
  }

  const parsedRequest = chatRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    return jsonError("Invalid request", 400);
  }

  const validatedMessages = await safeValidateUIMessages<UIMessage>({
    messages: parsedRequest.data.messages,
  });
  if (!validatedMessages.success) {
    return jsonError("Invalid request", 400);
  }

  const { mindmapId, selectedNodeId } = parsedRequest.data;
  const messages = validatedMessages.data;
  const lastUserMessage = messages.findLast(
    (message) => message.role === "user"
  );

  if (!lastUserMessage) {
    return jsonError("Invalid request", 400);
  }

  const convex = createConvexLayer(token);
  const currentMindmap = await convex.getMindmap(mindmapId);
  const threadId =
    parsedRequest.data.threadId ??
    (await fetchMutation(
      api.threads.createThread,
      {
        mindmapId: mindmapId as Id<"mindmaps">,
        title: getThreadTitle(messages),
      },
      { token }
    ));
  let lastOperation: AppliedOperation | undefined;
  const tools = createMindmapTools({
    mindmapId,
    convex,
    onOperationApplied: (operation) => {
      // Convex sequence numbers, not tool completion timing, define "last".
      if (!lastOperation || operation.seq >= lastOperation.seq) {
        lastOperation = operation;
      }
    },
  });
  const modelMessages = await convertToModelMessages(messages, { tools });
  const result = streamText({
    model: getAnthropicModel(),
    instructions: createInstructions(
      serializeMindmap(currentMindmap),
      selectedNodeId
    ),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    headers: {
      "x-sprig-thread-id": threadId,
    },
    onFinish: async ({ responseMessage }) => {
      await fetchMutation(
        api.threads.addMessage,
        {
          threadId: threadId as Id<"threads">,
          role: "user",
          content: lastUserMessage.parts,
        },
        { token }
      );
      await fetchMutation(
        api.threads.addMessage,
        {
          threadId: threadId as Id<"threads">,
          role: "assistant",
          content: responseMessage.parts,
          ...(lastOperation
            ? {
                operationId: lastOperation.operationId as Id<"operations">,
              }
            : {}),
        },
        { token }
      );
    },
  });
}

export { POST };
