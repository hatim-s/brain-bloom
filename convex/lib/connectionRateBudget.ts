import { ConvexError } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const CONNECTION_RATE_LIMIT_EXCEEDED = "Connection rate limit exceeded";
const CONNECTION_RATE_LIMIT_UNAVAILABLE = "Connection rate limit unavailable";
const GLOBAL_SCOPE_KEY = "all";
const MAX_BUDGET_LIMIT = 10_000;
const MAX_WINDOW_MS = 86_400_000;

type ConnectionRateEndpoint =
  "createPendingCodex" | "selectDefaultCodex" | "list" | "getStatus";

type ConnectionRatePolicy = {
  windowMs: number;
  ownerLimit: number;
  globalLimit: number;
};

type ConnectionRatePolicySource = Record<
  ConnectionRateEndpoint,
  ConnectionRatePolicy
>;

type RateScope = "owner" | "global";
type RateBudgetContext = Pick<MutationCtx, "db">;

const CONNECTION_RATE_BUDGET_POLICIES = {
  createPendingCodex: {
    windowMs: 60_000,
    ownerLimit: 3,
    globalLimit: 20,
  },
  selectDefaultCodex: {
    windowMs: 60_000,
    ownerLimit: 10,
    globalLimit: 100,
  },
  list: { windowMs: 60_000, ownerLimit: 60, globalLimit: 1_000 },
  getStatus: { windowMs: 60_000, ownerLimit: 120, globalLimit: 2_000 },
} satisfies ConnectionRatePolicySource;

/** Returns true only for finite, bounded integer rate-policy values. */
function isValidPolicy(policy: unknown): policy is ConnectionRatePolicy {
  if (typeof policy !== "object" || policy === null) {
    return false;
  }

  const candidate = policy as Partial<ConnectionRatePolicy>;
  return (
    Number.isSafeInteger(candidate.windowMs) &&
    (candidate.windowMs ?? 0) > 0 &&
    (candidate.windowMs ?? 0) <= MAX_WINDOW_MS &&
    Number.isSafeInteger(candidate.ownerLimit) &&
    (candidate.ownerLimit ?? 0) > 0 &&
    (candidate.ownerLimit ?? 0) <= MAX_BUDGET_LIMIT &&
    Number.isSafeInteger(candidate.globalLimit) &&
    (candidate.globalLimit ?? 0) >= (candidate.ownerLimit ?? 0) &&
    (candidate.globalLimit ?? 0) <= MAX_BUDGET_LIMIT
  );
}

/** Resolves one endpoint policy from server-owned configuration or fails closed. */
function requirePolicy(
  endpoint: ConnectionRateEndpoint,
  policySource: unknown
): ConnectionRatePolicy {
  if (typeof policySource !== "object" || policySource === null) {
    throw new ConvexError(CONNECTION_RATE_LIMIT_UNAVAILABLE);
  }

  const policy = (policySource as Partial<ConnectionRatePolicySource>)[
    endpoint
  ];
  if (!isValidPolicy(policy)) {
    throw new ConvexError(CONNECTION_RATE_LIMIT_UNAVAILABLE);
  }

  return policy;
}

/** Validates persisted limiter state before it can influence authorization. */
function isValidBudgetState(
  budget: Doc<"aiConnectionRateBudgets">,
  now: number
): boolean {
  if (
    !Number.isSafeInteger(budget.windowStartedAt) ||
    budget.windowStartedAt < 0 ||
    budget.windowStartedAt > now ||
    !Number.isSafeInteger(budget.windowMs) ||
    budget.windowMs <= 0 ||
    budget.windowMs > MAX_WINDOW_MS ||
    !Number.isSafeInteger(budget.limit) ||
    budget.limit <= 0 ||
    budget.limit > MAX_BUDGET_LIMIT ||
    !Number.isSafeInteger(budget.consumed) ||
    budget.consumed <= 0 ||
    budget.consumed > budget.limit
  ) {
    return false;
  }

  return Number.isSafeInteger(budget.windowStartedAt + budget.windowMs);
}

/** Returns whether a valid persisted fixed window still contains this attempt. */
function isBudgetWindowActive(
  budget: Doc<"aiConnectionRateBudgets">,
  now: number
): boolean {
  return now < budget.windowStartedAt + budget.windowMs;
}

/** Loads exactly one persisted scope row, treating duplicates as unavailable state. */
async function loadBudget(
  ctx: RateBudgetContext,
  scope: RateScope,
  scopeKey: string,
  endpoint: ConnectionRateEndpoint
): Promise<Doc<"aiConnectionRateBudgets"> | null> {
  const budgets = await ctx.db
    .query("aiConnectionRateBudgets")
    .withIndex("by_scope_endpoint", (index) =>
      index.eq("scope", scope).eq("scopeKey", scopeKey).eq("endpoint", endpoint)
    )
    .take(2);

  if (budgets.length > 1) {
    throw new ConvexError(CONNECTION_RATE_LIMIT_UNAVAILABLE);
  }

  return budgets[0] ?? null;
}

