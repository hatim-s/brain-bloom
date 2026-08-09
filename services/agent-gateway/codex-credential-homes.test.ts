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
  assertTrustedCodexRuntimeAuthority,
  CodexCredentialHomeManager,
  CredentialHomeError,
  type DurableCredentialHomeCoordinator,
  FILE_CREDENTIAL_STORE_FLAG,
  TestOnlyCodexCredentialHomeManager,
} from "./codex-credential-homes.ts";

const temporaryDirectories: string[] = [];

type ManagerHarness = Readonly<{
  capabilities: LocalCredentialHomeTestCapabilities;
  manager: TestOnlyCodexCredentialHomeManager;
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

/** Builds an explicitly non-production manager from shared local capabilities. */
function buildTestManager(
  root: string,
  capabilities: LocalCredentialHomeTestCapabilities
): TestOnlyCodexCredentialHomeManager {
  return new TestOnlyCodexCredentialHomeManager({
    rootPath: root,
    capabilities,
  });
}

/** Creates a pre-provisioned root and initializes one test-only manager. */
async function createManager(
  hooks: LocalTestHostHooks = {}
): Promise<ManagerHarness> {
  const parent = await createTemporaryParent();
  const root = join(parent, "durable-codex-homes");
  await mkdir(root, { mode: 0o700 });
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

describe("production Codex credential-home authority", () => {
  it("fails closed because no production provisioner exists", async () => {
    const parent = await createTemporaryParent();
    const manager = new CodexCredentialHomeManager({
      rootPath: join(parent, "nonexistent-root"),
    });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_capability_unavailable");
  });

  it.each(["cast", "wrapper", "proxy"] as const)(
    "rejects a structurally forged %s authority before root access",
    async (variant) => {
      const parent = await createTemporaryParent();
      const root = join(parent, "nonexistent-root");
      const capabilities = createLocalCredentialHomeTestCapabilities();
      const fakeAuthority = {
        capabilities,
        environment: "production",
        siblingHomesInaccessible: true,
        identityBoundDeletion: true,
        persistentRevokedTombstones: true,
      };
      const authority =
        variant === "proxy"
          ? new Proxy(fakeAuthority, {})
          : variant === "wrapper"
            ? { ...fakeAuthority }
            : (fakeAuthority as unknown);
      const manager = new CodexCredentialHomeManager({
        rootPath: root,
        authority,
      });

      const error = await captureCredentialHomeError(() =>
        manager.initialize()
      );
      expect(error.code).toBe("credential_home_capability_unavailable");
      await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  it("rejects the exported test capability set as production authority", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "nonexistent-root");
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const manager = new CodexCredentialHomeManager({
      rootPath: root,
      authority: capabilities,
    });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_capability_unavailable");
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects nonexistent roots in the separate test-only API", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "nonexistent-root");
    const manager = buildTestManager(
      root,
      createLocalCredentialHomeTestCapabilities()
    );

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_unsafe");
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never upgrades test runtime values, casts, or proxies to production", async () => {
    const { manager } = await createManager();
    const runtime = (
      await manager.ensure({
        ownerId: "user_test_runtime",
        connectionId: "conn_test_runtime",
      })
    ).runtime;

    const productionLookingRuntime = {
      authority: "production",
      env: runtime.env,
      sessionFlags: runtime.sessionFlags,
    };
    for (const candidate of [
      runtime,
      { ...runtime },
      new Proxy(runtime, {}),
      productionLookingRuntime,
    ]) {
      const error = await captureCredentialHomeError(() =>
        assertTrustedCodexRuntimeAuthority(candidate)
      );
      expect(error.code).toBe("credential_home_capability_unavailable");
    }
    expect(runtime.authority).toBe("test-only");
  });

  it("rejects mismatched test capability domains", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "homes");
    await mkdir(root, { mode: 0o700 });
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const coordinator: DurableCredentialHomeCoordinator = {
      isolationDomain: "wrong-domain",
      runExclusive: (homeId, operation) =>
        capabilities.coordinator.runExclusive(homeId, operation),
    };

    const error = await captureCredentialHomeError(() =>
      buildTestManager(root, { ...capabilities, coordinator })
    );
    expect(error.code).toBe("credential_home_configuration_invalid");
  });
});

