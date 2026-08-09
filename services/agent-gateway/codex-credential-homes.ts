import { createHash } from "node:crypto";
import { isAbsolute, join, normalize, parse } from "node:path";

const CODEX_HOME_PREFIX = "codex-";
const CODEX_HOME_NAMESPACE = "sprig/codex-credential-home/v1";
const ROOT_PIN_NAMESPACE = "sprig/codex-root-pin/v1";
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_CAPABILITY_ID_LENGTH = 256;
const FILE_CREDENTIAL_STORE_FLAG = 'cli_auth_credentials_store="file"';
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const SAFE_CAPABILITY_ID = /^[A-Za-z0-9_.:-]+$/;

type CredentialHomeErrorCode =
  | "credential_home_capability_unavailable"
  | "credential_home_configuration_invalid"
  | "credential_home_identifier_invalid"
  | "credential_home_revoked"
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

type HostRootIdentity = Readonly<{
  device: string;
  inode: string;
  generation: string;
}>;

type HostIsolationAttestation = Readonly<{
  isolationDomain: string;
  environment: "production" | "test-only";
  siblingHomesInaccessible: boolean;
  identityBoundDeletion: boolean;
}>;

type RootPinDurabilityAttestation = Readonly<{
  isolationDomain: string;
  environment: "production" | "test-only";
  storedOutsideManagedRoot: boolean;
  atomicCompareAndSet: boolean;
  survivesRestart: boolean;
}>;

type LifecycleDurabilityAttestation = Readonly<{
  isolationDomain: string;
  environment: "production" | "test-only";
  crossProcessExclusive: boolean;
  persistentRevokedTombstones: boolean;
  revokedIsTerminal: boolean;
}>;

type HostRootResult =
  | Readonly<{ status: "ok"; identity: HostRootIdentity }>
  | Readonly<{ status: "unsafe" }>;

type HostEnsureHomeResult =
  | Readonly<{
      status: "ok";
      state: "created" | "existing";
      homePath: string;
    }>
  | Readonly<{ status: "unsafe" }>;

type HostDeleteHomeResult =
  | Readonly<{ status: "absent" | "removed" }>
  | Readonly<{ status: "unsafe" }>;

type RootPinResult = "mismatch" | "pinned" | "verified";
type CredentialHomeLifecycleState = "active" | "revoked" | undefined;

type CredentialHomeLifecycleLease = Readonly<{
  state: CredentialHomeLifecycleState;
  markActive: () => void | Promise<void>;
  markRevoked: () => void | Promise<void>;
}>;

interface CredentialHomeHostCapability {
  readonly isolationDomain: string;
  /** Attests production sandboxing and identity-bound deletion for this root. */
  attestIsolation(rootPath: string): Promise<HostIsolationAttestation>;
  /** Creates or opens the exact durable root through trusted host primitives. */
  ensureRoot(rootPath: string): Promise<HostRootResult>;
  /** Returns the currently bound durable-root identity without adopting it. */
  inspectRoot(rootPath: string): Promise<HostRootResult>;
  /** Creates or opens one flat home bound to the supplied root identity. */
  ensureHome(input: {
    rootPath: string;
    rootIdentity: HostRootIdentity;
    homeId: string;
  }): Promise<HostEnsureHomeResult>;
  /** Deletes one home using descriptor/identity-bound, non-path-racy semantics. */
  deleteHome(input: {
    rootPath: string;
    rootIdentity: HostRootIdentity;
    homeId: string;
  }): Promise<HostDeleteHomeResult>;
}

interface DurableRootIdentityPins {
  readonly isolationDomain: string;
  /** Attests external storage, atomic compare-and-set, and restart durability. */
  attestDurability(): Promise<RootPinDurabilityAttestation>;
  /** Atomically compare-and-sets a pin in storage outside the managed root. */
  pinOrVerify(
    rootKey: string,
    identity: HostRootIdentity
  ): Promise<RootPinResult>;
}

interface DurableCredentialHomeCoordinator {
  readonly isolationDomain: string;
  /** Attests cross-process exclusion and terminal persistent tombstones. */
  attestDurability(): Promise<LifecycleDurabilityAttestation>;
  /**
   * Runs under a cross-process lease whose state transitions are durable before
   * their promises resolve and whose revoked state is never reset to active.
   */
  runExclusive<T>(
    homeId: string,
    operation: (lease: CredentialHomeLifecycleLease) => Promise<T>
  ): Promise<T>;
}

