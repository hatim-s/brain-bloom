import {
  type Options,
  query,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { AIConfigurationError } from "@/lib/ai/errors";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";

type GenerateClaudeStructuredOptions<Schema extends z.ZodType> = {
  instructions: string;
  prompt: string;
  schema: Schema;
};

/**
 * Converts a Zod schema into the subset accepted by Claude Code's validator.
 * Zod emits a Draft 2020-12 meta-schema URI that the bundled runtime cannot
 * resolve, while the remaining recursive `$defs` and `$ref` structure works.
 */
function createClaudeJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema);

  // Claude Code validates the useful schema body but cannot resolve Zod's
  // Draft 2020-12 meta-schema URI.
  delete jsonSchema.$schema;

  return jsonSchema;
}

/** Returns whether the dev server can authenticate through Claude Code. */
function isClaudeConfigured(): boolean {
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
}

/**
 * Builds the isolated Agent SDK options shared by every Sprig AI path.
 *
 * Built-in Claude Code tools and filesystem settings are intentionally absent:
 * Sprig supplies its own tools and prompt, and the operator OAuth token is the
 * only credential this dev-local integration accepts.
 */
function createClaudeAgentOptions(overrides: Options = {}): Options {
  if (!isClaudeConfigured()) {
    throw new AIConfigurationError();
  }

  return {
    model: process.env.SPRIG_AI_MODEL ?? DEFAULT_CLAUDE_MODEL,
    tools: [],
    settingSources: [],
    persistSession: false,
    permissionMode: "dontAsk",
    ...overrides,
    env: {
      ...process.env,
      // Claude Code prefers API and cloud-provider credentials over a
      // subscription token, so remove those paths for this integration.
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_USE_BEDROCK: undefined,
      CLAUDE_CODE_USE_FOUNDRY: undefined,
      CLAUDE_CODE_USE_VERTEX: undefined,
      CLAUDE_AGENT_SDK_CLIENT_APP: "sprig/1.0.0",
      ...overrides.env,
    },
  };
}

/** Returns a useful error for any Agent SDK result that did not succeed. */
function getClaudeResultError(result: SDKResultMessage): Error {
  if (result.subtype === "success") {
    return new Error("Claude did not return structured output");
  }

  return new Error(
    result.errors.join("\n") || `Claude failed: ${result.subtype}`
  );
}

/**
 * Runs one schema-constrained Claude Agent SDK request and validates its output
 * again at the application boundary.
 */
async function generateClaudeStructured<Schema extends z.ZodType>({
  instructions,
  prompt,
  schema,
}: GenerateClaudeStructuredOptions<Schema>): Promise<{
  rawOutput: string;
  output: z.infer<Schema>;
}> {
  let finalResult: SDKResultMessage | undefined;

  for await (const message of query({
    prompt,
    options: createClaudeAgentOptions({
      systemPrompt: instructions,
      maxTurns: 3,
      outputFormat: {
        type: "json_schema",
        schema: createClaudeJsonSchema(schema),
      },
    }),
  })) {
    if (message.type === "result") {
      finalResult = message;
    }
  }

  if (
    finalResult === undefined ||
    finalResult.subtype !== "success" ||
    finalResult.structured_output === undefined
  ) {
    throw finalResult === undefined
      ? new Error("Claude ended without a result")
      : getClaudeResultError(finalResult);
  }

  return {
    rawOutput: finalResult.result,
    output: schema.parse(finalResult.structured_output),
  };
}

export {
  createClaudeAgentOptions,
  createClaudeJsonSchema,
  DEFAULT_CLAUDE_MODEL,
  generateClaudeStructured,
  getClaudeResultError,
  isClaudeConfigured,
};
