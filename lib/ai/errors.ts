/** Signals that the selected server-side AI provider cannot start. */
class AIConfigurationError extends Error {
  constructor(message = "AI is not configured") {
    super(message);
    this.name = "AIConfigurationError";
  }
}

export { AIConfigurationError };
