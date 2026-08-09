// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PERSONAL_BETA_SUBJECTS_ENV } from "./lib/personalBeta";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts"]);

type ConnectionSeed = {
  ownerId: string;
  status?:
    | "pending"
    | "connected"
    | "error"
    | "expired"
    | "revoking"
    | "revoked"
    | "deleted";
  isDefault?: boolean;
  gatewayCredentialId?: string;
};

/** Creates an isolated connection harness with two authenticated Clerk subjects. */
function createHarness() {
  const t = convexTest(schema, modules);

  return {
    t,
    anonymous: t,
    asAlice: t.withIdentity({ subject: "user_alice" }),
    asBob: t.withIdentity({ subject: "user_bob" }),
  };
}

/** Seeds gateway-derived metadata without exposing a public lifecycle mutation. */
async function seedConnection(
  t: ReturnType<typeof convexTest>,
  {
    ownerId,
    status = "connected",
    isDefault = false,
    gatewayCredentialId = `gateway-${ownerId}`,
  }: ConnectionSeed
): Promise<Id<"aiConnections">> {
  return t.run((ctx) =>
    ctx.db.insert("aiConnections", {
      ownerId,
      provider: "codex",
      label: "Codex",
      status,
      authenticationMethod: "device_code",
      gatewayCredentialId,
      accountHint: `${ownerId.slice(-3)}***`,
      planLabel: "Subscription",
      isDefault,
      createdAt: 1,
      updatedAt: 1,
      lastValidationAt: 1,
      lastErrorCode: status === "error" ? "PROVIDER_UNAVAILABLE" : undefined,
    })
  );
}

/** Requires the complete stable error message, avoiding substring oracles. */
async function expectErrorMessage(
  promise: Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );

  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) {
    return;
  }

  expect(error.message).toBe(expectedMessage);
}

