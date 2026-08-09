const PERSONAL_BETA_SUBJECTS_ENV = "SPRIG_PERSONAL_BETA_CLERK_SUBJECTS";

type EnvironmentReader = (name: string) => string | undefined;

/** Reads one server-owned environment value without turning an unavailable runtime into access. */
function readProcessEnvironment(name: string): string | undefined {
  return process.env[name];
}

/**
 * Checks an authenticated Clerk subject against the exact personal-beta allowlist.
 *
 * Missing, unreadable, empty, and non-matching configuration all deny access.
 * Wildcards are intentionally treated as ordinary subject text.
 */
function isPersonalBetaSubjectAllowed(
  subject: string,
  readEnvironment: EnvironmentReader = readProcessEnvironment
): boolean {
  let configuredSubjects: string | undefined;

  try {
    configuredSubjects = readEnvironment(PERSONAL_BETA_SUBJECTS_ENV);
  } catch {
    return false;
  }

  if (configuredSubjects === undefined || configuredSubjects.trim() === "") {
    return false;
  }

  // Exact comparison keeps browser input and wildcard-like configuration from
  // broadening the server-controlled list.
  return configuredSubjects
    .split(",")
    .map((configuredSubject) => configuredSubject.trim())
    .filter((configuredSubject) => configuredSubject.length > 0)
    .some((configuredSubject) => configuredSubject === subject);
}

export { isPersonalBetaSubjectAllowed, PERSONAL_BETA_SUBJECTS_ENV };
