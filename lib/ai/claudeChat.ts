import {
  createSdkMcpServer,
  query,
  type SDKMessage,
  tool as createClaudeTool,
} from "@anthropic-ai/claude-agent-sdk";
import {
  createUIMessageStream,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";

import {
  createClaudeAgentOptions,
  getClaudeResultError,
} from "@/lib/claude-agent";

import { createConversationPrompt } from "./chatPrompt";
import type {
  CreateAIChatStreamOptions,
  ExecutableMindmapTool,
  MindmapTools,
} from "./chatTypes";

const CLAUDE_MCP_SERVER_NAME = "sprig";

/** Returns an object value suitable for MCP structuredContent. */
function toStructuredContent(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
}

/** Produces a stable fingerprint for correlating Agent SDK tool execution. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

/** Removes the in-process MCP prefix before exposing tool activity to the UI. */
function getDisplayToolName(name: string): string {
  const prefix = `mcp__${CLAUDE_MCP_SERVER_NAME}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/** Returns true when a streamed Agent SDK event is a text delta. */
function getTextDelta(message: SDKMessage): {
  delta: string;
  index: number;
} | null {
  if (
    message.type !== "stream_event" ||
    message.event.type !== "content_block_delta" ||
    message.event.delta.type !== "text_delta"
  ) {
    return null;
  }

  return { delta: message.event.delta.text, index: message.event.index };
}

/** Returns the content-block index whose streamed text has just ended. */
function getStoppedTextIndex(message: SDKMessage): number | null {
  return message.type === "stream_event" &&
    message.event.type === "content_block_stop"
    ? message.event.index
    : null;
}

/** Reads complete tool calls from one Agent SDK assistant message. */
function getToolCalls(message: SDKMessage): Array<{
  id: string;
  input: unknown;
  name: string;
}> {
  if (message.type !== "assistant") {
    return [];
  }

  return message.message.content.flatMap((block) =>
    block.type === "tool_use"
      ? [{ id: block.id, input: block.input, name: block.name }]
      : []
  );
}

/**
 * Bridges Sprig's existing server tool implementations into an in-process
 * Claude Agent SDK MCP server while preserving UI tool-call parts.
 */
function createMindmapMcpServer(
  tools: MindmapTools,
  writer: UIMessageStreamWriter<UIMessage>
) {
  const pendingCallIds = new Map<string, string[]>();
  const earlyCallIds = new Map<string, string[]>();

  /** Records the model-issued id before the corresponding handler executes. */
  function registerToolInput(name: string, input: unknown, toolCallId: string) {
    const displayName = getDisplayToolName(name);
    const fingerprint = `${displayName}:${stableStringify(input)}`;
    const earlyIds = earlyCallIds.get(fingerprint);

    // An in-process handler can occasionally run before the assistant message
    // reaches this iterator. In that case it already emitted both UI chunks.
    if (earlyIds && earlyIds.length > 0) {
      earlyIds.shift();
      return;
    }

    const ids = pendingCallIds.get(fingerprint) ?? [];
    ids.push(toolCallId);
    pendingCallIds.set(fingerprint, ids);
    writer.write({
      type: "tool-input-available",
      toolCallId,
      toolName: displayName,
      input,
      dynamic: true,
    });
  }

  const sdkTools = Object.entries(tools).map(([name, rawTool]) => {
    const mindmapTool = rawTool as ExecutableMindmapTool;

    return createClaudeTool(
      name,
      mindmapTool.description ?? name,
      mindmapTool.inputSchema.shape,
      async (args) => {
        const fingerprint = `${name}:${stableStringify(args)}`;
        const ids = pendingCallIds.get(fingerprint);
        let toolCallId = ids?.shift();

        if (toolCallId === undefined) {
          toolCallId = crypto.randomUUID();
          const earlyIds = earlyCallIds.get(fingerprint) ?? [];
          earlyIds.push(toolCallId);
          earlyCallIds.set(fingerprint, earlyIds);
          writer.write({
            type: "tool-input-available",
            toolCallId,
            toolName: name,
            input: args,
            dynamic: true,
          });
        }

        const output = await mindmapTool.execute(args, {
          toolCallId,
          messages: [],
          context: undefined,
        });

        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
          dynamic: true,
        });

        const structuredContent = toStructuredContent(output);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
          structuredContent,
        };
      }
    );
  });

  return {
    registerToolInput,
    server: createSdkMcpServer({
      name: CLAUDE_MCP_SERVER_NAME,
      version: "1.0.0",
      tools: sdkTools,
      alwaysLoad: true,
    }),
  };
}

/** Writes a complete assistant text block when partial events were unavailable. */
function writeCompleteAssistantText(
  message: SDKMessage,
  writer: UIMessageStreamWriter<UIMessage>
) {
  if (message.type !== "assistant") {
    return;
  }

  for (const block of message.message.content) {
    if (block.type !== "text" || block.text.length === 0) {
      continue;
    }

    const id = crypto.randomUUID();
    writer.write({ type: "text-start", id });
    writer.write({ type: "text-delta", id, delta: block.text });
    writer.write({ type: "text-end", id });
  }
}

/**
 * Streams one Claude Agent SDK turn through the AI SDK UI protocol already
 * consumed by Sprig's React chat surface.
 */
function createClaudeChatStream({
  abortSignal,
  instructions,
  messages,
  onFinish,
  tools,
}: CreateAIChatStreamOptions) {
  return createUIMessageStream<UIMessage>({
    originalMessages: messages,
    onFinish,
    onError: (error) =>
      error instanceof Error ? error.message : "Claude could not finish",
    execute: async ({ writer }) => {
      const abortController = new AbortController();
      const handleAbort = () => abortController.abort();
      abortSignal.addEventListener("abort", handleAbort, { once: true });

      writer.write({ type: "start" });
      writer.write({ type: "start-step" });

      const textIds = new Map<number, string>();
      let sawPartialText = false;
      const { registerToolInput, server } = createMindmapMcpServer(
        tools,
        writer
      );

      try {
        for await (const message of query({
          prompt: createConversationPrompt(messages),
          options: createClaudeAgentOptions({
            abortController,
            systemPrompt: instructions,
            includePartialMessages: true,
            maxTurns: 8,
            mcpServers: { [CLAUDE_MCP_SERVER_NAME]: server },
            allowedTools: [`mcp__${CLAUDE_MCP_SERVER_NAME}__*`],
          }),
        })) {
          const textDelta = getTextDelta(message);
          if (textDelta !== null) {
            sawPartialText = true;
            let textId = textIds.get(textDelta.index);
            if (textId === undefined) {
              textId = crypto.randomUUID();
              textIds.set(textDelta.index, textId);
              writer.write({ type: "text-start", id: textId });
            }

            writer.write({
              type: "text-delta",
              id: textId,
              delta: textDelta.delta,
            });
          }

          const stoppedTextIndex = getStoppedTextIndex(message);
          if (stoppedTextIndex !== null) {
            const textId = textIds.get(stoppedTextIndex);
            if (textId !== undefined) {
              writer.write({ type: "text-end", id: textId });
              textIds.delete(stoppedTextIndex);
            }
          }

          for (const toolCall of getToolCalls(message)) {
            registerToolInput(toolCall.name, toolCall.input, toolCall.id);
          }

          if (!sawPartialText) {
            writeCompleteAssistantText(message, writer);
          }

          if (message.type === "result" && message.subtype !== "success") {
            throw getClaudeResultError(message);
          }
        }

        for (const textId of Array.from(textIds.values())) {
          writer.write({ type: "text-end", id: textId });
        }

        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
      } catch (error) {
        if (abortController.signal.aborted) {
          writer.write({ type: "abort", reason: "user" });
          return;
        }

        throw error;
      } finally {
        abortSignal.removeEventListener("abort", handleAbort);
      }
    },
  });
}

export { createClaudeChatStream };
