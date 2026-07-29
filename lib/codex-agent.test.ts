import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AIConfigurationError } from "./ai/errors";
import {
  createCodexClient,
  createCodexJsonSchema,
  createCodexSubscriptionEnvironment,
  createCodexThread,
  generateCodexStructured,
  stripCodexOptionalNulls,
} from "./codex-agent";

const mocks = vi.hoisted(() => ({
  clientOptions: undefined as unknown,
  run: vi.fn(),
  startThread: vi.fn(),
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: class Codex {
    constructor(options: unknown) {
      mocks.clientOptions = options;
    }

    startThread(options: unknown) {
      return mocks.startThread(options);
    }
  },
}));

describe("Codex SDK integration", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.clientOptions = undefined;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODEX_API_KEY;
    delete process.env.CODEX_ACCESS_TOKEN;
    delete process.env.SPRIG_CODEX_MODEL;
  });

  it("removes API keys while preserving subscription access tokens", () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.CODEX_API_KEY = "codex-key";
    process.env.CODEX_ACCESS_TOKEN = "subscription-token";

    const env = createCodexSubscriptionEnvironment();
    createCodexClient();

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.CODEX_ACCESS_TOKEN).toBe("subscription-token");
    expect(mocks.clientOptions).toEqual({ env });
  });

  it("starts Codex with read-only application boundaries", () => {
    process.env.SPRIG_CODEX_MODEL = "test-codex-model";
    const client = { startThread: mocks.startThread };
    mocks.startThread.mockReturnValue({ run: mocks.run });

    createCodexThread(client as never);

    expect(mocks.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-codex-model",
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
      })
    );
  });

  it("converts optional recursive fields to strict nullable properties", () => {
    type TreeNode = {
      children: TreeNode[];
      description?: string;
      title: string;
    };
    const treeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
      z.object({
        title: z.string(),
        description: z.string().optional(),
        children: z.array(treeNodeSchema).default([]),
      })
    );

    const jsonSchema = createCodexJsonSchema(
      z.object({ nodes: z.array(treeNodeSchema) })
    );
    const definitions = jsonSchema.$defs as Record<
      string,
      Record<string, unknown>
    >;
    const nodeSchema = Object.values(definitions)[0];
    const properties = nodeSchema.properties as Record<string, unknown>;

    expect(jsonSchema.$schema).toBeUndefined();
    expect(nodeSchema.required).toEqual(["title", "description", "children"]);
    expect(properties.description).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(
      (properties.children as Record<string, unknown>).default
    ).toBeUndefined();
    expect(JSON.stringify(jsonSchema)).toContain('"$ref"');
  });

  it("restores optional object properties after strict Codex output", () => {
    expect(
      stripCodexOptionalNulls({
        title: "Launch",
        description: null,
        children: [{ title: "Plan", link: null }],
      })
    ).toEqual({
      title: "Launch",
      children: [{ title: "Plan" }],
    });
  });

  it("returns application-validated structured output", async () => {
    mocks.startThread.mockReturnValue({ run: mocks.run });
    mocks.run.mockResolvedValue({
      finalResponse: '{"title":"Launch","description":null}',
    });

    const result = await generateCodexStructured({
      instructions: "Return a title",
      prompt: "Create a launch plan",
      schema: z.object({ title: z.string() }),
    });

    expect(result).toEqual({
      rawOutput: '{"title":"Launch","description":null}',
      output: { title: "Launch" },
    });
    expect(mocks.run).toHaveBeenCalledWith(
      "Return a title\n\nUser request:\nCreate a launch plan",
      expect.objectContaining({ outputSchema: expect.any(Object) })
    );
  });

  it("maps missing Codex login to the stable configuration error", async () => {
    mocks.startThread.mockReturnValue({ run: mocks.run });
    mocks.run.mockRejectedValue(new Error("Not logged in"));

    await expect(
      generateCodexStructured({
        instructions: "Return a title",
        prompt: "Create a launch plan",
        schema: z.object({ title: z.string() }),
      })
    ).rejects.toBeInstanceOf(AIConfigurationError);
  });
});