beforeEach(() => {
  vi.stubEnv(PERSONAL_BETA_SUBJECTS_ENV, "user_alice,user_bob");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ai connections", () => {
  it("creates pending Codex metadata entirely from server-derived fields", async () => {
    const { t, asAlice } = createHarness();
    const { connectionId } = await asAlice.action(
      api.aiConnections.createPendingCodex,
      {}
    );
    const stored = await t.run((ctx) => ctx.db.get(connectionId));

    expect(stored).toMatchObject({
      ownerId: "user_alice",
      provider: "codex",
      label: "Codex",
      status: "pending",
      authenticationMethod: "device_code",
      isDefault: false,
    });
    expect(stored?.gatewayCredentialId).toBeUndefined();
    expect(stored?.accountHint).toBeUndefined();
    expect(stored?.planLabel).toBeUndefined();
    expect(stored?.lastValidationAt).toBeUndefined();
    expect(stored?.lastErrorCode).toBeUndefined();
  });

  it.each([
    ["ownerId", "user_bob"],
    ["provider", "claude"],
    ["status", "connected"],
    ["gatewayCredentialId", "stolen"],
    ["accountHint", "victim@example.com"],
    ["planLabel", "Enterprise"],
    ["lastValidationAt", 1],
    ["lastErrorCode", "raw provider output"],
    ["lifecycleVersion", 1],
    ["lifecycleRevision", 1],
    ["evidenceId", "evidence-client"],
    ["requestId", "request-client"],
  ])("rejects the client-supplied %s field", async (field, value) => {
    const { t, asAlice } = createHarness();

    await expectErrorMessage(
      asAlice.action(api.aiConnections.createPendingCodex, {
        [field]: value,
      } as never),
      "Invalid connection request"
    );
    expect(
      await t.run((ctx) => ctx.db.query("aiConnections").collect())
    ).toEqual([]);
  });

  it("denies duplicate pending connections without affecting another owner", async () => {
    const { asAlice, asBob } = createHarness();

    await asAlice.action(api.aiConnections.createPendingCodex, {});
    await asBob.action(api.aiConnections.createPendingCodex, {});

    await expectErrorMessage(
      asAlice.action(api.aiConnections.createPendingCodex, {}),
      "Connection already pending"
    );

    expect(await asAlice.action(api.aiConnections.list, {})).toHaveLength(1);
    expect(await asBob.action(api.aiConnections.list, {})).toHaveLength(1);
  });

  it.each([undefined, "", "user_bob"])(
    "fails create closed for unavailable beta configuration (%s)",
    async (configuredSubjects) => {
      const { asAlice } = createHarness();

      if (configuredSubjects === undefined) {
        vi.unstubAllEnvs();
      } else {
        vi.stubEnv(PERSONAL_BETA_SUBJECTS_ENV, configuredSubjects);
      }

      await expectErrorMessage(
        asAlice.action(api.aiConnections.createPendingCodex, {}),
        "Personal beta access unavailable"
      );
    }
  );

  it("lists only the owner's safe display metadata", async () => {
    const { t, asAlice } = createHarness();
    const aliceConnection = await seedConnection(t, {
      ownerId: "user_alice",
      isDefault: true,
    });
    await seedConnection(t, { ownerId: "user_bob" });

    const connections = await asAlice.action(api.aiConnections.list, {});

    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      _id: aliceConnection,
      provider: "codex",
      status: "connected",
      accountHint: "ice***",
      planLabel: "Subscription",
      isDefault: true,
    });
    expect(connections[0]).not.toHaveProperty("ownerId");
    expect(connections[0]).not.toHaveProperty("gatewayCredentialId");
  });

  it("keeps safe owner-only reads available after de-allowlisting", async () => {
    const { t, asAlice } = createHarness();
    const connectionId = await seedConnection(t, { ownerId: "user_alice" });
    vi.stubEnv(PERSONAL_BETA_SUBJECTS_ENV, "user_bob");

    const listed = await asAlice.action(api.aiConnections.list, {});
    const status = await asAlice.action(api.aiConnections.getStatus, {
      connectionId,
    });

    expect(listed.map((connection) => connection._id)).toEqual([connectionId]);
    expect(status._id).toBe(connectionId);
  });

  it("returns the same stable error for missing and cross-owner status probes", async () => {
    const { t, asAlice } = createHarness();
    const bobConnection = await seedConnection(t, { ownerId: "user_bob" });
    const missingConnection = await seedConnection(t, {
      ownerId: "user_alice",
    });
    await t.run((ctx) => ctx.db.delete(missingConnection));

    await expectErrorMessage(
      asAlice.action(api.aiConnections.getStatus, {
        connectionId: bobConnection,
      }),
      "Connection unavailable"
    );
    await expectErrorMessage(
      asAlice.action(api.aiConnections.getStatus, {
        connectionId: missingConnection,
      }),
      "Connection unavailable"
    );
  });

  it("atomically replaces duplicate defaults only within the owner", async () => {
    const { t, asAlice } = createHarness();
    const firstAlice = await seedConnection(t, {
      ownerId: "user_alice",
      isDefault: true,
    });
    const selectedAlice = await seedConnection(t, {
      ownerId: "user_alice",
      isDefault: true,
    });
    const bobDefault = await seedConnection(t, {
      ownerId: "user_bob",
      isDefault: true,
    });

    await asAlice.action(api.aiConnections.selectDefaultCodex, {
      connectionId: selectedAlice,
    });

    const [first, selected, bob] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(firstAlice),
        ctx.db.get(selectedAlice),
        ctx.db.get(bobDefault),
      ])
    );
    expect(first?.isDefault).toBe(false);
    expect(selected?.isDefault).toBe(true);
    expect(bob?.isDefault).toBe(true);
  });

  it.each([
    "pending",
    "error",
    "expired",
    "revoking",
    "revoked",
    "deleted",
  ] as const)(
    "rejects selecting a %s connection without changing defaults",
    async (status) => {
      const { t, asAlice } = createHarness();
      const currentDefault = await seedConnection(t, {
        ownerId: "user_alice",
        isDefault: true,
      });
      const invalid = await seedConnection(t, {
        ownerId: "user_alice",
        status,
      });

      await expectErrorMessage(
        asAlice.action(api.aiConnections.selectDefaultCodex, {
          connectionId: invalid,
        }),
        "Connection unavailable"
      );

      expect(
        (await t.run((ctx) => ctx.db.get(currentDefault)))?.isDefault
      ).toBe(true);
      expect((await t.run((ctx) => ctx.db.get(invalid)))?.isDefault).toBe(
        false
      );
    }
  );

  it("blocks cross-owner selection and preserves both owners' defaults", async () => {
    const { t, asAlice } = createHarness();
    const aliceDefault = await seedConnection(t, {
      ownerId: "user_alice",
      isDefault: true,
    });
    const bobDefault = await seedConnection(t, {
      ownerId: "user_bob",
      isDefault: true,
    });

    await expectErrorMessage(
      asAlice.action(api.aiConnections.selectDefaultCodex, {
        connectionId: bobDefault,
      }),
      "Connection unavailable"
    );

    expect((await t.run((ctx) => ctx.db.get(aliceDefault)))?.isDefault).toBe(
      true
    );
    expect((await t.run((ctx) => ctx.db.get(bobDefault)))?.isDefault).toBe(
      true
    );
  });

  it("fails selection closed immediately after de-allowlisting", async () => {
    const { t, asAlice } = createHarness();
    const connectionId = await seedConnection(t, { ownerId: "user_alice" });
    vi.stubEnv(PERSONAL_BETA_SUBJECTS_ENV, "user_bob");

    await expectErrorMessage(
      asAlice.action(api.aiConnections.selectDefaultCodex, { connectionId }),
      "Personal beta access unavailable"
    );
    expect((await t.run((ctx) => ctx.db.get(connectionId)))?.isDefault).toBe(
      false
    );
  });

  it("requires Clerk authentication for every entry point", async () => {
    const { t, anonymous } = createHarness();
    const connectionId = await seedConnection(t, { ownerId: "user_alice" });

    await expectErrorMessage(
      anonymous.action(api.aiConnections.list, {}),
      "Unauthenticated"
    );
    await expectErrorMessage(
      anonymous.action(api.aiConnections.createPendingCodex, {}),
      "Unauthenticated"
    );
    await expectErrorMessage(
      anonymous.action(api.aiConnections.getStatus, { connectionId }),
      "Unauthenticated"
    );
    await expectErrorMessage(
      anonymous.action(api.aiConnections.selectDefaultCodex, {
        connectionId,
      }),
      "Unauthenticated"
    );
  });
});