type CredentialHomeManagerOptions = Readonly<{
  rootPath: string;
  host?: CredentialHomeHostCapability;
  rootPins?: DurableRootIdentityPins;
  coordinator?: DurableCredentialHomeCoordinator;
  allowTestOnlyCapabilities?: boolean;
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
 * Coordinates isolated Codex homes through deployment-provided capabilities.
 *
 * Portable Node filesystem calls cannot prove sibling isolation, retain a root
 * identity outside a replaced root, coordinate multiple processes durably, or
 * provide descriptor-bound recursive deletion. Consequently this manager has
 * no production filesystem default and fails closed without all capabilities.
 */
class CodexCredentialHomeManager {
  private readonly rootPath: string;
  private readonly rootKey: string;
  private readonly host: CredentialHomeHostCapability | undefined;
  private readonly rootPins: DurableRootIdentityPins | undefined;
  private readonly coordinator: DurableCredentialHomeCoordinator | undefined;
  private readonly allowTestOnlyCapabilities: boolean;
  private rootIdentity: HostRootIdentity | undefined;

  constructor(options: CredentialHomeManagerOptions) {
    this.rootPath = validateRootPath(options.rootPath);
    this.rootKey = deriveRootKey(this.rootPath);
    this.host = options.host;
    this.rootPins = options.rootPins;
    this.coordinator = options.coordinator;
    this.allowTestOnlyCapabilities = options.allowTestOnlyCapabilities === true;
  }

  /**
   * Attests the host boundary and atomically pins the root outside that root.
   * A later manager cannot adopt a substituted filesystem object at this path.
   */
  async initialize(): Promise<void> {
    const capabilities = this.requireCapabilities();
    const attestation = await callCapability(() =>
      capabilities.host.attestIsolation(this.rootPath)
    );
    const rootPinAttestation = await callCapability(() =>
      capabilities.rootPins.attestDurability()
    );
    const lifecycleAttestation = await callCapability(() =>
      capabilities.coordinator.attestDurability()
    );
    validateHostAttestation(
      attestation,
      capabilities.isolationDomain,
      this.allowTestOnlyCapabilities
    );
    validateRootPinAttestation(
      rootPinAttestation,
      capabilities.isolationDomain,
      this.allowTestOnlyCapabilities
    );
    validateLifecycleAttestation(
      lifecycleAttestation,
      capabilities.isolationDomain,
      this.allowTestOnlyCapabilities
    );

    const rootResult = await callCapability(() =>
      capabilities.host.ensureRoot(this.rootPath)
    );
    const rootIdentity = requireSafeRoot(rootResult);
    const pinResult = await callCapability(() =>
      capabilities.rootPins.pinOrVerify(this.rootKey, rootIdentity)
    );
    if (pinResult === "mismatch") {
      throw unsafeHome();
    }
    if (pinResult !== "pinned" && pinResult !== "verified") {
      throw capabilityUnavailable();
    }
    this.rootIdentity = rootIdentity;
  }

  /** Ensures one home unless its durable lifecycle tombstone is revoked. */
  async ensure(
    identity: CredentialHomeIdentity
  ): Promise<EnsuredCredentialHome> {
    const homeId = deriveCredentialHomeId(identity);
    const capabilities = this.requireInitializedCapabilities();

    return this.coordinate(homeId, async (lease) => {
      if (lease.state === "revoked") {
        throw new CredentialHomeError(
          "credential_home_revoked",
          "Credential home has been revoked"
        );
      }

      const rootIdentity = await this.verifyPinnedRoot(capabilities);
      const homeResult = await callCapability(() =>
        capabilities.host.ensureHome({
          rootPath: this.rootPath,
          rootIdentity,
          homeId,
        })
      );
      if (!homeResult || homeResult.status !== "ok") {
        throw unsafeHome();
      }
      const expectedPath = join(this.rootPath, homeId);
      if (homeResult.homePath !== expectedPath) {
        throw unsafeHome();
      }
      await persistLifecycle(() => lease.markActive());

      return {
        homeId,
        state: homeResult.state,
        runtime: buildCodexRuntimeEnvironment(homeResult.homePath),
      };
    });
  }

  /**
   * Persists revocation while holding the cross-process lease, then delegates
   * identity-bound deletion. A tombstone survives failed cleanup and restart.
   */
  async teardown(
    identity: CredentialHomeIdentity,
    options: TeardownOptions
  ): Promise<CredentialHomeTeardown> {
    const homeId = deriveCredentialHomeId(identity);
    const capabilities = this.requireInitializedCapabilities();

    return this.coordinate(homeId, async (lease) => {
      if (lease.state !== "revoked") {
        try {
          await options.revoke();
        } catch {
          throw new CredentialHomeError(
            "credential_revocation_failed",
            "Credential revocation did not complete"
          );
        }
        // The durable tombstone is committed before local deletion. Ensure is
        // permanently closed even when deletion must be retried later.
        await persistLifecycle(() => lease.markRevoked());
      }

      const rootIdentity = await this.verifyPinnedRoot(capabilities);
      const deletion = await callCapability(() =>
        capabilities.host.deleteHome({
          rootPath: this.rootPath,
          rootIdentity,
          homeId,
        })
      );
      if (!deletion) {
        throw capabilityUnavailable();
      }
      if (deletion.status === "unsafe") {
        throw unsafeHome();
      }
      if (deletion.status !== "absent" && deletion.status !== "removed") {
        throw capabilityUnavailable();
      }
      return { homeId, state: deletion.status };
    });
  }

  /** Verifies the externally pinned root immediately before a host operation. */
  private async verifyPinnedRoot(
    capabilities: RequiredCapabilities
  ): Promise<HostRootIdentity> {
    const rootResult = await callCapability(() =>
      capabilities.host.inspectRoot(this.rootPath)
    );
    const rootIdentity = requireSafeRoot(rootResult);
    if (!sameRootIdentity(rootIdentity, this.rootIdentity)) {
      throw unsafeHome();
    }
    const pinResult = await callCapability(() =>
      capabilities.rootPins.pinOrVerify(this.rootKey, rootIdentity)
    );
    if (pinResult !== "verified") {
      throw pinResult === "mismatch" ? unsafeHome() : capabilityUnavailable();
    }
    return rootIdentity;
  }

  /** Runs one operation inside the injected durable lifecycle coordinator. */
  private async coordinate<T>(
    homeId: string,
    operation: (lease: CredentialHomeLifecycleLease) => Promise<T>
  ): Promise<T> {
    const coordinator = this.requireInitializedCapabilities().coordinator;
    let callbackError: unknown;
    try {
      return await coordinator.runExclusive(homeId, async (lease) => {
        try {
          return await operation(lease);
        } catch (error) {
          callbackError = error;
          throw error;
        }
      });
    } catch (error) {
      // Preserve only the exact manager error thrown by our callback. A backend
      // can otherwise forge this public type and smuggle sensitive text out.
      if (error === callbackError && error instanceof CredentialHomeError) {
        throw error;
      }
      throw capabilityUnavailable();
    }
  }

  /** Requires initialization plus all capability dependencies. */
  private requireInitializedCapabilities(): RequiredCapabilities {
    if (!this.rootIdentity) {
      throw new CredentialHomeError(
        "credential_home_configuration_invalid",
        "Credential home manager is not initialized"
      );
    }
    return this.requireCapabilities();
  }

  /** Validates that every capability belongs to one isolation domain. */
  private requireCapabilities(): RequiredCapabilities {
    if (!this.host || !this.rootPins || !this.coordinator) {
      throw capabilityUnavailable();
    }
    const isolationDomain = validateCapabilityId(this.host.isolationDomain);
    if (
      validateCapabilityId(this.rootPins.isolationDomain) !== isolationDomain ||
      validateCapabilityId(this.coordinator.isolationDomain) !== isolationDomain
    ) {
      throw new CredentialHomeError(
        "credential_home_configuration_invalid",
        "Credential home capabilities do not share an isolation domain"
      );
    }
    return {
      host: this.host,
      rootPins: this.rootPins,
      coordinator: this.coordinator,
      isolationDomain,
    };
  }
}

type RequiredCapabilities = Readonly<{
  host: CredentialHomeHostCapability;
  rootPins: DurableRootIdentityPins;
  coordinator: DurableCredentialHomeCoordinator;
  isolationDomain: string;
}>;

/** Derives a stable, non-secret filesystem name from one identity tuple. */
function deriveCredentialHomeId(identity: CredentialHomeIdentity): string {
  const ownerId = validateIdentifier(identity.ownerId);
  const connectionId = validateIdentifier(identity.connectionId);
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

/** Derives a non-path registry key for the externally stored root pin. */
function deriveRootKey(rootPath: string): string {
  return createHash("sha256")
    .update(ROOT_PIN_NAMESPACE)
    .update("\0")
    .update(rootPath)
    .digest("hex");
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

/** Validates that an opaque identity cannot be interpreted as a path. */
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

/** Validates a secret-free capability topology identifier. */
function validateCapabilityId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CAPABILITY_ID_LENGTH ||
    !SAFE_CAPABILITY_ID.test(value)
  ) {
    throw new CredentialHomeError(
      "credential_home_configuration_invalid",
      "Credential home capability identity is invalid"
    );
  }
  return value;
}

/** Requires production-grade isolation unless the explicit test switch is set. */
function validateHostAttestation(
  attestation: HostIsolationAttestation,
  isolationDomain: string,
  allowTestOnlyCapabilities: boolean
): void {
  if (
    !attestation ||
    attestation.isolationDomain !== isolationDomain ||
    (attestation.environment === "production" &&
      (attestation.siblingHomesInaccessible !== true ||
        attestation.identityBoundDeletion !== true)) ||
    (attestation.environment === "test-only" && !allowTestOnlyCapabilities) ||
    (attestation.environment !== "production" &&
      attestation.environment !== "test-only")
  ) {
    throw unsafeHome();
  }
}

/** Requires externally durable root pins unless running explicit test support. */
function validateRootPinAttestation(
  attestation: RootPinDurabilityAttestation,
  isolationDomain: string,
  allowTestOnlyCapabilities: boolean
): void {
  validateCapabilityAttestation(
    attestation,
    isolationDomain,
    allowTestOnlyCapabilities
  );
  if (
    attestation.environment === "production" &&
    (attestation.storedOutsideManagedRoot !== true ||
      attestation.atomicCompareAndSet !== true ||
      attestation.survivesRestart !== true)
  ) {
    throw unsafeHome();
  }
}

/** Requires durable terminal tombstones unless running explicit test support. */
function validateLifecycleAttestation(
  attestation: LifecycleDurabilityAttestation,
  isolationDomain: string,
  allowTestOnlyCapabilities: boolean
): void {
  validateCapabilityAttestation(
    attestation,
    isolationDomain,
    allowTestOnlyCapabilities
  );
  if (
    attestation.environment === "production" &&
    (attestation.crossProcessExclusive !== true ||
      attestation.persistentRevokedTombstones !== true ||
      attestation.revokedIsTerminal !== true)
  ) {
    throw unsafeHome();
  }
}

/** Validates the shared domain and explicit production/test environment gate. */
function validateCapabilityAttestation(
  attestation: Readonly<{
    isolationDomain: string;
    environment: "production" | "test-only";
  }>,
  isolationDomain: string,
  allowTestOnlyCapabilities: boolean
): void {
  if (
    !attestation ||
    attestation.isolationDomain !== isolationDomain ||
    (attestation.environment === "test-only" && !allowTestOnlyCapabilities) ||
    (attestation.environment !== "production" &&
      attestation.environment !== "test-only")
  ) {
    throw unsafeHome();
  }
}

/** Extracts a validated opaque root identity from the host result. */
function requireSafeRoot(result: HostRootResult): HostRootIdentity {
  if (!result || result.status !== "ok") {
    throw unsafeHome();
  }
  const { identity } = result;
  validateCapabilityId(identity.device);
  validateCapabilityId(identity.inode);
  validateCapabilityId(identity.generation);
  return identity;
}

/** Compares every host-provided root identity component. */
function sameRootIdentity(
  left: HostRootIdentity,
  right: HostRootIdentity | undefined
): boolean {
  return (
    right !== undefined &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.generation === right.generation
  );
}

/** Maps capability exceptions to one stable, secret-free public failure. */
async function callCapability<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw capabilityUnavailable();
  }
}

