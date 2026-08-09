import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalCredentialHomeTestCapabilities,
  type LocalCredentialHomeTestCapabilities,
  type LocalTestHostHooks,
} from "./codex-credential-homes.test-support.ts";
import {
  CodexCredentialHomeManager,
  CredentialHomeError,
  type CredentialHomeHostCapability,
  type DurableCredentialHomeCoordinator,
  type DurableRootIdentityPins,
  FILE_CREDENTIAL_STORE_FLAG,
  type HostIsolationAttestation,
  type LifecycleDurabilityAttestation,
  type RootPinDurabilityAttestation,
} from "./codex-credential-homes.ts";

const temporaryDirectories: string[] = [];

type ManagerHarness = Readonly<{
  capabilities: LocalCredentialHomeTestCapabilities;
  manager: CodexCredentialHomeManager;
  parent: string;
  root: string;
}>;

/** Creates one real-path temporary parent so lexical symlinks stay observable. */
async function createTemporaryParent(): Promise<string> {
  const temporaryRoot = await realpath(tmpdir());
  const parent = await mkdtemp(join(temporaryRoot, "sprig-codex-homes-test-"));
  temporaryDirectories.push(parent);
  return parent;
}

/** Builds a manager with explicitly non-production shared test capabilities. */
function buildTestManager(
  root: string,
  capabilities: LocalCredentialHomeTestCapabilities
): CodexCredentialHomeManager {
  return new CodexCredentialHomeManager({
    rootPath: root,
    ...capabilities,
    allowTestOnlyCapabilities: true,
  });
}

/** Creates and initializes one manager with a not-yet-created durable root. */
async function createManager(
  hooks: LocalTestHostHooks = {}
): Promise<ManagerHarness> {
  const parent = await createTemporaryParent();
  const root = join(parent, "durable-codex-homes");
  const capabilities = createLocalCredentialHomeTestCapabilities(hooks);
  const manager = buildTestManager(root, capabilities);
  await manager.initialize();
  return { capabilities, manager, parent, root };
}

/** Captures only the manager's stable public error type and code. */
async function captureCredentialHomeError(
  action: () => unknown | Promise<unknown>
): Promise<CredentialHomeError> {
  try {
    await action();
    throw new Error("Expected a CredentialHomeError");
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialHomeError);
    return error as CredentialHomeError;
  }
}

/** Wraps a host while preserving every bound capability method. */
function proxyHost(
  host: CredentialHomeHostCapability,
  attestIsolation: (rootPath: string) => Promise<HostIsolationAttestation> = (
    rootPath
  ) => host.attestIsolation(rootPath)
): CredentialHomeHostCapability {
  return {
    isolationDomain: host.isolationDomain,
    attestIsolation,
    ensureRoot: (rootPath) => host.ensureRoot(rootPath),
    inspectRoot: (rootPath) => host.inspectRoot(rootPath),
    ensureHome: (input) => host.ensureHome(input),
    deleteHome: (input) => host.deleteHome(input),
  };
}

