// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  CONNECTION_RATE_BUDGET_POLICIES,
  consumeConnectionRateBudget,
} from "./lib/connectionRateBudget";
import { PERSONAL_BETA_SUBJECTS_ENV } from "./lib/personalBeta";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts"]);

type RateEndpoint = Doc<"aiConnectionRateBudgets">["endpoint"];

/** Creates an isolated Convex harness for rate-budget tests. */
function createHarness() {
  return convexTest(schema, modules);
}

type Harness = ReturnType<typeof createHarness>;

/** Requires the complete stable application error message. */
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

/** Reads the single logical budget row for one scope and endpoint. */
async function getBudget(
  t: Harness,
  scope: "owner" | "global",
  scopeKey: string,
  endpoint: RateEndpoint
): Promise<Doc<"aiConnectionRateBudgets"> | null> {
  return t.run((ctx) =>
    ctx.db
      .query("aiConnectionRateBudgets")
      .withIndex("by_scope_endpoint", (index) =>
        index
          .eq("scope", scope)
          .eq("scopeKey", scopeKey)
          .eq("endpoint", endpoint)
      )
      .unique()
  );
}

/** Seeds a connected Codex row as if gateway reconciliation had succeeded. */
async function seedConnectedConnection(
  t: Harness,
  ownerId: string
): Promise<Id<"aiConnections">> {
  return t.run((ctx) =>
    ctx.db.insert("aiConnections", {
      ownerId,
      provider: "codex",
      label: "Codex",
      status: "connected",
      authenticationMethod: "device_code",
      gatewayCredentialId: `gateway-${ownerId}`,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1,
    })
  );
}

