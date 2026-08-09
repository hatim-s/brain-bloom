// @vitest-environment edge-runtime
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import type {
  GatewayLifecycleSnapshot,
  LifecycleState,
} from "./aiConnectionLifecycle";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts"]);
const reconcileGatewayLifecycle = makeFunctionReference<
  "mutation",
  { snapshot: GatewayLifecycleSnapshot },
  {
    connectionId: Id<"aiConnections">;
    status: LifecycleState["status"];
    revision: number;
    applied: boolean;
  }
>("aiConnectionLifecycle:reconcileGatewayLifecycle");
const listConnections = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown[]
>("aiConnections:list");
const getConnectionStatus = makeFunctionReference<
  "action",
  { connectionId: string },
  unknown
>("aiConnections:getStatus");

type Harness = ReturnType<typeof convexTest>;

/** Creates an isolated schema-aware lifecycle reconciliation harness. */
function createHarness(): Harness {
  return convexTest(schema, modules);
}

/** Seeds a server-owned Codex connection without exercising a public lifecycle path. */
async function seedConnection(
  t: Harness,
  ownerId = "user_alice",
  status: LifecycleState["status"] = "pending"
): Promise<Id<"aiConnections">> {
  const hasCredentialHandle =
    status === "connected" ||
    status === "error" ||
    status === "expired" ||
    status === "revoking";
  const hasSubscriptionDisplay =
    status === "connected" || status === "error" || status === "expired";

  return t.run((ctx) =>
    ctx.db.insert("aiConnections", {
      ownerId,
      provider: "codex",
      label: "Codex",
      status,
      authenticationMethod: "device_code",
      gatewayCredentialId: hasCredentialHandle
        ? `credential-${ownerId}`
        : undefined,
      subscriptionAccountType: hasSubscriptionDisplay
        ? "chatgpt_subscription"
        : undefined,
      subscriptionPlan: hasSubscriptionDisplay ? "plus" : undefined,
      isDefault: status === "connected",
      createdAt: 1,
      updatedAt: 1,
    })
  );
}

/** Builds one complete version-one snapshot with unique revision identifiers. */
function snapshot(
  connectionId: Id<"aiConnections">,
  revision: number,
  state: LifecycleState,
  overrides: Partial<
    Omit<GatewayLifecycleSnapshot, "connectionId" | "revision" | "state">
  > = {}
): GatewayLifecycleSnapshot {
  return {
    version: 1,
    evidenceId: `evidence-${revision}`,
    requestId: `request-${revision}`,
    revision,
    ownerId: "user_alice",
    connectionId,
    provider: "codex",
    state,
    ...overrides,
  };
}

const lifecycleStatuses: LifecycleState["status"][] = [
  "pending",
  "connected",
  "error",
  "expired",
  "revoking",
  "revoked",
  "deleted",
];
const allowedTransitionKeys = new Set([
  "pending->connected",
  "pending->error",
  "pending->expired",
  "pending->revoking",
  "connected->connected",
  "connected->error",
  "connected->expired",
  "connected->revoking",
  "error->error",
  "error->connected",
  "error->expired",
  "error->revoking",
  "expired->expired",
  "expired->connected",
  "expired->error",
  "expired->revoking",
  "revoking->revoked",
  "revoked->deleted",
]);
const transitionCases = lifecycleStatuses.flatMap((source) =>
  lifecycleStatuses.map((target) => ({
    source,
    target,
    allowed: allowedTransitionKeys.has(`${source}->${target}`),
  }))
);

