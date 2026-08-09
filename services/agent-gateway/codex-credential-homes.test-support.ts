import { lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, join, parse, relative } from "node:path";

import {
  type CredentialHomeHostCapability,
  type CredentialHomeLifecycleLease,
  type CredentialHomeLifecycleState,
  type DurableCredentialHomeCoordinator,
  type DurableRootIdentityPins,
  type HostDeleteHomeResult,
  type HostEnsureHomeResult,
  type HostIsolationAttestation,
  type HostRootIdentity,
  type HostRootResult,
  type LifecycleDurabilityAttestation,
  type RootPinDurabilityAttestation,
  type RootPinResult,
} from "./codex-credential-homes.ts";

const PRIVATE_DIRECTORY_MODE = 0o700;
const TEST_ISOLATION_DOMAIN = "local-test-emulator-v1";

type LocalTestHostHooks = Readonly<{
  beforeDelete?: (input: {
    rootPath: string;
    homePath: string;
  }) => void | Promise<void>;
}>;

type LocalCredentialHomeTestCapabilities = Readonly<{
  host: CredentialHomeHostCapability;
  rootPins: DurableRootIdentityPins;
  coordinator: DurableCredentialHomeCoordinator;
}>;

/**
 * In-memory, single-process coordinator used only to exercise the manager.
 *
 * It is not durable across process loss and must never be supplied to a
 * production manager. Sharing one instance emulates a durable coordinator for
 * deterministic multi-manager race tests.
 */
class LocalTestCredentialHomeCoordinator
  implements DurableCredentialHomeCoordinator
{
  readonly isolationDomain = TEST_ISOLATION_DOMAIN;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly states = new Map<
    string,
    Exclude<CredentialHomeLifecycleState, undefined>
  >();

  /** Truthfully labels this single-process, in-memory coordinator test-only. */
  async attestDurability(): Promise<LifecycleDurabilityAttestation> {
    return {
      isolationDomain: this.isolationDomain,
      environment: "test-only",
      crossProcessExclusive: false,
      persistentRevokedTombstones: false,
      revokedIsTerminal: true,
    };
  }

  /** Serializes one home and commits lifecycle state before releasing it. */
  async runExclusive<T>(
    homeId: string,
    operation: (lease: CredentialHomeLifecycleLease) => Promise<T>
  ): Promise<T> {
    const previous = this.locks.get(homeId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        let currentState = this.states.get(homeId);
        const lease: CredentialHomeLifecycleLease = {
          state: currentState,
          markActive: () => {
            if (currentState === "revoked") {
              throw new Error("test coordinator refuses revoked transition");
            }
            currentState = "active";
            this.states.set(homeId, currentState);
          },
          markRevoked: () => {
            currentState = "revoked";
            this.states.set(homeId, currentState);
          },
        };
        return operation(lease);
      });
    this.locks.set(homeId, current);

    try {
      return await current;
    } finally {
      if (this.locks.get(homeId) === current) {
        this.locks.delete(homeId);
      }
    }
  }
}

/** In-memory external root-pin emulator shared across manager restarts. */
class LocalTestRootIdentityPins implements DurableRootIdentityPins {
  readonly isolationDomain = TEST_ISOLATION_DOMAIN;
  private readonly pins = new Map<string, HostRootIdentity>();

  /** Truthfully labels these in-memory root pins as non-durable test support. */
  async attestDurability(): Promise<RootPinDurabilityAttestation> {
    return {
      isolationDomain: this.isolationDomain,
      environment: "test-only",
      storedOutsideManagedRoot: true,
      atomicCompareAndSet: true,
      survivesRestart: false,
    };
  }

  /** Atomically pins the first identity and rejects all later substitutions. */
  async pinOrVerify(
    rootKey: string,
    identity: HostRootIdentity
  ): Promise<RootPinResult> {
    const existing = this.pins.get(rootKey);
    if (!existing) {
      this.pins.set(rootKey, identity);
      return "pinned";
    }
    return sameIdentity(existing, identity) ? "verified" : "mismatch";
  }
}

/**
 * Portable behavior emulator for unit tests only.
 *
 * Its path-based operations do not satisfy the production deletion or
 * same-UID sibling-isolation threat model. The test-only attestation forces an
 * explicit allowTestOnlyCapabilities opt-in and cannot initialize defaults.
 */
class LocalTestCredentialHomeHost implements CredentialHomeHostCapability {
  readonly isolationDomain = TEST_ISOLATION_DOMAIN;

  constructor(private readonly hooks: LocalTestHostHooks = {}) {}

  /** Returns a simulated contract attestation explicitly labeled test-only. */
  async attestIsolation(): Promise<HostIsolationAttestation> {
    return {
      isolationDomain: this.isolationDomain,
      environment: "test-only",
      siblingHomesInaccessible: false,
      identityBoundDeletion: false,
    };
  }

