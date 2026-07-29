import type { Tool, UIMessage, UIMessageStreamOnFinishCallback } from "ai";
import { z } from "zod";

import { createMindmapTools } from "./tools";

type MindmapTools = ReturnType<typeof createMindmapTools>;

type CreateAIChatStreamOptions = {
  abortSignal: AbortSignal;
  instructions: string;
  messages: UIMessage[];
  onFinish: UIMessageStreamOnFinishCallback<UIMessage>;
  tools: MindmapTools;
};

type ExecutableMindmapTool = Tool<unknown, unknown, unknown> & {
  description?: string;
  execute: NonNullable<Tool<unknown, unknown, unknown>["execute"]>;
  inputSchema: z.ZodObject<z.ZodRawShape>;
};

export {
  type CreateAIChatStreamOptions,
  type ExecutableMindmapTool,
  type MindmapTools,
};
