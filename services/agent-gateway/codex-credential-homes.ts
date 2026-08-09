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

// These roots of trust are deliberately module-private. No portable production
// provisioner exists until a reviewed host adapter is selected and implemented
// inside this trusted module boundary.
const trustedProductionAuthorities = new WeakSet<object>();
const trustedRuntimeAuthorities = new WeakSet<object>();

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

type RuntimeEnvironmentShape = Readonly<{
  env: Readonly<{ CODEX_HOME: string }>;
  sessionFlags: readonly [typeof FILE_CREDENTIAL_STORE_FLAG];
}>;

type CodexRuntimeAuthority = RuntimeEnvironmentShape &
  Readonly<{ authority: "production" }>;

type TestOnlyCodexRuntimeEnvironment = RuntimeEnvironmentShape &
  Readonly<{ authority: "test-only" }>;

type EnsuredCredentialHome = Readonly<{
  homeId: string;
  state: "created" | "existing";
  runtime: CodexRuntimeAuthority;
}>;

type TestOnlyEnsuredCredentialHome = Readonly<{
  homeId: string;
  state: "created" | "existing";
  runtime: TestOnlyCodexRuntimeEnvironment;
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
type CredentialHomeLifecycleState =
  | "active"
  | "provisionable"
  | "revoked"
  | "revoking";

type CredentialHomeLifecycleLease = Readonly<{
  state: unknown;
  markActive: () => void | Promise<void>;
  markRevoking: () => void | Promise<void>;
  markRevoked: () => void | Promise<void>;
}>;

interface CredentialHomeHostCapability {
  readonly isolationDomain: string;
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
  /** Atomically compare-and-sets a pin stored outside the managed root. */
  pinOrVerify(
    rootKey: string,
    identity: HostRootIdentity
  ): Promise<RootPinResult>;
}

interface DurableCredentialHomeCoordinator {
  readonly isolationDomain: string;
  /**
   * Runs under a cross-process lease with durable transitions. Implementations
   * must never roll `revoking` or `revoked` back to an executable state.
   */
  runExclusive<T>(
    homeId: string,
    operation: (lease: CredentialHomeLifecycleLease) => Promise<T>
  ): Promise<T>;
}

type CredentialHomeCapabilities = Readonly<{
  host: CredentialHomeHostCapability;
  rootPins: DurableRootIdentityPins;
  coordinator: DurableCredentialHomeCoordinator;
}>;

type ProductionCredentialHomeAuthority = Readonly<{
  capabilities: CredentialHomeCapabilities;
}>;

type CredentialHomeManagerOptions = Readonly<{
  rootPath: string;
  authority?: unknown;
}>;

type TestOnlyCredentialHomeManagerOptions = Readonly<{
  rootPath: string;
  capabilities: CredentialHomeCapabilities;
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
 * Production entry point requiring module-branded host authority.
 *
 * No exported or portable code can mint that brand today. Construction is
 * intentionally inert until a future reviewed host adapter is implemented in
 * this module's trusted boundary.
 */
class CodexCredentialHomeManager {
  private readonly rootPath: string;
  private readonly authorityCandidate: unknown;
  private core: CredentialHomeManagerCore | undefined;

  constructor(options: CredentialHomeManagerOptions) {
    this.rootPath = validateRootPath(options.rootPath);
    this.authorityCandidate = options.authority;
  }

  /** Rejects every unbranded capability before it can touch a filesystem root. */
  async initialize(): Promise<void> {
    const authority = requireTrustedProductionAuthority(
      this.authorityCandidate
    );
    const core = new CredentialHomeManagerCore(
      this.rootPath,
      authority.capabilities,
      mintProductionRuntimeAuthority
    );
    await core.initialize();
    this.core = core;
  }

  /** Ensures a home only through already-branded production authority. */
  async ensure(
    identity: CredentialHomeIdentity
  ): Promise<EnsuredCredentialHome> {
    return this.requireCore().ensure(
      identity
    ) as Promise<EnsuredCredentialHome>;
  }

  /** Runs terminal revoke-first cleanup through production authority. */
  async teardown(
    identity: CredentialHomeIdentity,
    options: TeardownOptions
  ): Promise<CredentialHomeTeardown> {
    return this.requireCore().teardown(identity, options);
  }

  /** Requires successful branded initialization. */
  private requireCore(): CredentialHomeManagerCore {
    if (!this.core) {
      throw new CredentialHomeError(
        "credential_home_configuration_invalid",
        "Credential home manager is not initialized"
      );
    }
    return this.core;
  }
}

/**
 * Explicitly non-production manager used by local behavioral tests.
 *
 * Its runtime result is permanently labeled test-only and is never registered
 * with the module-private production runtime root of trust.
 */
class TestOnlyCodexCredentialHomeManager {
  private readonly core: CredentialHomeManagerCore;

  constructor(options: TestOnlyCredentialHomeManagerOptions) {
    this.core = new CredentialHomeManagerCore(
      validateRootPath(options.rootPath),
      options.capabilities,
      buildTestOnlyRuntimeEnvironment
    );
  }

  /** Initializes only the explicitly supplied local test capabilities. */
  async initialize(): Promise<void> {
    await this.core.initialize();
  }

  /** Exercises lifecycle logic without returning production runtime authority. */
  async ensure(
    identity: CredentialHomeIdentity
  ): Promise<TestOnlyEnsuredCredentialHome> {
    return this.core.ensure(identity) as Promise<TestOnlyEnsuredCredentialHome>;
  }

  /** Exercises terminal teardown logic without production authority. */
  async teardown(
    identity: CredentialHomeIdentity,
    options: TeardownOptions
  ): Promise<CredentialHomeTeardown> {
    return this.core.teardown(identity, options);
  }
}

type RuntimeEnvironmentFactory = (
  homePath: string
) => RuntimeEnvironmentShape & Readonly<{ authority: string }>;

type CoreEnsureResult = Readonly<{
  homeId: string;
  state: "created" | "existing";
  runtime: ReturnType<RuntimeEnvironmentFactory>;
}>;

/** Shared lifecycle implementation behind separately trusted public entries. */
class CredentialHomeManagerCore {
  private readonly rootKey: string;
  private rootIdentity: HostRootIdentity | undefined;

  constructor(
    private readonly rootPath: string,
    private readonly capabilities: CredentialHomeCapabilities,
    private readonly runtimeFactory: RuntimeEnvironmentFactory
  ) {
    this.rootKey = deriveRootKey(rootPath);
    requireMatchingIsolationDomain(capabilities);
  }

  /** Creates and externally pins one existing trusted-host root. */
  async initialize(): Promise<void> {
    // The host is responsible for rejecting nonexistent roots in production;
    // portable test support separately verifies this behavior.
    const rootResult = await callCapability(() =>
      this.capabilities.host.ensureRoot(this.rootPath)
    );
    const rootIdentity = requireSafeRoot(rootResult);
    const pinResult = await callCapability(() =>
      this.capabilities.rootPins.pinOrVerify(this.rootKey, rootIdentity)
    );
    if (pinResult === "mismatch") {
      throw unsafeHome();
    }
    if (pinResult !== "pinned" && pinResult !== "verified") {
      throw capabilityUnavailable();
    }
    this.rootIdentity = rootIdentity;
  }

  /** Allows ensure only from explicit provisionable or active lifecycle states. */
  async ensure(identity: CredentialHomeIdentity): Promise<CoreEnsureResult> {
    const homeId = deriveCredentialHomeId(identity);
    return this.coordinate(homeId, async (lease) => {
      const lifecycleState = requireLifecycleState(lease.state);
      if (lifecycleState !== "provisionable" && lifecycleState !== "active") {
        throw new CredentialHomeError(
          "credential_home_revoked",
          "Credential home is not executable"
        );
      }

      const rootIdentity = await this.verifyPinnedRoot();
      const homeResult = await callCapability(() =>
        this.capabilities.host.ensureHome({
          rootPath: this.rootPath,
          rootIdentity,
          homeId,
        })
      );
      if (!homeResult || homeResult.status !== "ok") {
        throw unsafeHome();
      }
      if (
        homeResult.homePath !== join(this.rootPath, homeId) ||
        (homeResult.state !== "created" && homeResult.state !== "existing")
      ) {
        throw capabilityUnavailable();
      }
      await persistLifecycle(() => lease.markActive());
      return {
        homeId,
        state: homeResult.state,
        runtime: this.runtimeFactory(homeResult.homePath),
      };
    });
  }

  /**
   * Persists terminal revoking intent before any external callback or deletion.
   * Cleanup retries may only advance `revoking` to `revoked`.
   */
  async teardown(
    identity: CredentialHomeIdentity,
    options: TeardownOptions
  ): Promise<CredentialHomeTeardown> {
    const homeId = deriveCredentialHomeId(identity);
    return this.coordinate(homeId, async (lease) => {
      const lifecycleState = requireLifecycleState(lease.state);
      if (lifecycleState !== "revoked") {
        if (lifecycleState !== "revoking") {
          await persistLifecycle(() => lease.markRevoking());
        }

        try {
          await options.revoke();
        } catch {
          // Revoking was already committed and remains terminal for retry.
          throw new CredentialHomeError(
            "credential_revocation_failed",
            "Credential revocation did not complete"
          );
        }
      }

      const rootIdentity = await this.verifyPinnedRoot();
      const deletion = await callCapability(() =>
        this.capabilities.host.deleteHome({
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

      if (lifecycleState !== "revoked") {
        // If this durable transition fails, the earlier revoking intent remains
        // terminal and a fresh manager can retry cleanup but never ensure.
        await persistLifecycle(() => lease.markRevoked());
      }
      return { homeId, state: deletion.status };
    });
  }

  /** Verifies the externally pinned root before every host operation. */
  private async verifyPinnedRoot(): Promise<HostRootIdentity> {
    if (!this.rootIdentity) {
      throw new CredentialHomeError(
        "credential_home_configuration_invalid",
        "Credential home manager is not initialized"
      );
    }
    const rootResult = await callCapability(() =>
      this.capabilities.host.inspectRoot(this.rootPath)
    );
    const rootIdentity = requireSafeRoot(rootResult);
    if (!sameRootIdentity(rootIdentity, this.rootIdentity)) {
      throw unsafeHome();
    }
    const pinResult = await callCapability(() =>
      this.capabilities.rootPins.pinOrVerify(this.rootKey, rootIdentity)
    );
    if (pinResult !== "verified") {
      throw pinResult === "mismatch" ? unsafeHome() : capabilityUnavailable();
    }
    return rootIdentity;
  }

  /** Runs one operation inside the injected cross-process coordinator. */
  private async coordinate<T>(
    homeId: string,
    operation: (lease: CredentialHomeLifecycleLease) => Promise<T>
  ): Promise<T> {
    let callbackError: unknown;
    try {
      return await this.capabilities.coordinator.runExclusive(
        homeId,
        async (lease) => {
          try {
            return await operation(lease);
          } catch (error) {
            callbackError = error;
            throw error;
          }
        }
      );
    } catch (error) {
      if (error === callbackError && error instanceof CredentialHomeError) {
        throw error;
      }
      throw capabilityUnavailable();
    }
  }
}

/** Runtime-validates the module-private production authority brand. */
function requireTrustedProductionAuthority(
  candidate: unknown
): ProductionCredentialHomeAuthority {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !trustedProductionAuthorities.has(candidate)
  ) {
    throw capabilityUnavailable();
  }
  return candidate as ProductionCredentialHomeAuthority;
}

/** Validates that a value is an unwrapped module-minted runtime authority. */
function assertTrustedCodexRuntimeAuthority(
  candidate: unknown
): asserts candidate is CodexRuntimeAuthority {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !trustedRuntimeAuthorities.has(candidate)
  ) {
    throw capabilityUnavailable();
  }
}

/** Mints runtime authority only after production manager authorization. */
function mintProductionRuntimeAuthority(
  homePath: string
): CodexRuntimeAuthority {
  const runtime: CodexRuntimeAuthority = Object.freeze({
    authority: "production",
    env: Object.freeze({ CODEX_HOME: homePath }),
    sessionFlags: Object.freeze([FILE_CREDENTIAL_STORE_FLAG] as const),
  });
  trustedRuntimeAuthorities.add(runtime);
  return runtime;
}

/** Builds an explicitly non-authoritative runtime for behavioral tests. */
function buildTestOnlyRuntimeEnvironment(
  homePath: string
): TestOnlyCodexRuntimeEnvironment {
  return Object.freeze({
    authority: "test-only",
    env: Object.freeze({ CODEX_HOME: homePath }),
    sessionFlags: Object.freeze([FILE_CREDENTIAL_STORE_FLAG] as const),
  });
}

/** Validates that every capability belongs to one topology domain. */
function requireMatchingIsolationDomain(
  capabilities: CredentialHomeCapabilities
): string {
  try {
    const isolationDomain = validateCapabilityId(
      capabilities.host.isolationDomain
    );
    if (
      validateCapabilityId(capabilities.rootPins.isolationDomain) !==
        isolationDomain ||
      validateCapabilityId(capabilities.coordinator.isolationDomain) !==
        isolationDomain
    ) {
      throw new Error("mismatched capability domain");
    }
    return isolationDomain;
  } catch {
    throw new CredentialHomeError(
      "credential_home_configuration_invalid",
      "Credential home capabilities are invalid"
    );
  }
}

/** Rejects absent, malformed, or invented lifecycle states at runtime. */
function requireLifecycleState(value: unknown): CredentialHomeLifecycleState {
  if (
    value !== "active" &&
    value !== "provisionable" &&
    value !== "revoked" &&
    value !== "revoking"
  ) {
    throw capabilityUnavailable();
  }
  return value;
}

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
    throw capabilityUnavailable();
  }
  return value;
}

/** Extracts a validated opaque root identity from the host result. */
function requireSafeRoot(result: HostRootResult): HostRootIdentity {
  try {
    if (!result || result.status !== "ok") {
      throw new Error("unsafe root");
    }
    const { identity } = result;
    validateCapabilityId(identity.device);
    validateCapabilityId(identity.inode);
    validateCapabilityId(identity.generation);
    return identity;
  } catch {
    throw unsafeHome();
  }
}

/** Compares every host-provided root identity component. */
function sameRootIdentity(
  left: HostRootIdentity,
  right: HostRootIdentity
): boolean {
  return (
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

/** Creates the stable error for missing, malformed, or failed authority. */
function capabilityUnavailable(): CredentialHomeError {
  return new CredentialHomeError(
    "credential_home_capability_unavailable",
    "Credential home isolation capability is unavailable"
  );
}

/** Creates the stable public error for unsafe host state. */
function unsafeHome(): CredentialHomeError {
  return new CredentialHomeError(
    "credential_home_unsafe",
    "Credential home isolation state is unsafe"
  );
}

export {
  assertTrustedCodexRuntimeAuthority,
  CodexCredentialHomeManager,
  type CodexRuntimeAuthority,
  type CredentialHomeCapabilities,
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
  type HostRootIdentity,
  type HostRootResult,
  type RootPinResult,
  type TeardownOptions,
  TestOnlyCodexCredentialHomeManager,
  type TestOnlyCodexRuntimeEnvironment,
  type TestOnlyCredentialHomeManagerOptions,
  type TestOnlyEnsuredCredentialHome,
};