/** Restores one ambient environment key after credential-canary tests. */
function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("CodexCredentialHomeManager capability boundary", () => {
  it("fails closed without injected production capabilities", async () => {
    const parent = await createTemporaryParent();
    const manager = new CodexCredentialHomeManager({
      rootPath: join(parent, "homes"),
    });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_capability_unavailable");
  });

  it("rejects the portable test host unless test-only use is explicit", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "homes");
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const manager = new CodexCredentialHomeManager({
      rootPath: root,
      ...capabilities,
    });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_unsafe");
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["sibling", "deletion"] as const)(
    "rejects a false %s isolation attestation",
    async (failure) => {
      const parent = await createTemporaryParent();
      const root = join(parent, "homes");
      const capabilities = createLocalCredentialHomeTestCapabilities();
      const host = proxyHost(capabilities.host, async (rootPath) => ({
        ...(await capabilities.host.attestIsolation(rootPath)),
        environment: "production",
        siblingHomesInaccessible: failure !== "sibling",
        identityBoundDeletion: failure !== "deletion",
      }));
      const manager = buildTestManager(root, { ...capabilities, host });

      const error = await captureCredentialHomeError(() =>
        manager.initialize()
      );
      expect(error.code).toBe("credential_home_unsafe");
    }
  );

  it("maps unavailable attestations to a stable secret-free error", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "homes");
    const canary = "attestation-provider-secret-84f3";
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const host = proxyHost(capabilities.host, async () => {
      throw new CredentialHomeError(
        "credential_home_unsafe",
        `forged public error ${canary}`
      );
    });
    const manager = buildTestManager(root, { ...capabilities, host });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_capability_unavailable");
    expect(error.message).not.toContain(canary);
  });

  it("requires the host, root pins, and coordinator to share one domain", async () => {
    const parent = await createTemporaryParent();
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const coordinator: DurableCredentialHomeCoordinator = {
      isolationDomain: "wrong-domain",
      attestDurability: () => capabilities.coordinator.attestDurability(),
      runExclusive: (homeId, operation) =>
        capabilities.coordinator.runExclusive(homeId, operation),
    };
    const manager = new CodexCredentialHomeManager({
      rootPath: join(parent, "homes"),
      ...capabilities,
      coordinator,
      allowTestOnlyCapabilities: true,
    });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_configuration_invalid");
  });

  it("rejects a production root-pin capability without every durability proof", async () => {
    const parent = await createTemporaryParent();
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const rootPins: DurableRootIdentityPins = {
      isolationDomain: capabilities.rootPins.isolationDomain,
      attestDurability: async (): Promise<RootPinDurabilityAttestation> => ({
        isolationDomain: capabilities.rootPins.isolationDomain,
        environment: "production",
        storedOutsideManagedRoot: true,
        atomicCompareAndSet: true,
        survivesRestart: false,
      }),
      pinOrVerify: (rootKey, identity) =>
        capabilities.rootPins.pinOrVerify(rootKey, identity),
    };
    const manager = buildTestManager(join(parent, "homes"), {
      ...capabilities,
      rootPins,
    });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_unsafe");
  });

  it("rejects a production coordinator without durable terminal tombstones", async () => {
    const parent = await createTemporaryParent();
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const coordinator: DurableCredentialHomeCoordinator = {
      isolationDomain: capabilities.coordinator.isolationDomain,
      attestDurability: async (): Promise<LifecycleDurabilityAttestation> => ({
        isolationDomain: capabilities.coordinator.isolationDomain,
        environment: "production",
        crossProcessExclusive: true,
        persistentRevokedTombstones: false,
        revokedIsTerminal: true,
      }),
      runExclusive: (homeId, operation) =>
        capabilities.coordinator.runExclusive(homeId, operation),
    };
    const manager = buildTestManager(join(parent, "homes"), {
      ...capabilities,
      coordinator,
    });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_unsafe");
  });
});