/** Builds the closed provider fields required for one source/target pair. */
function stateForTransition(
  source: LifecycleState["status"],
  target: LifecycleState["status"]
): LifecycleState {
  switch (target) {
    case "pending":
      return { status: target };
    case "connected":
      return {
        status: target,
        ...(source === "pending"
          ? {
              initialBinding: {
                gatewayCredentialId: "credential-transition",
                subscriptionAccountType: "chatgpt_subscription" as const,
                subscriptionPlan: "plus" as const,
              },
            }
          : {}),
        validatedAt: 100,
      };
    case "error":
      return {
        status: target,
        validatedAt: 100,
        errorCode: "PROVIDER_UNAVAILABLE",
      };
    case "expired":
      return {
        status: target,
        validatedAt: 100,
        errorCode: "SESSION_EXPIRED",
      };
    case "revoking":
      return { status: target };
    case "revoked":
      return { status: target, validatedAt: 100 };
    case "deleted":
      return { status: target, validatedAt: 100 };
  }
}

/** Builds the only snapshot shape permitted to establish a credential handle. */
function initialConnectedState(
  gatewayCredentialId = "credential-alice"
): LifecycleState {
  return {
    status: "connected",
    initialBinding: {
      gatewayCredentialId,
      subscriptionAccountType: "chatgpt_subscription",
      subscriptionPlan: "plus",
    },
    validatedAt: 100,
  };
}

/** Requires a complete stable error instead of accepting an oracle-prone substring. */
async function expectErrorMessage(
  promise: Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );

  expect(error).toBeInstanceOf(Error);
  if (error instanceof Error) expect(error.message).toBe(expectedMessage);
}

