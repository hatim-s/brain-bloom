import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createAIChatStream,
  generateAIStructured,
  getAIProvider,
  isAIConfigured,
} from "./providerRouter";

const mocks = vi.hoisted(() => ({
  createClaudeChatStream: vi.fn(() => "claude-stream"),
  createCodexChatStream: vi.fn(() => "codex-stream"),
  generateClaudeStructured: vi.fn(async () => ({
    rawOutput: '{"title":"Claude"}',
    output: { title: "Claude" },
  })),
  generateCodexStructured: vi.fn(async () => ({
    rawOutput: '{"title":"Codex"}',
    output: { title: "Codex" },
  })),
  isClaudeConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/ai/claudeChat", () => ({
  createClaudeChatStream: mocks.createClaudeChatStream,
}));
vi.mock("@/lib/ai/codexChat", () => ({
  createCodexChatStream: mocks.createCodexChatStream,
}));
vi.mock("@/lib/claude-agent", () => ({
  generateClaudeStructured: mocks.generateClaudeStructured,
  isClaudeConfigured: mocks.isClaudeConfigured,
}));
vi.mock("@/lib/codex-agent", () => ({
  generateCodexStructured: mocks.generateCodexStructured,
}));

describe("AI provider router", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.isClaudeConfigured.mockReturnValue(true);
    delete process.env.SPRIG_AI_PROVIDER;
  });

  it("defaults to Claude for backward compatibility", () => {
    expect(getAIProvider()).toBe("claude");
    expect(createAIChatStream({} as never)).toBe("claude-stream");
    expect(mocks.createClaudeChatStream).toHaveBeenCalledOnce();
  });

  it("routes chat and structured generation to Codex", async () => {
    process.env.SPRIG_AI_PROVIDER = "codex";
    const options = {
      instructions: "Return a title",
      prompt: "Create a plan",
      schema: z.object({ title: z.string() }),
    };

    expect(createAIChatStream({} as never)).toBe("codex-stream");
    await expect(generateAIStructured(options)).resolves.toEqual({
      rawOutput: '{"title":"Codex"}',
      output: { title: "Codex" },
    });
    expect(mocks.createCodexChatStream).toHaveBeenCalledOnce();
    expect(mocks.generateCodexStructured).toHaveBeenCalledWith(options);
  });

  it("reports missing Claude auth but lets the Codex SDK verify saved login", () => {
    mocks.isClaudeConfigured.mockReturnValue(false);
    expect(isAIConfigured()).toBe(false);

    process.env.SPRIG_AI_PROVIDER = "codex";
    expect(isAIConfigured()).toBe(true);
  });

  it("rejects unsupported provider values", () => {
    expect(() => getAIProvider("openai")).toThrow(
      'SPRIG_AI_PROVIDER must be either "claude" or "codex"'
    );
  });
});
