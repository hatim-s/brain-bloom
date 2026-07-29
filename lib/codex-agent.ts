import { Codex, type Thread } from "@openai/codex-sdk";
import { z } from "zod";

import { AIConfigurationError } from "@/lib/ai/errors";

const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";

type GenerateCodexStructuredOptions<Schema extends z.ZodType> = {
  instructions: string;
  prompt: string;
  schema: Schema;
};

/** Returns whether an unknown value is a plain JSON-schema object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns whether a JSON-schema branch already permits null. */
function isNullableJsonSchema(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "null") {
    return true;
  }

  if (Array.isArray(value.type) && value.type.includes("null")) {
    return true;
  }

  return Array.isArray(value.anyOf) && value.anyOf.some(isNullableJsonSchema);
}

/**
 * Recursively converts ordinary JSON Schema into OpenAI's strict structured
 * output subset: every object property is required, while originally optional
 * properties become nullable so their application-level meaning is preserved.
 */
function makeCodexSchemaStrict(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(makeCodexSchemaStrict);
  }

  if (!isRecord(value)) {
    return value;
  }

  const result = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      makeCodexSchemaStrict(entry),
    ])
  );
  delete result.$schema;
  delete result.default;

  if (result.type === "object" && isRecord(result.properties)) {
    const originallyRequired = new Set(
      Array.isArray(result.required) ? result.required : []
    );

    for (const [key, property] of Object.entries(result.properties)) {
      if (!originallyRequired.has(key) && !isNullableJsonSchema(property)) {
        result.properties[key] = {
          anyOf: [property, { type: "null" }],
        };
      }
    }

    result.required = Object.keys(result.properties);
    result.additionalProperties = false;
  }

  return result;
}

/** Builds the strict recursive JSON schema accepted by Codex. */
function createCodexJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return makeCodexSchemaStrict(z.toJSONSchema(schema)) as Record<
    string,
    unknown
  >;
}

/**
 * Restores Sprig's optional-property contract after Codex returns null for
 * fields that strict structured outputs require to be present.
 */
function stripCodexOptionalNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripCodexOptionalNulls);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      entry === null ? [] : [[key, stripCodexOptionalNulls(entry)]]
    )
  );
}

/**
 * Builds the environment inherited by Codex while excluding API-key billing.
 * Saved `codex login` credentials and an optional `CODEX_ACCESS_TOKEN` remain
 * available to the bundled CLI runtime.
 */
function createCodexSubscriptionEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value !== undefined && key !== "OPENAI_API_KEY" && key !== "CODEX_API_KEY"
        ? [[key, value]]
        : []
    )
  );
}

/** Creates a Codex SDK client restricted to subscription-backed credentials. */
function createCodexClient(): Codex {
  return new Codex({ env: createCodexSubscriptionEnvironment() });
}

/**
 * Starts a stateless, read-only Codex thread for one Sprig AI operation.
 * Codex gets no write, approval, web-search, or network capability from Sprig.
 */
function createCodexThread(client = createCodexClient()): Thread {
  return client.startThread({
    model: process.env.SPRIG_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    modelReasoningEffort: "low",
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });
}

/** Converts Codex authentication failures into Sprig's stable config error. */
function getCodexError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (
    /(?:auth|credential|log(?:ged)? in|login|unauthori[sz]ed|401)/i.test(
      message
    )
  ) {
    return new AIConfigurationError(
      "Codex is not authenticated; run `codex login` on the app server"
    );
  }

  return error instanceof Error ? error : new Error(message);
}

/**
 * Runs one schema-constrained Codex SDK request and validates the parsed JSON
 * again at Sprig's application boundary.
 */
async function generateCodexStructured<Schema extends z.ZodType>({
  instructions,
  prompt,
  schema,
}: GenerateCodexStructuredOptions<Schema>): Promise<{
  rawOutput: string;
  output: z.infer<Schema>;
}> {
  try {
    const result = await createCodexThread().run(
      `${instructions}\n\nUser request:\n${prompt}`,
      { outputSchema: createCodexJsonSchema(schema) }
    );
    const parsedOutput: unknown = JSON.parse(result.finalResponse);

    return {
      rawOutput: result.finalResponse,
      output: schema.parse(stripCodexOptionalNulls(parsedOutput)),
    };
  } catch (error) {
    throw getCodexError(error);
  }
}

export {
  createCodexClient,
  createCodexJsonSchema,
  createCodexSubscriptionEnvironment,
  createCodexThread,
  DEFAULT_CODEX_MODEL,
  generateCodexStructured,
  getCodexError,
  stripCodexOptionalNulls,
};
