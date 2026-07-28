import { createAnthropic } from "@ai-sdk/anthropic";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";

/**
 * Signals that Sprig cannot construct its Anthropic model without local OAuth
 * credentials from the user's Claude subscription tooling.
 */
class AIConfigurationError extends Error {
  constructor() {
    super("AI is not configured");
    this.name = "AIConfigurationError";
  }
}

/** Returns whether the dev-local Claude subscription token is available. */
function isAIConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_OAUTH_TOKEN);
}

/**
 * Creates Sprig's Anthropic model with subscription OAuth authentication.
 *
 * `authToken` is the provider's supported Bearer-auth option. It prevents the
 * provider from resolving or sending an `x-api-key` header.
 */
function getAnthropicModel() {
  const authToken = process.env.ANTHROPIC_OAUTH_TOKEN;

  if (!authToken) {
    throw new AIConfigurationError();
  }

  const anthropic = createAnthropic({
    authToken,
    headers: {
      "anthropic-beta": ANTHROPIC_OAUTH_BETA,
    },
  });

  return anthropic(process.env.SPRIG_AI_MODEL ?? DEFAULT_ANTHROPIC_MODEL);
}

export {
  AIConfigurationError,
  ANTHROPIC_OAUTH_BETA,
  DEFAULT_ANTHROPIC_MODEL,
  getAnthropicModel,
  isAIConfigured,
};
