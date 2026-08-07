const MAX_SAFE_TEXT_LENGTH = 512;

const SAFE_INHERITED_ENVIRONMENT_KEYS = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "SHELL",
  "TMPDIR",
] as const;

const SECRET_NAME_PATTERN =
  /(?:api[_-]?key|authorization|bearer|cookie|credential|password|secret|token)/i;

/** Builds a minimal child environment without ambient provider credentials. */
function createIsolatedEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  additions: Record<string, string>
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const key of SAFE_INHERITED_ENVIRONMENT_KEYS) {
    const value = inherited[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  // An allowlist prevents newly introduced API-key variables from silently
  // becoming an authentication fallback in either provider subprocess.
  return { ...environment, ...additions };
}

/** Bounds untrusted provider text and removes known or caller-supplied secrets. */
function redactText(text: string, secrets: readonly string[] = []): string {
  let redacted = text;

  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }

  redacted = redacted
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]");

  if (redacted.length <= MAX_SAFE_TEXT_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, MAX_SAFE_TEXT_LENGTH)}…[truncated]`;
}

/** Recursively redacts sensitive keys before a probe result reaches output. */
function sanitizeForOutput(
  value: unknown,
  secrets: readonly string[] = []
): unknown {
  if (typeof value === "string") {
    return redactText(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 32).map((entry) => sanitizeForOutput(entry, secrets));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 64)
      .map(([key, entry]) => [
        key,
        SECRET_NAME_PATTERN.test(key)
          ? "[REDACTED]"
          : sanitizeForOutput(entry, secrets),
      ])
  );
}

export {
  createIsolatedEnvironment,
  MAX_SAFE_TEXT_LENGTH,
  redactText,
  sanitizeForOutput,
};
