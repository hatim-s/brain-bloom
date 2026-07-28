import { z } from "zod";

import type { CreateAIChatStreamOptions } from "@/lib/ai/chatTypes";
import { createClaudeChatStream } from "@/lib/ai/claudeChat";
import { createCodexChatStream } from "@/lib/ai/codexChat";
import { AIConfigurationError } from "@/lib/ai/errors";
import {
  generateClaudeStructured,
  isClaudeConfigured,
} from "@/lib/claude-agent";
import { generateCodexStructured } from "@/lib/codex-agent";

const AI_PROVIDER_ENV_VAR = "SPRIG_AI_PROVIDER";
const DEFAULT_AI_PROVIDER = "claude";
const aiProviderSchema = z.enum(["claude", "codex"]);

type AIProvider = z.infer<typeof aiProviderSchema>;

type GenerateAIStructuredOptions<Schema extends z.ZodType> = {
  instructions: string;
  prompt: string;
  schema: Schema;
};

/** Resolves the process-wide provider switch and rejects ambiguous values. */
function getAIProvider(value = process.env[AI_PROVIDER_ENV_VAR]): AIProvider {
  const normalizedValue = value?.trim().toLowerCase() || DEFAULT_AI_PROVIDER;
  const result = aiProviderSchema.safeParse(normalizedValue);

  if (!result.success) {
    throw new AIConfigurationError(
      `${AI_PROVIDER_ENV_VAR} must be either "claude" or "codex"`
    );
  }

  return result.data;
}

/** Returns whether the selected provider has enough local auth to be started. */
function isAIConfigured(): boolean {
  try {
    return getAIProvider() === "codex" || isClaudeConfigured();
  } catch {
    return false;
  }
}

/** Routes a chat stream to the process-wide provider selected through the env. */
function createAIChatStream(options: CreateAIChatStreamOptions) {
  return getAIProvider() === "claude"
    ? createClaudeChatStream(options)
    : createCodexChatStream(options);
}

/** Routes schema-constrained generation through the selected provider SDK. */
async function generateAIStructured<Schema extends z.ZodType>(
  options: GenerateAIStructuredOptions<Schema>
): Promise<{ rawOutput: string; output: z.infer<Schema> }> {
  return getAIProvider() === "claude"
    ? generateClaudeStructured(options)
    : generateCodexStructured(options);
}

export {
  AI_PROVIDER_ENV_VAR,
  type AIProvider,
  createAIChatStream,
  DEFAULT_AI_PROVIDER,
  generateAIStructured,
  getAIProvider,
  isAIConfigured,
};
