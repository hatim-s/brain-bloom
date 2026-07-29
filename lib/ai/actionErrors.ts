import { ConvexError } from "convex/values";

import { AIConfigurationError } from "@/lib/ai/errors";

type AIActionErrorCode =
  | "not-configured"
  | "too-many-nodes"
  | "generation-failed";

/** Maps server-only error instances to the stable codes RSC can serialize. */
function getAIActionErrorCode(error: unknown): AIActionErrorCode {
  if (
    error instanceof AIConfigurationError ||
    (error instanceof Error && error.message.includes("not configured")) ||
    (error instanceof ConvexError &&
      typeof error.data === "string" &&
      error.data.includes("not configured"))
  ) {
    return "not-configured";
  }

  if (
    error instanceof ConvexError &&
    error.data === "Invalid op: too many nodes"
  ) {
    return "too-many-nodes";
  }

  return "generation-failed";
}

export { type AIActionErrorCode, getAIActionErrorCode };