/** Persists coordinator state without reflecting backend errors. */
async function persistLifecycle(
  operation: () => void | Promise<void>
): Promise<void> {
  try {
    await operation();
  } catch {
    throw capabilityUnavailable();
  }
}

/** Creates the stable error for a missing or failed trusted capability. */
function capabilityUnavailable(): CredentialHomeError {
  return new CredentialHomeError(
    "credential_home_capability_unavailable",
    "Credential home isolation capability is unavailable"
  );
}

/** Creates the stable public error for unsafe host state or attestation. */
function unsafeHome(): CredentialHomeError {
  return new CredentialHomeError(
    "credential_home_unsafe",
    "Credential home isolation state is unsafe"
  );
}

export {
  CodexCredentialHomeManager,
  type CodexRuntimeEnvironment,
  CredentialHomeError,
  type CredentialHomeErrorCode,
  type CredentialHomeHostCapability,
  type CredentialHomeIdentity,
  type CredentialHomeLifecycleLease,
  type CredentialHomeLifecycleState,
  type CredentialHomeManagerOptions,
  type CredentialHomeTeardown,
  type DurableCredentialHomeCoordinator,
  type DurableRootIdentityPins,
  type EnsuredCredentialHome,
  FILE_CREDENTIAL_STORE_FLAG,
  type HostDeleteHomeResult,
  type HostEnsureHomeResult,
  type HostIsolationAttestation,
  type HostRootIdentity,
  type HostRootResult,
  type LifecycleDurabilityAttestation,
  type RootPinDurabilityAttestation,
  type RootPinResult,
  type TeardownOptions,
};