describe("test-only Codex credential-home lifecycle", () => {
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
      expect(result.runtime.authority).toBe("test-only");
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

  it("uses one external root pin across manager restart", async () => {
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

  it("rejects root substitution when a fresh manager verifies the pin", async () => {
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

  it("persists revoking before callback and denies queued ensure", async () => {
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
    expect((await captureCredentialHomeError(() => queuedEnsure)).code).toBe(
      "credential_home_revoked"
    );
  });

  it("keeps revoking terminal when provider callback fails and retries safely", async () => {
    const { capabilities, manager, root } = await createManager();
    const identity = {
      ownerId: "user_callback_failure",
      connectionId: "conn_callback_failure",
    };
    const ensured = await manager.ensure(identity);
    let callbackCount = 0;
    const firstError = await captureCredentialHomeError(() =>
      manager.teardown(identity, {
        revoke: () => {
          callbackCount += 1;
          throw new Error("provider-secret-canary");
        },
      })
    );
    expect(firstError.code).toBe("credential_revocation_failed");
    expect((await lstat(ensured.runtime.env.CODEX_HOME)).isDirectory()).toBe(
      true
    );

    const freshManager = buildTestManager(root, capabilities);
    await freshManager.initialize();
    expect(
      (await captureCredentialHomeError(() => freshManager.ensure(identity)))
        .code
    ).toBe("credential_home_revoked");

    const result = await freshManager.teardown(identity, {
      revoke: () => {
        callbackCount += 1;
      },
    });
    expect(result.state).toBe("removed");
    expect(callbackCount).toBe(2);
  });

  it("stays revoking when final tombstone persistence fails", async () => {
    const { capabilities, manager, root } = await createManager();
    const identity = {
      ownerId: "user_mark_failure",
      connectionId: "conn_mark_failure",
    };
    await manager.ensure(identity);
    capabilities.controls.failNextMarkRevoked();
    let callbackCount = 0;

    const error = await captureCredentialHomeError(() =>
      manager.teardown(identity, {
        revoke: () => {
          callbackCount += 1;
        },
      })
    );
    expect(error.code).toBe("credential_home_capability_unavailable");

    const freshManager = buildTestManager(root, capabilities);
    await freshManager.initialize();
    expect(
      (await captureCredentialHomeError(() => freshManager.ensure(identity)))
        .code
    ).toBe("credential_home_revoked");
    const retry = await freshManager.teardown(identity, {
      revoke: () => {
        callbackCount += 1;
      },
    });
    expect(retry.state).toBe("absent");
    expect(callbackCount).toBe(2);
  });

  it.each([undefined, null, "unknown", 0, {}, []])(
    "denies malformed lifecycle state %j",
    async (state) => {
      const { capabilities, manager } = await createManager();
      capabilities.controls.setNextLeaseState(state);
      const error = await captureCredentialHomeError(() =>
        manager.ensure({
          ownerId: "user_malformed_state",
          connectionId: "conn_malformed_state",
        })
      );
      expect(error.code).toBe("credential_home_capability_unavailable");
    }
  );

  it("fails closed when lifecycle coordination is unavailable", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "homes");
    await mkdir(root, { mode: 0o700 });
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const canary = "coordinator-secret-canary-319c";
    const coordinator: DurableCredentialHomeCoordinator = {
      isolationDomain: capabilities.coordinator.isolationDomain,
      runExclusive: async () => {
        throw new Error(canary);
      },
    };
    const manager = buildTestManager(root, {
      ...capabilities,
      coordinator,
    });
    await manager.initialize();

    const error = await captureCredentialHomeError(() =>
      manager.ensure({ ownerId: "user_safe", connectionId: "conn_safe" })
    );
    expect(error.code).toBe("credential_home_capability_unavailable");
    expect(error.message).not.toContain(canary);
  });

  it("keeps final teardown idempotent without invoking revoke again", async () => {
    const { manager } = await createManager();
    const identity = { ownerId: "user_absent", connectionId: "conn_absent" };
    let callbackCount = 0;
    const revoke = () => {
      callbackCount += 1;
    };
    const first = await manager.teardown(identity, { revoke });
    const second = await manager.teardown(identity, { revoke });
    expect(first).toEqual({ homeId: second.homeId, state: "absent" });
    expect(callbackCount).toBe(1);
  });

  it("removes nested state while preserving root and sibling homes", async () => {
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

describe("test-only adversarial host behavior", () => {
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
    expect(
      (await captureCredentialHomeError(() => harness.manager.ensure(identity)))
        .code
    ).toBe("credential_home_revoked");
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

  it("rejects symlink ancestors, roots, leaves, and permissive nodes", async () => {
    const parent = await createTemporaryParent();
    const target = join(parent, "target");
    const ancestor = join(parent, "ancestor");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, ancestor);
    const ancestorManager = buildTestManager(
      join(ancestor, "homes"),
      createLocalCredentialHomeTestCapabilities()
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
    const leafIdentity = { ownerId: "user_leaf", connectionId: "conn_leaf" };
    const leaf = await harness.manager.ensure(leafIdentity);
    await rm(leaf.runtime.env.CODEX_HOME, { recursive: true });
    await symlink(target, leaf.runtime.env.CODEX_HOME);
    expect(
      (
        await captureCredentialHomeError(() =>
          harness.manager.ensure(leafIdentity)
        )
      ).code
    ).toBe("credential_home_unsafe");

    const modeIdentity = { ownerId: "user_mode", connectionId: "conn_mode" };
    const modeHome = await harness.manager.ensure(modeIdentity);
    await chmod(modeHome.runtime.env.CODEX_HOME, 0o755);
    expect(
      (
        await captureCredentialHomeError(() =>
          harness.manager.ensure(modeIdentity)
        )
      ).code
    ).toBe("credential_home_unsafe");
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
