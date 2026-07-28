import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AIConfigurationError } from "./ai/errors";
import {
  createClaudeAgentOptions,
  createClaudeJsonSchema,
  generateClaudeStructured,
} from "./claude-agent";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mocks.query,
}));

/** Creates the minimal async Agent SDK result stream used by these tests. */
function createResultStream(message: Record<string, unknown>) {
  return (async function* resultStream() {
    yield message;
  })();
}

describe("Claude Agent SDK integration", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("fails before starting an agent when the operator token is absent", () => {
    expect(() => createClaudeAgentOptions()).toThrow(AIConfigurationError);
  });

  it("forces subscription auth even when an API key exists in the shell", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "subscription-token";
    process.env.ANTHROPIC_API_KEY = "api-key";

    const options = createClaudeAgentOptions();

    expect(options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("subscription-token");
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.persistSession).toBe(false);
    expect(options.tools).toEqual([]);
  });

  it("removes the unsupported meta-schema while retaining recursive refs", () => {
    type TreeNode = { children: TreeNode[]; title: string };
    const treeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
      z.object({
        title: z.string(),
        children: z.array(treeNodeSchema),
      })
    );

    const jsonSchema = createClaudeJsonSchema(
      z.object({ nodes: z.array(treeNodeSchema) })
    );

    expect(jsonSchema.$schema).toBeUndefined();
    expect(jsonSchema.$defs).toBeDefined();
    expect(JSON.stringify(jsonSchema)).toContain('"$ref"');
  });

  it("returns application-validated structured output", async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "subscription-token";
    mocks.query.mockReturnValue(
      createResultStream({
        type: "result",
        subtype: "success",
        result: '{"title":"Launch"}',
        structured_output: { title: "Launch" },
      })
    );

    const result = await generateClaudeStructured({
      instructions: "Return a title",
      prompt: "Create a launch plan",
      schema: z.object({ title: z.string() }),
    });

    expect(result).toEqual({
      rawOutput: '{"title":"Launch"}',
      output: { title: "Launch" },
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Create a launch plan",
        options: expect.objectContaining({
          systemPrompt: "Return a title",
          outputFormat: expect.objectContaining({ type: "json_schema" }),
        }),
      })
    );
  });
});
