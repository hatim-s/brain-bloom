import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
} from "node:path";

const CODEX_HOME_MODE = 0o700;
const CODEX_HOME_PREFIX = "codex-";
const CODEX_HOME_NAMESPACE = "sprig/codex-credential-home/v1";
const MAX_IDENTIFIER_LENGTH = 512;
const FILE_CREDENTIAL_STORE_FLAG = 'cli_auth_credentials_store="file"';
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;

type CredentialHomeErrorCode =
  | "credential_home_configuration_invalid"
  | "credential_home_identifier_invalid"
  | "credential_home_io_failed"
  | "credential_home_unsafe"
  | "credential_revocation_failed";

type CredentialHomeIdentity = Readonly<{
  ownerId: string;
  connectionId: string;
}>;

type CodexRuntimeEnvironment = Readonly<{
  env: Readonly<{ CODEX_HOME: string }>;
  sessionFlags: readonly [typeof FILE_CREDENTIAL_STORE_FLAG];
}>;

type EnsuredCredentialHome = Readonly<{
  homeId: string;
  state: "created" | "existing";
  runtime: CodexRuntimeEnvironment;
}>;

type CredentialHomeTeardown = Readonly<{
  homeId: string;
  state: "absent" | "removed";
}>;

type TeardownOptions = Readonly<{
  revoke: () => void | Promise<void>;
}>;

type RootIdentity = Readonly<{
  device: bigint;
  inode: bigint;
}>;

/** Stable, secret-free failure suitable for mapping at the gateway boundary. */
class CredentialHomeError extends Error {
  readonly code: CredentialHomeErrorCode;

  constructor(code: CredentialHomeErrorCode, message: string) {
    super(message);
    this.name = "CredentialHomeError";
    this.code = code;
  }
}

/**
 * Owns isolated, durable Codex homes beneath one private server directory.
 *
 * The manager deliberately exposes no discovery/list operation. Callers can
 * address only the home derived from the already-authorized owner/connection
 * pair supplied to an individual operation.
 */
class CodexCredentialHomeManager {
  private readonly rootPath: string;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private rootIdentity: RootIdentity | undefined;

  constructor(rootPath: string) {
    this.rootPath = validateRootPath(rootPath);
  }

  /** Creates or validates the private durable root without following symlinks. */
  async initialize(): Promise<void> {
    if (process.platform === "win32" || process.getuid === undefined) {
      throw new CredentialHomeError(
        "credential_home_configuration_invalid",
        "Codex credential homes require POSIX ownership and permission checks"
      );
    }

    await assertExistingPathComponentsAreSafe(dirname(this.rootPath));
    try {
      await mkdir(this.rootPath, { mode: CODEX_HOME_MODE });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw ioFailure();
      }
    }

    const rootIdentity = await inspectPrivateDirectory(this.rootPath);
    this.rootIdentity ??= rootIdentity;
    assertSameRoot(this.rootIdentity, rootIdentity);
  }

  /** Ensures exactly one private home for the authorized owner and connection. */
  async ensure(
    identity: CredentialHomeIdentity
  ): Promise<EnsuredCredentialHome> {
    const homeId = deriveCredentialHomeId(identity);
    return this.runExclusive(homeId, async () => {
      await this.assertInitializedRoot();
      const homePath = join(this.rootPath, homeId);
      let state: EnsuredCredentialHome["state"] = "created";

      try {
        await mkdir(homePath, { mode: CODEX_HOME_MODE });
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") {
          throw ioFailure();
        }
        state = "existing";
      }

      await inspectPrivateDirectory(homePath);
      await this.assertInitializedRoot();

      return {
        homeId,
        state,
        runtime: buildCodexRuntimeEnvironment(homePath),
      };
    });
  }

  /**
   * Revokes provider access before deleting local state, then removes only the
   * exact derived home. Repeating the operation remains safe when it is absent.
   */
  async teardown(
    identity: CredentialHomeIdentity,
    options: TeardownOptions
  ): Promise<CredentialHomeTeardown> {
    const homeId = deriveCredentialHomeId(identity);
    return this.runExclusive(homeId, async () => {
      try {
        await options.revoke();
      } catch {
        throw new CredentialHomeError(
          "credential_revocation_failed",
          "Credential revocation did not complete"
        );
      }

      await this.assertInitializedRoot();
      const homePath = join(this.rootPath, homeId);
      const homeState = await inspectOptionalPrivateDirectory(homePath);
      if (homeState === "absent") {
        return { homeId, state: "absent" };
      }

      // Rechecking the pinned root immediately before and after removal detects
      // root substitution rather than silently continuing in another tree.
      await this.assertInitializedRoot();
      try {
        await rm(homePath, { recursive: true, force: false, maxRetries: 0 });
      } catch {
        throw ioFailure();
      }
      await this.assertInitializedRoot();
      return { homeId, state: "removed" };
    });
  }

  /** Serializes same-home mutations while unrelated homes remain independent. */
  private async runExclusive<T>(
    homeId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.inFlight.get(homeId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.inFlight.set(homeId, current);

    try {
      return await current;
    } finally {
      if (this.inFlight.get(homeId) === current) {
        this.inFlight.delete(homeId);
      }
    }
  }

  /** Verifies that initialization happened and the durable root is unchanged. */
  private async assertInitializedRoot(): Promise<void> {
    if (!this.rootIdentity) {
      throw new CredentialHomeError(
        "credential_home_configuration_invalid",
        "Credential home manager is not initialized"
      );
    }
    assertSameRoot(
      this.rootIdentity,
      await inspectPrivateDirectory(this.rootPath)
    );
  }
}

