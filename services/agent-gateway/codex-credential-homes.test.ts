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
  CodexCredentialHomeManager,
  CredentialHomeError,
  FILE_CREDENTIAL_STORE_FLAG,
} from "./codex-credential-homes.ts";

const temporaryDirectories: string[] = [];

/** Creates one real-path temporary parent so lexical symlinks stay observable. */
async function createTemporaryParent(): Promise<string> {
  const temporaryRoot = await realpath(tmpdir());
  const parent = await mkdtemp(join(temporaryRoot, "sprig-codex-homes-test-"));
  temporaryDirectories.push(parent);
  return parent;
}

/** Creates and initializes one manager with a not-yet-created durable root. */
async function createManager(): Promise<{
  manager: CodexCredentialHomeManager;
  parent: string;
  root: string;
}> {
  const parent = await createTemporaryParent();
  const root = join(parent, "durable-codex-homes");
  const manager = new CodexCredentialHomeManager(root);
  await manager.initialize();
  return { manager, parent, root };
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("CodexCredentialHomeManager", () => {
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

  it("serializes concurrent ensure calls for one deterministic home", async () => {
    const { manager } = await createManager();
    const identity = {
      ownerId: "user_parallel",
      connectionId: "conn_parallel",
    };
    const results = await Promise.all(
      Array.from({ length: 16 }, () => manager.ensure(identity))
    );

    expect(new Set(results.map((result) => result.homeId))).toHaveLength(1);
    expect(results.filter((result) => result.state === "created")).toHaveLength(
      1
    );
    expect(
      results.filter((result) => result.state === "existing")
    ).toHaveLength(15);
  });

  it("uses atomic creation across concurrently initialized managers", async () => {
    const { manager, root } = await createManager();
    const secondManager = new CodexCredentialHomeManager(root);
    await secondManager.initialize();
    const identity = {
      ownerId: "user_cross_manager",
      connectionId: "conn_cross_manager",
    };

    const results = await Promise.all([
      manager.ensure(identity),
      secondManager.ensure(identity),
    ]);

    expect(results[0].homeId).toBe(results[1].homeId);
    expect(results.map((result) => result.state).sort()).toEqual([
      "created",
      "existing",
    ]);
  });

  it("returns a minimal file-store-pinned environment with no ambient credentials", async () => {
    const canary = "ambient-provider-secret-canary-7b78a";
    const previous = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      claude: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      codexHome: process.env.CODEX_HOME,
    };
    process.env.OPENAI_API_KEY = canary;
    process.env.ANTHROPIC_API_KEY = canary;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = canary;
    process.env.CODEX_HOME = canary;

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
      restoreEnvironment("OPENAI_API_KEY", previous.openai);
      restoreEnvironment("ANTHROPIC_API_KEY", previous.anthropic);
      restoreEnvironment("CLAUDE_CODE_OAUTH_TOKEN", previous.claude);
      restoreEnvironment("CODEX_HOME", previous.codexHome);
    }
  });

  it("creates exact 0700 roots and homes owned by the service user", async () => {
    const { manager, root } = await createManager();
    const result = await manager.ensure({
      ownerId: "user_permissions",
      connectionId: "conn_permissions",
    });
    const rootMetadata = await lstat(root, { bigint: true });
    const homeMetadata = await lstat(result.runtime.env.CODEX_HOME, {
      bigint: true,
    });

    expect(Number(rootMetadata.mode & BigInt(0o777))).toBe(0o700);
    expect(Number(homeMetadata.mode & BigInt(0o777))).toBe(0o700);
    expect(Number(rootMetadata.uid)).toBe(process.getuid?.());
    expect(Number(homeMetadata.uid)).toBe(process.getuid?.());
  });

  it("derives the same durable home after a manager restart", async () => {
    const { manager, root } = await createManager();
    const identity = { ownerId: "user_restart", connectionId: "conn_restart" };
    const first = await manager.ensure(identity);
    await writeFile(
      join(first.runtime.env.CODEX_HOME, "state-sentinel"),
      "durable"
    );

    const restarted = new CodexCredentialHomeManager(root);
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
  ])(
    "rejects hostile identity value %j without filesystem access",
    async (value) => {
      const { manager } = await createManager();
      const error = await captureCredentialHomeError(() =>
        manager.ensure({ ownerId: value, connectionId: "conn_safe" })
      );

      expect(error.code).toBe("credential_home_identifier_invalid");
      if (value.length > 0) {
        expect(error.message).not.toContain(value);
      }
    }
  );

  it("rejects relative, traversal-spelled, and filesystem-root durable roots", () => {
    for (const value of ["relative/root", "/tmp/../tmp/homes", "/"]) {
      expect(() => new CodexCredentialHomeManager(value)).toThrowError(
        CredentialHomeError
      );
    }
  });

  it("rejects a symlinked root and does not change its target", async () => {
    const parent = await createTemporaryParent();
    const target = join(parent, "target");
    const rootLink = join(parent, "root-link");
    await mkdir(target, { mode: 0o700 });
    await writeFile(join(target, "sentinel"), "preserve");
    await symlink(target, rootLink);

    const error = await captureCredentialHomeError(() =>
      new CodexCredentialHomeManager(rootLink).initialize()
    );
    expect(error.code).toBe("credential_home_unsafe");
    expect(await readFile(join(target, "sentinel"), "utf8")).toBe("preserve");
  });

  it("rejects a symlinked ancestor before creating the durable root", async () => {
    const parent = await createTemporaryParent();
    const target = join(parent, "target-parent");
    const ancestorLink = join(parent, "ancestor-link");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, ancestorLink);

    const error = await captureCredentialHomeError(() =>
      new CodexCredentialHomeManager(join(ancestorLink, "homes")).initialize()
    );
    expect(error.code).toBe("credential_home_unsafe");
    await expect(lstat(join(target, "homes"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects symlink, file, and permissive existing home leaves", async () => {
    const { manager, parent } = await createManager();
    const identities = [
      { ownerId: "user_link", connectionId: "conn_link" },
      { ownerId: "user_file", connectionId: "conn_file" },
      { ownerId: "user_mode", connectionId: "conn_mode" },
    ];
    const initial = await Promise.all(
      identities.map((identity) => manager.ensure(identity))
    );
    await Promise.all(
      initial.map((result, index) =>
        manager.teardown(identities[index], { revoke: () => undefined })
      )
    );

    const linkTarget = join(parent, "outside-target");
    await mkdir(linkTarget, { mode: 0o700 });
    await symlink(linkTarget, initial[0].runtime.env.CODEX_HOME);
    await writeFile(initial[1].runtime.env.CODEX_HOME, "not-a-directory");
    await mkdir(initial[2].runtime.env.CODEX_HOME, { mode: 0o755 });

    for (const identity of identities) {
      const error = await captureCredentialHomeError(() =>
        manager.ensure(identity)
      );
      expect(error.code).toBe("credential_home_unsafe");
    }
  });

  it("revokes first and preserves the home when revocation fails", async () => {
    const { manager } = await createManager();
    const identity = { ownerId: "user_revoke", connectionId: "conn_revoke" };
    const ensured = await manager.ensure(identity);
    let existedDuringRevocation = false;

    const error = await captureCredentialHomeError(() =>
      manager.teardown(identity, {
        revoke: async () => {
          existedDuringRevocation = (
            await lstat(ensured.runtime.env.CODEX_HOME)
          ).isDirectory();
          throw new Error(`provider leak ${identity.ownerId}`);
        },
      })
    );

    expect(existedDuringRevocation).toBe(true);
    expect(error.code).toBe("credential_revocation_failed");
    expect(error.message).not.toContain(identity.ownerId);
    expect((await lstat(ensured.runtime.env.CODEX_HOME)).isDirectory()).toBe(
      true
    );
  });

  it("removes nested partial state while preserving the root and other homes", async () => {
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
    await writeFile(
      join(removed.runtime.env.CODEX_HOME, "partial", "nested", "state"),
      "x"
    );
    await writeFile(join(root, "root-sentinel"), "keep-root");

    const events: string[] = [];
    const result = await manager.teardown(removedIdentity, {
      revoke: () => {
        events.push("revoked");
      },
    });
    events.push("removed");

    expect(events).toEqual(["revoked", "removed"]);
    expect(result).toEqual({ homeId: removed.homeId, state: "removed" });
    await expect(lstat(removed.runtime.env.CODEX_HOME)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await lstat(kept.runtime.env.CODEX_HOME)).isDirectory()).toBe(true);
    expect(await readFile(join(root, "root-sentinel"), "utf8")).toBe(
      "keep-root"
    );
  });

  it("keeps missing teardown idempotent while still running revocation first", async () => {
    const { manager } = await createManager();
    const identity = { ownerId: "user_absent", connectionId: "conn_absent" };
    let revocationCount = 0;

    const first = await manager.teardown(identity, {
      revoke: () => {
        revocationCount += 1;
      },
    });
    const second = await manager.teardown(identity, {
      revoke: () => {
        revocationCount += 1;
      },
    });

    expect(first).toEqual({ homeId: second.homeId, state: "absent" });
    expect(revocationCount).toBe(2);
  });

  it("fails closed after its initialized root is substituted", async () => {
    const { manager, root } = await createManager();
    const displacedRoot = `${root}-displaced`;
    await rename(root, displacedRoot);
    await mkdir(root, { mode: 0o700 });

    const error = await captureCredentialHomeError(() =>
      manager.ensure({ ownerId: "user_swap", connectionId: "conn_swap" })
    );
    expect(error.code).toBe("credential_home_unsafe");
  });

  it("rejects unsafe root permissions and use before initialization", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "homes");
    const uninitialized = new CodexCredentialHomeManager(root);
    const useError = await captureCredentialHomeError(() =>
      uninitialized.ensure({ ownerId: "user_safe", connectionId: "conn_safe" })
    );
    expect(useError.code).toBe("credential_home_configuration_invalid");

    await mkdir(root, { mode: 0o700 });
    await chmod(root, 0o755);
    const permissionError = await captureCredentialHomeError(() =>
      new CodexCredentialHomeManager(root).initialize()
    );
    expect(permissionError.code).toBe("credential_home_unsafe");
  });
});

/** Restores one ambient environment key after credential-canary tests. */
function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