/** Persists one consumption against a previously validated owner/global row. */
async function persistConsumption(
  ctx: RateBudgetContext,
  budget: Doc<"aiConnectionRateBudgets"> | null,
  scope: RateScope,
  scopeKey: string,
  endpoint: ConnectionRateEndpoint,
  now: number,
  policy: ConnectionRatePolicy,
  configuredLimit: number
): Promise<void> {
  if (budget !== null && isBudgetWindowActive(budget, now)) {
    const effectiveLimit = Math.min(budget.limit, configuredLimit);
    if (budget.consumed >= effectiveLimit) {
      throw new ConvexError(CONNECTION_RATE_LIMIT_EXCEEDED);
    }

    await ctx.db.patch(budget._id, { consumed: budget.consumed + 1 });
    return;
  }

  const windowStartedAt = Math.floor(now / policy.windowMs) * policy.windowMs;
  const nextState = {
    windowStartedAt,
    windowMs: policy.windowMs,
    limit: configuredLimit,
    consumed: 1,
  };

  if (budget === null) {
    await ctx.db.insert("aiConnectionRateBudgets", {
      scope,
      scopeKey,
      endpoint,
      ...nextState,
    });
    return;
  }

  await ctx.db.patch(budget._id, nextState);
}

/**
 * Atomically consumes persistent per-owner and global capacity for one endpoint.
 *
 * The helper never uses process memory. Any missing/malformed policy, duplicate
 * or malformed persisted state, or database enforcement failure becomes the
 * same stable fail-closed error. Tests may inject time and policy data without
 * exposing either value through a public Convex function.
 */
async function consumeConnectionRateBudget(
  ctx: RateBudgetContext,
  subject: string,
  endpoint: ConnectionRateEndpoint,
  now = Date.now(),
  policySource: unknown = CONNECTION_RATE_BUDGET_POLICIES
): Promise<void> {
  const policy = requirePolicy(endpoint, policySource);
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ConvexError(CONNECTION_RATE_LIMIT_UNAVAILABLE);
  }

  let ownerBudget: Doc<"aiConnectionRateBudgets"> | null;
  let globalBudget: Doc<"aiConnectionRateBudgets"> | null;

  try {
    [ownerBudget, globalBudget] = await Promise.all([
      loadBudget(ctx, "owner", subject, endpoint),
      loadBudget(ctx, "global", GLOBAL_SCOPE_KEY, endpoint),
    ]);
  } catch {
    throw new ConvexError(CONNECTION_RATE_LIMIT_UNAVAILABLE);
  }

  if (
    (ownerBudget !== null && !isValidBudgetState(ownerBudget, now)) ||
    (globalBudget !== null && !isValidBudgetState(globalBudget, now))
  ) {
    throw new ConvexError(CONNECTION_RATE_LIMIT_UNAVAILABLE);
  }

  // Check both capacities before either write. Convex then commits both scope
  // updates atomically and retries conflicting concurrent attempts.
  if (
    (ownerBudget !== null &&
      isBudgetWindowActive(ownerBudget, now) &&
      ownerBudget.consumed >= Math.min(ownerBudget.limit, policy.ownerLimit)) ||
    (globalBudget !== null &&
      isBudgetWindowActive(globalBudget, now) &&
      globalBudget.consumed >= Math.min(globalBudget.limit, policy.globalLimit))
  ) {
    throw new ConvexError(CONNECTION_RATE_LIMIT_EXCEEDED);
  }

  try {
    await Promise.all([
      persistConsumption(
        ctx,
        ownerBudget,
        "owner",
        subject,
        endpoint,
        now,
        policy,
        policy.ownerLimit
      ),
      persistConsumption(
        ctx,
        globalBudget,
        "global",
        GLOBAL_SCOPE_KEY,
        endpoint,
        now,
        policy,
        policy.globalLimit
      ),
    ]);
  } catch (error) {
    if (
      error instanceof ConvexError &&
      error.data === CONNECTION_RATE_LIMIT_EXCEEDED
    ) {
      throw error;
    }

    throw new ConvexError(CONNECTION_RATE_LIMIT_UNAVAILABLE);
  }
}

export {
  CONNECTION_RATE_BUDGET_POLICIES,
  CONNECTION_RATE_LIMIT_EXCEEDED,
  CONNECTION_RATE_LIMIT_UNAVAILABLE,
  consumeConnectionRateBudget,
};
export type { ConnectionRateEndpoint, ConnectionRatePolicySource };
