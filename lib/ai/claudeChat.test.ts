import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { createConversationPrompt } from "./chatPrompt";

describe("createConversationPrompt", () => {
  it("preserves visible multi-turn context for stateless Agent SDK calls", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Create a launch branch" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Added the branch." }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Now add risks" }],
      },
    ];

    expect(createConversationPrompt(messages)).toBe(
      "User: Create a launch branch\n\n" +
        "Assistant: Added the branch.\n\n" +
        "User: Now add risks"
    );
  });
});
