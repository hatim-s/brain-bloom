import { createUIMessageStream, type UIMessageStreamWriter } from "ai";
import { z } from "zod";

import { createCodexThread, getCodexError } from "@/lib/codex-agent";

import { createConversationPrompt } from "./chatPrompt";
import type {
  CreateAIChatStreamOptions,
  ExecutableMindmapTool,
  MindmapTools,
} from "./chatTypes";

const MAX_CODEX_TOOL_ROUNDS = 8;

const codexChatDecisionSchema = z
  .object({
    message: z.string(),
    toolCalls: z.array(
      z.object({
        name: z.string().min(1),
        inputJson: z.string(),
      })
    ),
  })
  .refine(
    ({ message, toolCalls }) =>
      toolCalls.length > 0 || message.trim().length > 0,
    { message: "Codex returned neither a message nor an application tool call" }
  );

const CODEX_CHAT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string" },
    toolCalls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          inputJson: { type: "string" },
        },
        required: ["name", "inputJson"],
        additionalProperties: false,
      },
    },
  },
  required: ["message", "toolCalls"],
  additionalProperties: false,
} as const;

type CodexToolResult = {
  input: unknown;
  name: string;
  output: unknown;
};

/** Describes Sprig's request-scoped tools without granting Codex shell access. */
function createCodexToolManifest(tools: MindmapTools): string {
  return JSON.stringify(
    Object.entries(tools).map(([name, rawTool]) => {
      const mindmapTool = rawTool as ExecutableMindmapTool;
      return {
        name,
        description: mindmapTool.description ?? name,
        inputSchema: z.toJSONSchema(mindmapTool.inputSchema),
      };
    })
  );
}

/** Builds the first Codex turn for the constrained local tool-planning loop. */
function createCodexChatPrompt(
  instructions: string,
  messages: CreateAIChatStreamOptions["messages"],
  tools: MindmapTools
): string {
  return `${instructions}

Conversation:
${createConversationPrompt(messages)}

Available application tools:
${createCodexToolManifest(tools)}

You are operating as a read-only planner. Do not inspect the repository, run
commands, edit files, or use any capability outside the application tools above.
If application state must change or be read, return toolCalls. Put each tool's
input in inputJson as valid JSON matching its schema. If no tool is needed,
return the final user-facing answer in message and an empty toolCalls array.
When toolCalls is non-empty, message may be empty.`;
}

/** Parses one schema-constrained decision returned by a Codex turn. */
function parseCodexChatDecision(rawOutput: string) {
  return codexChatDecisionSchema.parse(JSON.parse(rawOutput));
}

/** Executes one model-requested application tool and emits matching UI parts. */
async function executeCodexToolCall(
  name: string,
  inputJson: string,
  tools: MindmapTools,
  writer: UIMessageStreamWriter
): Promise<CodexToolResult> {
  const rawTool = tools[name as keyof MindmapTools];
  if (rawTool === undefined) {
    return {
      name,
      input: inputJson,
      output: { error: `Unknown tool: ${name}` },
    };
  }

  const mindmapTool = rawTool as ExecutableMindmapTool;
  let input: unknown;
  try {
    input = mindmapTool.inputSchema.parse(JSON.parse(inputJson));
  } catch (error) {
    return {
      name,
      input: inputJson,
      output: {
        error: error instanceof Error ? error.message : "Invalid tool input",
      },
    };
  }

  const toolCallId = crypto.randomUUID();
  writer.write({
    type: "tool-input-available",
    toolCallId,
    toolName: name,
    input,
    dynamic: true,
  });

  const output = await mindmapTool.execute(input, {
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

  return { name, input, output };
}

/** Writes the buffered final Codex response into the existing AI SDK stream. */
function writeCodexText(message: string, writer: UIMessageStreamWriter) {
  if (message.length === 0) {
    return;
  }

  const id = crypto.randomUUID();
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: message });
  writer.write({ type: "text-end", id });
}

/**
 * Runs Codex as a read-only planner and executes only Sprig's explicitly
 * declared mind-map tools, preserving the existing UI-message stream contract.
 */
function createCodexChatStream({
  abortSignal,
  instructions,
  messages,
  onFinish,
  tools,
}: CreateAIChatStreamOptions) {
  return createUIMessageStream({
    originalMessages: messages,
    onFinish,
    onError: (error) => getCodexError(error).message,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });

      const thread = createCodexThread();
      let prompt = createCodexChatPrompt(instructions, messages, tools);

      try {
        for (let round = 0; round < MAX_CODEX_TOOL_ROUNDS; round += 1) {
          const result = await thread.run(prompt, {
            outputSchema: CODEX_CHAT_OUTPUT_SCHEMA,
            signal: abortSignal,
          });
          const decision = parseCodexChatDecision(result.finalResponse);

          if (decision.toolCalls.length === 0) {
            writeCodexText(decision.message, writer);
            writer.write({ type: "finish-step" });
            writer.write({ type: "finish", finishReason: "stop" });
            return;
          }

          const toolResults: CodexToolResult[] = [];
          for (const toolCall of decision.toolCalls) {
            toolResults.push(
              await executeCodexToolCall(
                toolCall.name,
                toolCall.inputJson,
                tools,
                writer
              )
            );
          }

          prompt = `Application tool results:\n${JSON.stringify(toolResults)}\n\nReturn the next decision using the same output schema.`;
        }

        throw new Error("Codex exceeded the application tool-round limit");
      } catch (error) {
        if (abortSignal.aborted) {
          writer.write({ type: "abort", reason: "user" });
          return;
        }

        throw getCodexError(error);
      }
    },
  });
}

export {
  CODEX_CHAT_OUTPUT_SCHEMA,
  createCodexChatPrompt,
  createCodexChatStream,
  createCodexToolManifest,
  parseCodexChatDecision,
};