/** Derives a stable, non-secret filesystem name from one identity tuple. */
function deriveCredentialHomeId(identity: CredentialHomeIdentity): string {
  const ownerId = validateIdentifier(identity.ownerId);
  const connectionId = validateIdentifier(identity.connectionId);
  // Length-prefixing avoids tuple ambiguity without retaining either raw value.
  const digest = createHash("sha256")
    .update(CODEX_HOME_NAMESPACE)
    .update("\0")
    .update(String(Buffer.byteLength(ownerId)))
    .update(":")
    .update(ownerId)
    .update("\0")
    .update(String(Buffer.byteLength(connectionId)))
    .update(":")
    .update(connectionId)
    .digest("hex");
  return `${CODEX_HOME_PREFIX}${digest}`;
}

/** Returns only the runtime authority needed by one Codex subprocess. */
function buildCodexRuntimeEnvironment(
  homePath: string
): CodexRuntimeEnvironment {
  return {
    env: { CODEX_HOME: homePath },
    sessionFlags: [FILE_CREDENTIAL_STORE_FLAG],
  };
}

/** Validates that an opaque identifier cannot be interpreted as a path. */
function validateIdentifier(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !SAFE_IDENTIFIER.test(value) ||
    value === "." ||
    value === ".." ||
    isAbsolute(value)
  ) {
    throw new CredentialHomeError(
      "credential_home_identifier_invalid",
      "Credential home identity is invalid"
    );
  }
  return value;
}

/** Accepts one canonical absolute root and rejects traversal spellings. */
function validateRootPath(rootPath: string): string {
  if (
    typeof rootPath !== "string" ||
    !isAbsolute(rootPath) ||
    normalize(rootPath) !== rootPath ||
    rootPath === parse(rootPath).root
  ) {
    throw new CredentialHomeError(
      "credential_home_configuration_invalid",
      "Credential home root is invalid"
    );
  }
  return rootPath;
}

/** Rejects symlinks or non-directories in every existing ancestor component. */
async function assertExistingPathComponentsAreSafe(
  path: string
): Promise<void> {
  const root = parse(path).root;
  const components = relative(root, path).split(/[/\\]/).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    let metadata;
    try {
      metadata = await lstat(current, { bigint: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new CredentialHomeError(
          "credential_home_configuration_invalid",
          "Credential home parent does not exist"
        );
      }
      throw ioFailure();
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw unsafeHome();
    }
  }
}

/** Verifies a private POSIX directory without following a symbolic-link leaf. */
async function inspectPrivateDirectory(path: string): Promise<RootIdentity> {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch {
    throw ioFailure();
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw unsafeHome();
  }

  const mode = Number(metadata.mode & BigInt(0o777));
  const currentUser = process.getuid?.();
  if (mode !== CODEX_HOME_MODE || currentUser === undefined) {
    throw unsafeHome();
  }

  // `realpath` and a following `stat` ensure the checked lexical directory and
  // resolved directory retain the same inode and current service ownership.
  let resolvedPath: string;
  let resolvedMetadata;
  try {
    resolvedPath = await realpath(path);
    resolvedMetadata = await stat(resolvedPath, { bigint: true });
  } catch {
    throw ioFailure();
  }
  if (
    resolvedPath !== path ||
    resolvedMetadata.dev !== metadata.dev ||
    resolvedMetadata.ino !== metadata.ino ||
    metadata.uid !== BigInt(currentUser)
  ) {
    throw unsafeHome();
  }
  return { device: metadata.dev, inode: metadata.ino };
}

/** Distinguishes an absent home from an unsafe or inaccessible existing node. */
async function inspectOptionalPrivateDirectory(
  path: string
): Promise<RootIdentity | "absent"> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "absent";
    }
    throw ioFailure();
  }
  return inspectPrivateDirectory(path);
}

/** Ensures a manager restart cannot silently bind to a substituted root. */
function assertSameRoot(expected: RootIdentity, actual: RootIdentity): void {
  if (expected.device !== actual.device || expected.inode !== actual.inode) {
    throw unsafeHome();
  }
}

/** Narrows platform filesystem failures without reflecting their path text. */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Creates the stable public error for an unsafe filesystem object. */
function unsafeHome(): CredentialHomeError {
  return new CredentialHomeError(
    "credential_home_unsafe",
    "Credential home filesystem state is unsafe"
  );
}

/** Creates the stable public error for a non-policy filesystem failure. */
function ioFailure(): CredentialHomeError {
  return new CredentialHomeError(
    "credential_home_io_failed",
    "Credential home filesystem operation failed"
  );
}

export {
  CodexCredentialHomeManager,
  type CodexRuntimeEnvironment,
  CredentialHomeError,
  type CredentialHomeErrorCode,
  type CredentialHomeIdentity,
  type CredentialHomeTeardown,
  type EnsuredCredentialHome,
  FILE_CREDENTIAL_STORE_FLAG,
  type TeardownOptions,
};