beforeEach(() => {
  vi.stubEnv(PERSONAL_BETA_SUBJECTS_ENV, "user_alice,user_bob");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("connection rate budgets", () => {
  it("charges allowlist rejections and enforces the per-owner create budget", async () => {
    const t = createHarness();
    const asAlice = t.withIdentity({ subject: "user_alice" });
    vi.stubEnv(PERSONAL_BETA_SUBJECTS_ENV, "user_bob");

    for (
      let attempt = 0;
      attempt < CONNECTION_RATE_BUDGET_POLICIES.createPendingCodex.ownerLimit;
      attempt += 1
    ) {
      await expectErrorMessage(
        asAlice.action(api.aiConnections.createPendingCodex, {}),
        "Personal beta access unavailable"
      );
    }

    await expectErrorMessage(
      asAlice.action(api.aiConnections.createPendingCodex, {}),
      "Connection rate limit exceeded"
    );
    expect(
      await getBudget(t, "owner", "user_alice", "createPendingCodex")
    ).toMatchObject({
      consumed: CONNECTION_RATE_BUDGET_POLICIES.createPendingCodex.ownerLimit,
    });
  });

  it("enforces the global create budget across distinct authenticated owners", async () => {
    const t = createHarness();
    const globalLimit =
      CONNECTION_RATE_BUDGET_POLICIES.createPendingCodex.globalLimit;

    for (let attempt = 0; attempt < globalLimit; attempt += 1) {
      const owner = t.withIdentity({ subject: `global-owner-${attempt}` });
      await expectErrorMessage(
        owner.action(api.aiConnections.createPendingCodex, {
          ownerId: "client-supplied",
        } as never),
        "Invalid connection request"
      );
    }

    const overflowOwner = t.withIdentity({ subject: "global-owner-overflow" });
    await expectErrorMessage(
      overflowOwner.action(api.aiConnections.createPendingCodex, {
        ownerId: "client-supplied",
      } as never),
      "Connection rate limit exceeded"
    );
    expect(
      await getBudget(t, "global", "all", "createPendingCodex")
    ).toMatchObject({ consumed: globalLimit });
  });

  it("charges cross-owner selection probes before ownership rejection", async () => {
    const t = createHarness();
    const asAlice = t.withIdentity({ subject: "user_alice" });
    const bobConnection = await seedConnectedConnection(t, "user_bob");
    const ownerLimit =
      CONNECTION_RATE_BUDGET_POLICIES.selectDefaultCodex.ownerLimit;

    for (let attempt = 0; attempt < ownerLimit; attempt += 1) {
      await expectErrorMessage(
        asAlice.action(api.aiConnections.selectDefaultCodex, {
          connectionId: bobConnection,
        }),
        "Connection unavailable"
      );
    }

    await expectErrorMessage(
      asAlice.action(api.aiConnections.selectDefaultCodex, {
        connectionId: bobConnection,
      }),
      "Connection rate limit exceeded"
    );
  });

  it("resets an expired persisted window before charging the next attempt", async () => {
    const t = createHarness();
    const asAlice = t.withIdentity({ subject: "user_alice" });
    await t.run((ctx) =>
      ctx.db.insert("aiConnectionRateBudgets", {
        scope: "owner",
        scopeKey: "user_alice",
        endpoint: "createPendingCodex",
        windowStartedAt: 0,
        windowMs: 1,
        limit: 1,
        consumed: 1,
      })
    );

    await expectErrorMessage(
      asAlice.action(api.aiConnections.createPendingCodex, {
        provider: "claude",
      } as never),
      "Invalid connection request"
    );

    const reset = await getBudget(
      t,
      "owner",
      "user_alice",
      "createPendingCodex"
    );
    expect(reset).toMatchObject({
      consumed: 1,
      limit: CONNECTION_RATE_BUDGET_POLICIES.createPendingCodex.ownerLimit,
      windowMs: CONNECTION_RATE_BUDGET_POLICIES.createPendingCodex.windowMs,
    });
    expect(reset?.windowStartedAt).toBeGreaterThan(0);
  });

  it.each([
    { consumed: -1, label: "malformed" },
    { consumed: 4, label: "over-limit" },
  ])(
    "fails closed for $label persisted limiter state",
    async ({ consumed }) => {
      const t = createHarness();
      const asAlice = t.withIdentity({ subject: "user_alice" });
      await t.run((ctx) =>
        ctx.db.insert("aiConnectionRateBudgets", {
          scope: "owner",
          scopeKey: "user_alice",
          endpoint: "createPendingCodex",
          windowStartedAt: Date.now() - 1,
          windowMs: 60_000,
          limit: 3,
          consumed,
        })
      );

      await expectErrorMessage(
        asAlice.action(api.aiConnections.createPendingCodex, {}),
        "Connection rate limit unavailable"
      );
    }
  );

  it("fails closed when duplicate persistent scope rows make enforcement ambiguous", async () => {
    const t = createHarness();
    const asAlice = t.withIdentity({ subject: "user_alice" });

    await t.run(async (ctx) => {
      const row = {
        scope: "owner" as const,
        scopeKey: "user_alice",
        endpoint: "createPendingCodex" as const,
        windowStartedAt: Date.now() - 1,
        windowMs: 60_000,
        limit: 3,
        consumed: 1,
      };
      await ctx.db.insert("aiConnectionRateBudgets", row);
      await ctx.db.insert("aiConnectionRateBudgets", row);
    });

    await expectErrorMessage(
      asAlice.action(api.aiConnections.createPendingCodex, {}),
      "Connection rate limit unavailable"
    );
  });

  it.each([null, {}, { createPendingCodex: { windowMs: 0 } }])(
    "fails closed for unavailable or malformed policy configuration",
    async (policySource) => {
      const t = createHarness();

      await expectErrorMessage(
        t.run((ctx) =>
          consumeConnectionRateBudget(
            ctx,
            "user_alice",
            "createPendingCodex",
            60_000,
            policySource
          )
        ),
        "Connection rate limit unavailable"
      );
    }
  );

  it("persistently charges safe list and status reads without requiring allowlist access", async () => {
    const t = createHarness();
    const asAlice = t.withIdentity({ subject: "user_alice" });
    const connectionId = await seedConnectedConnection(t, "user_alice");
    vi.stubEnv(PERSONAL_BETA_SUBJECTS_ENV, "user_bob");

    await asAlice.action(api.aiConnections.list, {});
    await asAlice.action(api.aiConnections.getStatus, { connectionId });

    expect(await getBudget(t, "owner", "user_alice", "list")).toMatchObject({
      consumed: 1,
    });
    expect(
      await getBudget(t, "owner", "user_alice", "getStatus")
    ).toMatchObject({ consumed: 1 });
  });
});
