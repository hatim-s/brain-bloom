import type { UIMessage } from "ai";

/** Extracts text from the current AI SDK UI-message representation. */
function getUIMessageText(message: UIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .trim();
}

/** Serializes recent visible chat context into one provider-neutral prompt. */
function createConversationPrompt(messages: UIMessage[]): string {
  return messages
    .map((message) => {
      const text = getUIMessageText(message);
      return `${message.role === "assistant" ? "Assistant" : "User"}: ${
        text || "[mindmap tool activity]"
      }`;
    })
    .join("\n\n");
}

export { createConversationPrompt, getUIMessageText };
