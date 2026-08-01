import { auth } from "@clerk/nextjs/server";
import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type UIMessage,
} from "ai";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { ConvexError, type Value } from "convex/values";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createAIChatStream, isAIConfigured } from "@/lib/ai/providerRouter";
import { serializeMindmap } from "@/lib/ai/serializeMindmap";
import {
  type AppliedOperation,
  createMindmapTools,
  type MindmapToolConvexLayer,
} from "@/lib/ai/tools";
import { createConvexTokenSource } from "@/lib/convex-server";

const THREAD_TITLE_LENGTH = 60;
const MAX_MESSAGES_PER_REQUEST = 40;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_TEXT_PART_LENGTH = 16_000;

const uiMessagePartSchema = z
  .object({
    type: z.string().min(1),
    text: z.string().max(MAX_TEXT_PART_LENGTH).optional(),
  })
  .passthrough()
  .superRefine((part, context) => {
    if (part.type === "text" && typeof part.text !== "string") {
      context.addIssue({
        code: "custom",
        message: "Text parts require text",
        path: ["text"],
      });
    }
  });

const uiMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["system", "user", "assistant"]),
  metadata: z.unknown().optional(),
  parts: z.array(uiMessagePartSchema),
});

const chatRequestSchema = z.object({
  mindmapId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  messages: z.array(uiMessageSchema).min(1).max(MAX_MESSAGES_PER_REQUEST),
  selectedNodeId: z.string().min(1).optional(),
});

/** Returns a consistent JSON error response for route-level failures. */
function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/** Maps expected Convex request failures to display-safe HTTP JSON errors. */
function convexErrorResponse(error: ConvexError<Value>): Response {
  const message = typeof error.data === "string" ? error.data : error.message;
  const status =
    message === "Not found" ? 404 : message === "Forbidden" ? 403 : 400;

  return jsonError(message, status);
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
 * Creates the request-scoped Convex adapter used by tools and persistence.
 * Every call fetches a currently-valid Clerk JWT from the token source: a
 * streaming chat turn outlives one token's ~60s validity, so a token captured
 * once at route entry would expire before late tool calls and persistence.
 */
function createConvexLayer(
  freshToken: () => Promise<string>
): MindmapToolConvexLayer {
  return {
    getMindmap: async (mindmapId) =>
      fetchQuery(
        api.mindmaps.get,
        { mindmapId: mindmapId as Id<"mindmaps"> },
        { token: await freshToken() }
      ),
    applyOps: async ({ mindmapId, ops, description, source }) =>
      fetchMutation(
        api.ops.apply,
        {
          mindmapId: mindmapId as Id<"mindmaps">,
          ops,
          description,
          source,
        },
        { token: await freshToken() }
      ),
    renameMindmap: async ({ mindmapId, name, source }) =>
      fetchMutation(
        api.mindmaps.rename,
        {
          mindmapId: mindmapId as Id<"mindmaps">,
          name,
          source,
        },
        { token: await freshToken() }
      ),
    getHistory: async ({ mindmapId, paginationOpts }) =>
      fetchQuery(
        api.ops.history,
        {
          mindmapId: mindmapId as Id<"mindmaps">,
          paginationOpts,
        },
        { token: await freshToken() }
      ),
    getOperation: async (operationId) =>
      fetchQuery(
        api.ops.getOperation,
        { operationId: operationId as Id<"operations"> },
        { token: await freshToken() }
      ),
    undoTo: async (operationId) =>
      fetchMutation(
        api.ops.undoTo,
        { operationId: operationId as Id<"operations"> },
        { token: await freshToken() }
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

  const getConvexToken = createConvexTokenSource(authState);
  const initialToken = await getConvexToken();
  if (!initialToken) {
    return jsonError("Convex auth is not configured", 503);
  }
  /** Currently-valid JWT; configuration was proven non-null at route entry. */
  const freshToken = async () => (await getConvexToken()) as string;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError("Request too large", 413);
  }

  let requestBody: unknown;
  try {
    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return jsonError("Request too large", 413);
    }

    requestBody = JSON.parse(rawBody);
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

  try {
    const convex = createConvexLayer(freshToken);
    const currentMindmap = await convex.getMindmap(mindmapId);
    let threadId = parsedRequest.data.threadId;

    if (threadId !== undefined) {
      try {
        const thread = await fetchQuery(
          api.threads.getThread,
          { threadId: threadId as Id<"threads"> },
          { token: await freshToken() }
        );

        if (thread.mindmapId !== mindmapId) {
          return jsonError("thread belongs to a different mindmap", 400);
        }
      } catch (error) {
        if (error instanceof ConvexError) {
          return convexErrorResponse(error);
        }

        return jsonError("Invalid thread", 400);
      }
    } else {
      threadId = await fetchMutation(
        api.threads.createThread,
        {
          mindmapId: mindmapId as Id<"mindmaps">,
          title: getThreadTitle(messages),
        },
        { token: await freshToken() }
      );
    }

    let firstOperation: AppliedOperation | undefined;
    const tools = createMindmapTools({
      mindmapId,
      convex,
      onOperationApplied: (operation) => {
        // undoTo(first) reverses the entire turn, including all later tool ops.
        if (!firstOperation || operation.seq < firstOperation.seq) {
          firstOperation = operation;
        }
      },
    });
    const stream = createAIChatStream({
      abortSignal: request.signal,
      instructions: createInstructions(
        serializeMindmap(currentMindmap),
        selectedNodeId
      ),
      messages,
      tools,
      onFinish: async ({ responseMessage, isAborted }) => {
        // Aborted partial turns intentionally vanish from history replay.
        if (isAborted) {
          return;
        }

        await fetchMutation(
          api.threads.addMessage,
          {
            threadId: threadId as Id<"threads">,
            messageId: lastUserMessage.id,
            role: "user",
            content: lastUserMessage.parts,
          },
          { token: await freshToken() }
        );
        await fetchMutation(
          api.threads.addMessage,
          {
            threadId: threadId as Id<"threads">,
            messageId: responseMessage.id,
            role: "assistant",
            content: responseMessage.parts,
            ...(firstOperation
              ? {
                  operationId: firstOperation.operationId as Id<"operations">,
                }
              : {}),
          },
          { token: await freshToken() }
        );
      },
    });

    return createUIMessageStreamResponse({
      stream,
      headers: {
        "x-sprig-thread-id": threadId,
      },
    });
  } catch (error) {
    if (error instanceof ConvexError) {
      return convexErrorResponse(error);
    }

    return jsonError("Internal server error", 500);
  }
}

export { POST };