  /** Creates or validates a private root for local behavioral tests. */
  async ensureRoot(rootPath: string): Promise<HostRootResult> {
    await assertExistingPathComponentsAreSafe(dirname(rootPath));
    try {
      await mkdir(rootPath, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
    }
    return inspectPrivateDirectory(rootPath);
  }

  /** Inspects the local root for manager pin verification. */
  async inspectRoot(rootPath: string): Promise<HostRootResult> {
    return inspectPrivateDirectory(rootPath);
  }

  /** Atomically creates one flat test home and validates its private mode. */
  async ensureHome(input: {
    rootPath: string;
    rootIdentity: HostRootIdentity;
    homeId: string;
  }): Promise<HostEnsureHomeResult> {
    if (!(await rootMatches(input.rootPath, input.rootIdentity))) {
      return { status: "unsafe" };
    }
    const homePath = join(input.rootPath, input.homeId);
    let state: "created" | "existing" = "created";
    try {
      await mkdir(homePath, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
      state = "existing";
    }
    const inspected = await inspectPrivateDirectory(homePath);
    if (
      inspected.status !== "ok" ||
      !(await rootMatches(input.rootPath, input.rootIdentity))
    ) {
      return { status: "unsafe" };
    }
    return { status: "ok", state, homePath };
  }

  /**
   * Emulates identity checks around deletion for adversarial unit tests only.
   * A production host must replace this with descriptor-bound semantics.
   */
  async deleteHome(input: {
    rootPath: string;
    rootIdentity: HostRootIdentity;
    homeId: string;
  }): Promise<HostDeleteHomeResult> {
    if (!(await rootMatches(input.rootPath, input.rootIdentity))) {
      return { status: "unsafe" };
    }
    const homePath = join(input.rootPath, input.homeId);
    const before = await inspectOptionalPrivateDirectory(homePath);
    if (before === "absent") {
      return { status: "absent" };
    }
    if (before.status !== "ok") {
      return { status: "unsafe" };
    }

    await this.hooks.beforeDelete?.({ rootPath: input.rootPath, homePath });

    const after = await inspectOptionalPrivateDirectory(homePath);
    if (
      after === "absent" ||
      after.status !== "ok" ||
      !sameIdentity(before.identity, after.identity) ||
      !(await rootMatches(input.rootPath, input.rootIdentity))
    ) {
      return { status: "unsafe" };
    }
    await rm(homePath, { recursive: true, force: false, maxRetries: 0 });
    return (await rootMatches(input.rootPath, input.rootIdentity))
      ? { status: "removed" }
      : { status: "unsafe" };
  }
}

/** Creates one explicitly non-production shared capability set for unit tests. */
function createLocalCredentialHomeTestCapabilities(
  hooks: LocalTestHostHooks = {}
): LocalCredentialHomeTestCapabilities {
  return {
    host: new LocalTestCredentialHomeHost(hooks),
    rootPins: new LocalTestRootIdentityPins(),
    coordinator: new LocalTestCredentialHomeCoordinator(),
  };
}

/** Rejects symlinks and non-directories in each existing parent component. */
async function assertExistingPathComponentsAreSafe(
  path: string
): Promise<void> {
  const root = parse(path).root;
  const components = relative(root, path).split(/[/\\]/).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    const metadata = await lstat(current, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("test host parent is unsafe");
    }
  }
}

/** Inspects a local private directory without exposing its path in results. */
async function inspectPrivateDirectory(path: string): Promise<HostRootResult> {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch {
    return { status: "unsafe" };
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    Number(metadata.mode & BigInt(0o777)) !== PRIVATE_DIRECTORY_MODE ||
    process.getuid === undefined ||
    metadata.uid !== BigInt(process.getuid())
  ) {
    return { status: "unsafe" };
  }
  const resolved = await realpath(path);
  const followed = await stat(resolved, { bigint: true });
  if (
    resolved !== path ||
    followed.dev !== metadata.dev ||
    followed.ino !== metadata.ino
  ) {
    return { status: "unsafe" };
  }
  return {
    status: "ok",
    identity: {
      device: `dev:${metadata.dev.toString(10)}`,
      inode: `ino:${metadata.ino.toString(10)}`,
      generation: `birth:${metadata.birthtimeNs.toString(10)}`,
    },
  };
}

/** Distinguishes a missing local home from unsafe existing state. */
async function inspectOptionalPrivateDirectory(
  path: string
): Promise<HostRootResult | "absent"> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "absent";
    }
    return { status: "unsafe" };
  }
  return inspectPrivateDirectory(path);
}

/** Checks a current local root against the manager-supplied pinned identity. */
async function rootMatches(
  rootPath: string,
  expected: HostRootIdentity
): Promise<boolean> {
  const result = await inspectPrivateDirectory(rootPath);
  return result.status === "ok" && sameIdentity(result.identity, expected);
}

/** Compares all opaque identity components in the test emulator. */
function sameIdentity(
  left: HostRootIdentity,
  right: HostRootIdentity
): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.generation === right.generation
  );
}

/** Narrows local filesystem errors for the non-production adapter. */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export {
  createLocalCredentialHomeTestCapabilities,
  type LocalCredentialHomeTestCapabilities,
  type LocalTestHostHooks,
};