describe("gateway lifecycle reconciliation", () => {
  it("connects a pending record and keeps reconciliation identifiers private", async () => {
    const t = createHarness();
    const connectionId = await seedConnection(t);
    const result = await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(connectionId, 1, initialConnectedState()),
    });
    const stored = await t.run((ctx) => ctx.db.get(connectionId));
    const receipts = await t.run((ctx) =>
      ctx.db.query("aiConnectionLifecycleReceipts").collect()
    );

    expect(result).toEqual({
      connectionId,
      status: "connected",
      revision: 1,
      applied: true,
    });
    expect(stored).toMatchObject({
      ownerId: "user_alice",
      provider: "codex",
      status: "connected",
      gatewayCredentialId: "credential-alice",
      subscriptionAccountType: "chatgpt_subscription",
      subscriptionPlan: "plus",
      lastValidationAt: 100,
      lifecycleVersion: 1,
      lifecycleRevision: 1,
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      connectionId,
      ownerId: "user_alice",
      evidenceId: "evidence-1",
      requestId: "request-1",
      revision: 1,
    });

    const projection = await t
      .withIdentity({ subject: "user_alice" })
      .action(listConnections, {});
    expect(projection[0]).toMatchObject({
      subscriptionAccountType: "chatgpt_subscription",
      subscriptionPlan: "plus",
    });
    expect(projection[0]).not.toHaveProperty("accountHint");
    expect(projection[0]).not.toHaveProperty("planLabel");
    expect(projection[0]).not.toHaveProperty("ownerId");
    expect(projection[0]).not.toHaveProperty("gatewayCredentialId");
    expect(projection[0]).not.toHaveProperty("lifecycleVersion");
    expect(projection[0]).not.toHaveProperty("lifecycleRevision");
    expect(projection[0]).not.toHaveProperty("evidenceId");
    expect(projection[0]).not.toHaveProperty("requestId");
  });

  it("treats an exact evidence and request duplicate as a durable no-op", async () => {
    const t = createHarness();
    const connectionId = await seedConnection(t);
    const args = {
      snapshot: snapshot(connectionId, 1, initialConnectedState()),
    };

    const first = await t.mutation(reconcileGatewayLifecycle, args);
    const storedAfterFirst = await t.run((ctx) => ctx.db.get(connectionId));
    const duplicate = await t.mutation(reconcileGatewayLifecycle, args);
    const storedAfterDuplicate = await t.run((ctx) => ctx.db.get(connectionId));

    expect(first.applied).toBe(true);
    expect(duplicate).toEqual({ ...first, applied: false });
    expect(storedAfterDuplicate).toEqual(storedAfterFirst);
    expect(
      await t.run((ctx) =>
        ctx.db.query("aiConnectionLifecycleReceipts").collect()
      )
    ).toHaveLength(1);
  });

  it.each([
    {
      label: "evidence id",
      overrides: { evidenceId: "evidence-1", requestId: "request-new" },
    },
    {
      label: "request id",
      overrides: { evidenceId: "evidence-new", requestId: "request-1" },
    },
  ])("rejects conflicting reuse of a prior $label", async ({ overrides }) => {
    const t = createHarness();
    const connectionId = await seedConnection(t);
    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(connectionId, 1, initialConnectedState()),
    });

    await expectErrorMessage(
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(
          connectionId,
          2,
          {
            status: "error",
            validatedAt: 200,
            errorCode: "PROVIDER_UNAVAILABLE",
          },
          overrides
        ),
      }),
      "Lifecycle snapshot rejected"
    );
    expect((await t.run((ctx) => ctx.db.get(connectionId)))?.status).toBe(
      "connected"
    );
  });

  it("rejects stale and skipped revisions without writing receipts", async () => {
    const t = createHarness();
    const connectionId = await seedConnection(t);

    await expectErrorMessage(
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(connectionId, 2, {
          status: "error",
          validatedAt: 200,
          errorCode: "PROVIDER_UNAVAILABLE",
        }),
      }),
      "Lifecycle snapshot rejected"
    );
    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(connectionId, 1, initialConnectedState()),
    });
    await expectErrorMessage(
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(
          connectionId,
          1,
          {
            status: "error",
            validatedAt: 200,
            errorCode: "PROVIDER_UNAVAILABLE",
          },
          { evidenceId: "evidence-stale", requestId: "request-stale" }
        ),
      }),
      "Lifecycle snapshot rejected"
    );
    await expectErrorMessage(
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(
          connectionId,
          3,
          {
            status: "error",
            validatedAt: 300,
            errorCode: "PROVIDER_UNAVAILABLE",
          },
          { evidenceId: "evidence-skipped", requestId: "request-skipped" }
        ),
      }),
      "Lifecycle snapshot rejected"
    );
    expect(
      await t.run((ctx) =>
        ctx.db.query("aiConnectionLifecycleReceipts").collect()
      )
    ).toHaveLength(1);
  });

  it.each([
    { label: "another owner", override: { ownerId: "user_bob" } },
    { label: "another provider", override: { provider: "claude" } },
  ])("rejects evidence bound to $label", async ({ override }) => {
    const t = createHarness();
    const connectionId = await seedConnection(t);

    await expectErrorMessage(
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(connectionId, 1, initialConnectedState(), override),
      }),
      "Lifecycle snapshot rejected"
    );
  });

  it("rejects a cross-connection binding without disclosing either owner", async () => {
    const t = createHarness();
    const aliceConnection = await seedConnection(t);
    const bobConnection = await seedConnection(t, "user_bob");

    await expectErrorMessage(
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(bobConnection, 1, initialConnectedState()),
      }),
      "Lifecycle snapshot rejected"
    );
    expect((await t.run((ctx) => ctx.db.get(aliceConnection)))?.status).toBe(
      "pending"
    );
    expect((await t.run((ctx) => ctx.db.get(bobConnection)))?.status).toBe(
      "pending"
    );
  });

  it("retains one immutable handle through failure, recovery, and cleanup", async () => {
    const t = createHarness();
    const connectionId = await seedConnection(t);

    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(
        connectionId,
        1,
        initialConnectedState("credential-immutable")
      ),
    });
    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(connectionId, 2, {
        status: "error",
        validatedAt: 200,
        errorCode: "PROVIDER_UNAVAILABLE",
      }),
    });
    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(connectionId, 3, {
        status: "expired",
        validatedAt: 300,
        errorCode: "SESSION_EXPIRED",
      }),
    });
    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(connectionId, 4, {
        status: "connected",
        validatedAt: 400,
      }),
    });
    const recovered = await t.run((ctx) => ctx.db.get(connectionId));
    expect(recovered).toMatchObject({
      status: "connected",
      gatewayCredentialId: "credential-immutable",
      subscriptionAccountType: "chatgpt_subscription",
      subscriptionPlan: "plus",
      lifecycleRevision: 4,
    });

    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(connectionId, 5, { status: "revoking" }),
    });
    const revoking = await t.run((ctx) => ctx.db.get(connectionId));
    expect(revoking?.gatewayCredentialId).toBe("credential-immutable");
    expect(revoking?.subscriptionAccountType).toBeUndefined();
    expect(revoking?.subscriptionPlan).toBeUndefined();

    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(connectionId, 6, {
        status: "revoked",
        validatedAt: 600,
      }),
    });
    expect(
      (await t.run((ctx) => ctx.db.get(connectionId)))?.gatewayCredentialId
    ).toBeUndefined();
  });

  it.each(["credential-other", "credential-user_bob"])(
    "rejects later connected evidence that tries to rebind %s",
    async (gatewayCredentialId) => {
      const t = createHarness();
      const connectionId = await seedConnection(t, "user_alice", "connected");

      await expectErrorMessage(
        t.mutation(reconcileGatewayLifecycle, {
          snapshot: snapshot(connectionId, 1, {
            status: "connected",
            initialBinding: {
              gatewayCredentialId,
              subscriptionAccountType: "chatgpt_subscription",
              subscriptionPlan: "plus",
            },
            validatedAt: 100,
          }),
        }),
        "Lifecycle snapshot rejected"
      );
      expect(
        (await t.run((ctx) => ctx.db.get(connectionId)))?.gatewayCredentialId
      ).toBe("credential-user_alice");
      expect(
        await t.run((ctx) =>
          ctx.db.query("aiConnectionLifecycleReceipts").collect()
        )
      ).toEqual([]);
    }
  );

  it.each([
    { status: "error", injectedHandle: "credential-other" },
    { status: "expired", injectedHandle: null },
    { status: "revoking", injectedHandle: "credential-user_bob" },
  ] as const)(
    "rejects $status evidence that injects or clears the stored handle",
    async ({ status, injectedHandle }) => {
      const t = createHarness();
      const connectionId = await seedConnection(t, "user_alice", "connected");
      const state =
        status === "revoking"
          ? { status, gatewayCredentialId: injectedHandle }
          : {
              status,
              gatewayCredentialId: injectedHandle,
              validatedAt: 100,
              errorCode:
                status === "error" ? "PROVIDER_UNAVAILABLE" : "SESSION_EXPIRED",
            };

      await expect(
        t.mutation(reconcileGatewayLifecycle, {
          snapshot: snapshot(connectionId, 1, state as never),
        })
      ).rejects.toThrow();
      expect(
        (await t.run((ctx) => ctx.db.get(connectionId)))?.gatewayCredentialId
      ).toBe("credential-user_alice");
      expect(
        await t.run((ctx) =>
          ctx.db.query("aiConnectionLifecycleReceipts").collect()
        )
      ).toEqual([]);
    }
  );

  it.each(transitionCases)(
    "enforces transition $source -> $target (allowed: $allowed)",
    async ({ source, target, allowed }) => {
      const t = createHarness();
      const connectionId = await seedConnection(t, "user_alice", source);
      const reconciliation = t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(connectionId, 1, stateForTransition(source, target)),
      });

      if (!allowed) {
        await expectErrorMessage(
          reconciliation,
          "Lifecycle transition rejected"
        );
        expect(
          await t.run((ctx) =>
            ctx.db.query("aiConnectionLifecycleReceipts").collect()
          )
        ).toEqual([]);
        expect((await t.run((ctx) => ctx.db.get(connectionId)))?.status).toBe(
          source
        );
        return;
      }

      await expect(reconciliation).resolves.toMatchObject({
        connectionId,
        status: target,
        revision: 1,
        applied: true,
      });
      const stored = await t.run((ctx) => ctx.db.get(connectionId));
      expect(stored?.status).toBe(target);
      expect(stored?.lifecycleRevision).toBe(1);
      expect(
        await t.run((ctx) =>
          ctx.db.query("aiConnectionLifecycleReceipts").collect()
        )
      ).toHaveLength(1);
    }
  );

  it("allows de-allowlisted cleanup to finish but never reactivate", async () => {
    const t = createHarness();
    const connectionId = await seedConnection(t, "user_removed", "connected");
    await t.run((ctx) =>
      ctx.db.patch(connectionId, {
        gatewayCredentialId: "credential-removed",
        subscriptionAccountType: "chatgpt_subscription",
        subscriptionPlan: "enterprise",
        lastValidationAt: 50,
        lastErrorCode: "VALIDATION_FAILED",
      })
    );

    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(
        connectionId,
        1,
        { status: "revoking" },
        { ownerId: "user_removed" }
      ),
    });
    const revoking = await t.run((ctx) => ctx.db.get(connectionId));
    expect(revoking).toMatchObject({
      status: "revoking",
      gatewayCredentialId: "credential-removed",
      isDefault: false,
    });
    expect(revoking?.subscriptionAccountType).toBeUndefined();
    expect(revoking?.subscriptionPlan).toBeUndefined();
    expect(revoking?.lastValidationAt).toBeUndefined();
    expect(revoking?.lastErrorCode).toBeUndefined();

    const projection = await t
      .withIdentity({ subject: "user_removed" })
      .action(listConnections, {});
    expect(projection[0]).toMatchObject({ status: "revoking" });
    expect(projection[0]).not.toHaveProperty("gatewayCredentialId");
    expect(projection[0]).not.toHaveProperty("subscriptionAccountType");
    expect(projection[0]).not.toHaveProperty("subscriptionPlan");
    expect(projection[0]).not.toHaveProperty("lastValidationAt");
    expect(projection[0]).not.toHaveProperty("lastErrorCode");

    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(
        connectionId,
        2,
        { status: "revoked", validatedAt: 200 },
        { ownerId: "user_removed" }
      ),
    });
    expect(
      (await t.run((ctx) => ctx.db.get(connectionId)))?.gatewayCredentialId
    ).toBeUndefined();
    await t.mutation(reconcileGatewayLifecycle, {
      snapshot: snapshot(
        connectionId,
        3,
        { status: "deleted", validatedAt: 300 },
        { ownerId: "user_removed" }
      ),
    });
    const tombstone = await t.run((ctx) => ctx.db.get(connectionId));
    expect(tombstone).toMatchObject({
      status: "deleted",
      isDefault: false,
      lifecycleRevision: 3,
    });
    expect(tombstone?.gatewayCredentialId).toBeUndefined();

    await expectErrorMessage(
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(
          connectionId,
          4,
          {
            status: "connected",
            validatedAt: 400,
          },
          { ownerId: "user_removed" }
        ),
      }),
      "Lifecycle transition rejected"
    );
    expect((await t.run((ctx) => ctx.db.get(connectionId)))?.status).toBe(
      "deleted"
    );
  });

  it("serializes concurrent first revisions so only one can advance", async () => {
    const t = createHarness();
    const connectionId = await seedConnection(t);
    const outcomes = await Promise.allSettled([
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(
          connectionId,
          1,
          initialConnectedState("credential-first")
        ),
      }),
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: snapshot(
          connectionId,
          1,
          {
            status: "error",
            validatedAt: 100,
            errorCode: "PROVIDER_UNAVAILABLE",
          },
          { evidenceId: "evidence-race", requestId: "request-race" }
        ),
      }),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected")
    ).toHaveLength(1);
    expect(
      await t.run((ctx) =>
        ctx.db.query("aiConnectionLifecycleReceipts").collect()
      )
    ).toHaveLength(1);
    expect(
      (await t.run((ctx) => ctx.db.get(connectionId)))?.lifecycleRevision
    ).toBe(1);
  });

  it.each([
    {
      label: "unsupported version",
      mutate: (candidate: GatewayLifecycleSnapshot) => ({
        ...candidate,
        version: 2,
      }),
    },
    {
      label: "unsafe evidence id",
      mutate: (candidate: GatewayLifecycleSnapshot) => ({
        ...candidate,
        evidenceId: "provider output\nsecret",
      }),
    },
    {
      label: "non-integer validation timestamp",
      mutate: (candidate: GatewayLifecycleSnapshot) => ({
        ...candidate,
        state: { ...candidate.state, validatedAt: 1.5 },
      }),
    },
  ])("rejects a $label with the stable snapshot error", async (testCase) => {
    const t = createHarness();
    const connectionId = await seedConnection(t);
    const candidate = snapshot(connectionId, 1, initialConnectedState());

    await expectErrorMessage(
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: testCase.mutate(candidate) as GatewayLifecycleSnapshot,
      }),
      "Lifecycle snapshot rejected"
    );
  });

  it.each(["provider said token=secret", "TOKEN_SECRET", "OPENAI_API_KEY"])(
    "rejects non-enumerated provider error code %s",
    async (errorCode) => {
      const t = createHarness();
      const connectionId = await seedConnection(t, "user_alice", "connected");

      await expect(
        t.mutation(reconcileGatewayLifecycle, {
          snapshot: snapshot(connectionId, 1, {
            status: "error",
            validatedAt: 100,
            errorCode,
          } as never),
        })
      ).rejects.toThrow();
      expect(
        await t.run((ctx) =>
          ctx.db.query("aiConnectionLifecycleReceipts").collect()
        )
      ).toEqual([]);
    }
  );

  it.each([
    "sk-secret-must-never-cross-browser-boundary",
    "Bearer eyJhbGciOiJIUzI1NiJ9.secret",
    "password=hunter2",
    "token=credential",
    "/Users/alice/.codex/auth.json",
    "OPENAI_API_KEY=secret",
    "plus\nsecret",
    "https://credential.example/token",
    "рro",
    "\u0000secret",
  ])("rejects and never projects subscription canary %s", async (canary) => {
    const t = createHarness();
    const connectionId = await seedConnection(t);
    const candidate = snapshot(connectionId, 1, {
      status: "connected",
      initialBinding: {
        gatewayCredentialId: "credential-alice",
        subscriptionAccountType: "chatgpt_subscription",
        subscriptionPlan: canary,
      },
      validatedAt: 100,
    } as never);

    await expect(
      t.mutation(reconcileGatewayLifecycle, { snapshot: candidate })
    ).rejects.toThrow();
    const stored = await t.run((ctx) => ctx.db.get(connectionId));
    expect(stored?.gatewayCredentialId).toBeUndefined();
    expect(stored?.subscriptionAccountType).toBeUndefined();
    expect(stored?.subscriptionPlan).toBeUndefined();

    const owner = t.withIdentity({ subject: "user_alice" });
    const listed = await owner.action(listConnections, {});
    const status = await owner.action(getConnectionStatus, { connectionId });
    expect(JSON.stringify({ listed, status })).not.toContain(canary);
    for (const projection of [listed[0], status]) {
      expect(projection).not.toHaveProperty("subscriptionAccountType");
      expect(projection).not.toHaveProperty("subscriptionPlan");
    }
    expect(listed[0]).not.toHaveProperty("accountHint");
    expect(listed[0]).not.toHaveProperty("planLabel");
    expect(
      await t.run((ctx) =>
        ctx.db.query("aiConnectionLifecycleReceipts").collect()
      )
    ).toEqual([]);
  });

  it("enforces a closed status-specific input schema", async () => {
    const t = createHarness();
    const connectionId = await seedConnection(t);
    const candidate = snapshot(connectionId, 1, {
      status: "deleted",
      validatedAt: 100,
    });

    await expect(
      t.mutation(reconcileGatewayLifecycle, {
        snapshot: {
          ...candidate,
          state: {
            ...candidate.state,
            gatewayCredentialId: "credential-smuggled",
          },
        } as never,
      })
    ).rejects.toThrow();
    expect(
      await t.run((ctx) =>
        ctx.db.query("aiConnectionLifecycleReceipts").collect()
      )
    ).toEqual([]);
  });
});