describe("CodexCredentialHomeManager lifecycle", () => {
  it("isolates owners and connections without exposing either identifier", async () => {
    const { manager } = await createManager();
    const first = await manager.ensure({
      ownerId: "user_owner_alpha",
      connectionId: "connection_shared",
    });
    const secondOwner = await manager.ensure({
      ownerId: "user_owner_beta",
      connectionId: "connection_shared",
    });
    const secondConnection = await manager.ensure({
      ownerId: "user_owner_alpha",
      connectionId: "connection_other",
    });

    expect(
      new Set([first.homeId, secondOwner.homeId, secondConnection.homeId])
    ).toHaveLength(3);
    for (const result of [first, secondOwner, secondConnection]) {
      expect(result.homeId).toMatch(/^codex-[a-f0-9]{64}$/);
      expect(result.homeId).not.toContain("owner");
      expect(result.homeId).not.toContain("connection");
    }
  });

  it("returns a minimal pinned environment with no ambient credentials", async () => {
    const canary = "ambient-provider-secret-canary-7b78a";
    const names = [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CODEX_HOME",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]])
    );
    for (const name of names) {
      process.env[name] = canary;
    }

    try {
      const { manager } = await createManager();
      const result = await manager.ensure({
        ownerId: "user_env",
        connectionId: "conn_env",
      });
      expect(Object.keys(result.runtime.env)).toEqual(["CODEX_HOME"]);
      expect(JSON.stringify(result.runtime)).not.toContain(canary);
      expect(result.runtime.sessionFlags).toEqual([FILE_CREDENTIAL_STORE_FLAG]);
      expect(result.runtime.sessionFlags).toEqual([
        'cli_auth_credentials_store="file"',
      ]);
    } finally {
      for (const name of names) {
        restoreEnvironment(name, previous[name]);
      }
    }
  });

  it("serializes concurrent ensure across manager instances", async () => {
    const { capabilities, manager, root } = await createManager();
    const secondManager = buildTestManager(root, capabilities);
    await secondManager.initialize();
    const identity = {
      ownerId: "user_cross_manager",
      connectionId: "conn_cross_manager",
    };
    const results = await Promise.all([
      manager.ensure(identity),
      secondManager.ensure(identity),
      manager.ensure(identity),
      secondManager.ensure(identity),
    ]);

    expect(new Set(results.map((result) => result.homeId))).toHaveLength(1);
    expect(results.filter((result) => result.state === "created")).toHaveLength(
      1
    );
    expect(
      results.filter((result) => result.state === "existing")
    ).toHaveLength(3);
  });

  it("atomically establishes one external root pin during concurrent startup", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "homes");
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const first = buildTestManager(root, capabilities);
    const second = buildTestManager(root, capabilities);

    await Promise.all([first.initialize(), second.initialize()]);
    const identity = {
      ownerId: "user_startup",
      connectionId: "conn_startup",
    };
    const results = await Promise.all([
      first.ensure(identity),
      second.ensure(identity),
    ]);
    expect(results[0].homeId).toBe(results[1].homeId);
  });

  it("survives manager restart only through the shared external root pin", async () => {
    const { capabilities, manager, root } = await createManager();
    const identity = { ownerId: "user_restart", connectionId: "conn_restart" };
    const first = await manager.ensure(identity);
    await writeFile(
      join(first.runtime.env.CODEX_HOME, "state-sentinel"),
      "durable"
    );

    const restarted = buildTestManager(root, capabilities);
    await restarted.initialize();
    const second = await restarted.ensure(identity);

    expect(second).toMatchObject({ homeId: first.homeId, state: "existing" });
    expect(
      await readFile(
        join(second.runtime.env.CODEX_HOME, "state-sentinel"),
        "utf8"
      )
    ).toBe("durable");
  });

  it("rejects root substitution when a fresh manager verifies the external pin", async () => {
    const { capabilities, root } = await createManager();
    const displacedRoot = `${root}-original`;
    await rename(root, displacedRoot);
    await mkdir(root, { mode: 0o700 });

    const restarted = buildTestManager(root, capabilities);
    const error = await captureCredentialHomeError(() =>
      restarted.initialize()
    );

    expect(error.code).toBe("credential_home_unsafe");
    expect((await lstat(displacedRoot)).isDirectory()).toBe(true);
  });

  it("prevents queued ensure from overlapping or recreating after revoke", async () => {
    const { capabilities, manager, root } = await createManager();
    const secondManager = buildTestManager(root, capabilities);
    await secondManager.initialize();
    const identity = { ownerId: "user_race", connectionId: "conn_race" };
    await manager.ensure(identity);
    let releaseRevocation: (() => void) | undefined;
    let revocationStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      revocationStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });

    const teardown = manager.teardown(identity, {
      revoke: async () => {
        revocationStarted?.();
        await release;
      },
    });
    await started;
    const queuedEnsure = secondManager.ensure(identity);
    releaseRevocation?.();

    await expect(teardown).resolves.toMatchObject({ state: "removed" });
    const error = await captureCredentialHomeError(() => queuedEnsure);
    expect(error.code).toBe("credential_home_revoked");
  });

  it("preserves a revoked tombstone for a fresh manager after teardown", async () => {
    const { capabilities, manager, root } = await createManager();
    const identity = {
      ownerId: "user_tombstone",
      connectionId: "conn_tombstone",
    };
    await manager.ensure(identity);
    await manager.teardown(identity, { revoke: () => undefined });

    const freshManager = buildTestManager(root, capabilities);
    await freshManager.initialize();
    const error = await captureCredentialHomeError(() =>
      freshManager.ensure(identity)
    );
    expect(error.code).toBe("credential_home_revoked");
  });

  it("revokes once and retries idempotent cleanup under the tombstone", async () => {
    const { manager } = await createManager();
    const identity = { ownerId: "user_absent", connectionId: "conn_absent" };
    let revocationCount = 0;
    const revoke = () => {
      revocationCount += 1;
    };

    const first = await manager.teardown(identity, { revoke });
    const second = await manager.teardown(identity, { revoke });

    expect(first).toEqual({ homeId: second.homeId, state: "absent" });
    expect(revocationCount).toBe(1);
  });

  it("preserves local state when provider revocation fails", async () => {
    const { manager } = await createManager();
    const identity = { ownerId: "user_revoke", connectionId: "conn_revoke" };
    const ensured = await manager.ensure(identity);
    const error = await captureCredentialHomeError(() =>
      manager.teardown(identity, {
        revoke: () => {
          throw new Error(`provider leak ${identity.ownerId}`);
        },
      })
    );

    expect(error.code).toBe("credential_revocation_failed");
    expect(error.message).not.toContain(identity.ownerId);
    expect((await lstat(ensured.runtime.env.CODEX_HOME)).isDirectory()).toBe(
      true
    );
  });

  it("removes nested state while preserving root sentinels and sibling homes", async () => {
    const { manager, root } = await createManager();
    const removedIdentity = {
      ownerId: "user_remove",
      connectionId: "conn_remove",
    };
    const keptIdentity = { ownerId: "user_keep", connectionId: "conn_keep" };
    const removed = await manager.ensure(removedIdentity);
    const kept = await manager.ensure(keptIdentity);
    await mkdir(join(removed.runtime.env.CODEX_HOME, "partial", "nested"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(join(root, "root-sentinel"), "keep-root");

    const result = await manager.teardown(removedIdentity, {
      revoke: () => undefined,
    });

    expect(result).toEqual({ homeId: removed.homeId, state: "removed" });
    await expect(lstat(removed.runtime.env.CODEX_HOME)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await lstat(kept.runtime.env.CODEX_HOME)).isDirectory()).toBe(true);
    expect(await readFile(join(root, "root-sentinel"), "utf8")).toBe(
      "keep-root"
    );
  });
});

