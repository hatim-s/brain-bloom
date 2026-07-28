import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createCodexChatPrompt,
  createCodexToolManifest,
  parseCodexChatDecision,
} from "./codexChat";

const tools = {
  readMindmap: tool({
    description: "Read the map",
    inputSchema: z.object({}),
    execute: async () => ({ outline: "[nodeId:root] Launch" }),
  }),
};

describe("Codex chat adapter", () => {
  it("describes only the request-scoped application tools", () => {
    expect(JSON.parse(createCodexToolManifest(tools as never))).toEqual([
      expect.objectContaining({
        name: "readMindmap",
        description: "Read the map",
        inputSchema: expect.any(Object),
      }),
    ]);
  });

  it("combines instructions, conversation, and tool restrictions", () => {
    const prompt = createCodexChatPrompt(
      "You are Sprig.",
      [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Inspect the map" }],
        },
      ],
      tools as never
    );

    expect(prompt).toContain("You are Sprig.");
    expect(prompt).toContain("User: Inspect the map");
    expect(prompt).toContain("Do not inspect the repository");
    expect(prompt).toContain('"name":"readMindmap"');
  });

  it("parses the strict decision envelope", () => {
    expect(
      parseCodexChatDecision(
        '{"message":"","toolCalls":[{"name":"readMindmap","inputJson":"{}"}]}'
      )
    ).toEqual({
      message: "",
      toolCalls: [{ name: "readMindmap", inputJson: "{}" }],
    });
  });
});