describe("CodexCredentialHomeManager adversarial host behavior", () => {
  it("fails identity-bound deletion when the home leaf is swapped", async () => {
    let displacedHome = "";
    const harness = await createManager({
      beforeDelete: async ({ homePath }) => {
        displacedHome = `${homePath}-original`;
        await rename(homePath, displacedHome);
        await mkdir(homePath, { mode: 0o700 });
      },
    });
    const identity = {
      ownerId: "user_leaf_swap",
      connectionId: "conn_leaf_swap",
    };
    await harness.manager.ensure(identity);

    const error = await captureCredentialHomeError(() =>
      harness.manager.teardown(identity, { revoke: () => undefined })
    );

    expect(error.code).toBe("credential_home_unsafe");
    expect((await lstat(displacedHome)).isDirectory()).toBe(true);
    const revoked = await captureCredentialHomeError(() =>
      harness.manager.ensure(identity)
    );
    expect(revoked.code).toBe("credential_home_revoked");
  });

  it("fails deletion when the durable root is swapped during the host call", async () => {
    let displacedRoot = "";
    const harness = await createManager({
      beforeDelete: async ({ rootPath }) => {
        displacedRoot = `${rootPath}-original`;
        await rename(rootPath, displacedRoot);
        await mkdir(rootPath, { mode: 0o700 });
      },
    });
    const identity = {
      ownerId: "user_root_swap",
      connectionId: "conn_root_swap",
    };
    await harness.manager.ensure(identity);

    const error = await captureCredentialHomeError(() =>
      harness.manager.teardown(identity, { revoke: () => undefined })
    );

    expect(error.code).toBe("credential_home_unsafe");
    expect((await lstat(displacedRoot)).isDirectory()).toBe(true);
  });

  it("fails closed with a stable error when the coordinator is unavailable", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "homes");
    const canary = "coordinator-secret-canary-319c";
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const coordinator: DurableCredentialHomeCoordinator = {
      isolationDomain: capabilities.coordinator.isolationDomain,
      attestDurability: () => capabilities.coordinator.attestDurability(),
      runExclusive: async () => {
        throw new CredentialHomeError(
          "credential_home_unsafe",
          `forged public error ${canary}`
        );
      },
    };
    const manager = buildTestManager(root, { ...capabilities, coordinator });
    await manager.initialize();

    const error = await captureCredentialHomeError(() =>
      manager.ensure({ ownerId: "user_safe", connectionId: "conn_safe" })
    );
    expect(error.code).toBe("credential_home_capability_unavailable");
    expect(error.message).not.toContain(canary);
  });

  it("rejects symlink ancestors, roots, leaves, and permissive nodes", async () => {
    const parent = await createTemporaryParent();
    const target = join(parent, "target");
    const ancestor = join(parent, "ancestor");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, ancestor);
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const ancestorManager = buildTestManager(
      join(ancestor, "homes"),
      capabilities
    );
    expect(
      (await captureCredentialHomeError(() => ancestorManager.initialize()))
        .code
    ).toBe("credential_home_capability_unavailable");

    const rootLink = join(parent, "root-link");
    await symlink(target, rootLink);
    const linkedManager = buildTestManager(
      rootLink,
      createLocalCredentialHomeTestCapabilities()
    );
    expect(
      (await captureCredentialHomeError(() => linkedManager.initialize())).code
    ).toBe("credential_home_unsafe");

    const harness = await createManager();
    const identity = { ownerId: "user_leaf", connectionId: "conn_leaf" };
    const ensured = await harness.manager.ensure(identity);
    await rm(ensured.runtime.env.CODEX_HOME, { recursive: true });
    await symlink(target, ensured.runtime.env.CODEX_HOME);
    const leafError = await captureCredentialHomeError(() =>
      harness.manager.ensure(identity)
    );
    expect(leafError.code).toBe("credential_home_unsafe");

    // Use a distinct ID to exercise an unsafe permissive directory leaf.
    const unsafeIdentity = {
      ownerId: "user_unsafe",
      connectionId: "conn_unsafe",
    };
    const unsafe = await harness.manager.ensure(unsafeIdentity);
    await rm(unsafe.runtime.env.CODEX_HOME, { recursive: true });
    await mkdir(unsafe.runtime.env.CODEX_HOME, { mode: 0o700 });
    await chmod(unsafe.runtime.env.CODEX_HOME, 0o755);
    const permissionError = await captureCredentialHomeError(() =>
      harness.manager.ensure(unsafeIdentity)
    );
    expect(permissionError.code).toBe("credential_home_unsafe");
    expect(ensured.homeId).not.toBe(unsafe.homeId);
  });

  it.each([
    "",
    ".",
    "..",
    "../connection",
    "owner/connection",
    "owner\\connection",
    "/absolute",
    "nul\0byte",
    "space value",
    "x".repeat(513),
  ])("rejects hostile identity value %j without path use", async (value) => {
    const { manager } = await createManager();
    const error = await captureCredentialHomeError(() =>
      manager.ensure({ ownerId: value, connectionId: "conn_safe" })
    );
    expect(error.code).toBe("credential_home_identifier_invalid");
    if (value.length > 0) {
      expect(error.message).not.toContain(value);
    }
  });
});
