import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

const LIFECYCLE_SNAPSHOT_REJECTED = "Lifecycle snapshot rejected";
const LIFECYCLE_TRANSITION_REJECTED = "Lifecycle transition rejected";
const MAX_IDENTIFIER_LENGTH = 256;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const subscriptionPlan = v.union(
  v.literal("free"),
  v.literal("plus"),
  v.literal("pro"),
  v.literal("business"),
  v.literal("enterprise"),
  v.literal("edu")
);
const providerErrorCode = v.union(
  v.literal("PROVIDER_UNAVAILABLE"),
  v.literal("SESSION_EXPIRED"),
  v.literal("VALIDATION_FAILED"),
  v.literal("CREDENTIAL_REVOKED"),
  v.literal("CLEANUP_FAILED")
);
const initialCredentialBinding = v.object({
  gatewayCredentialId: v.string(),
  subscriptionAccountType: v.literal("chatgpt_subscription"),
  subscriptionPlan: v.optional(subscriptionPlan),
});

const pendingState = v.object({ status: v.literal("pending") });
const connectedState = v.object({
  status: v.literal("connected"),
  initialBinding: v.optional(initialCredentialBinding),
  validatedAt: v.number(),
});
const errorState = v.object({
  status: v.literal("error"),
  validatedAt: v.number(),
  errorCode: providerErrorCode,
});
const expiredState = v.object({
  status: v.literal("expired"),
  validatedAt: v.number(),
  errorCode: providerErrorCode,
});
const revokingState = v.object({ status: v.literal("revoking") });
const revokedState = v.object({
  status: v.literal("revoked"),
  validatedAt: v.number(),
  errorCode: v.optional(providerErrorCode),
});
const deletedState = v.object({
  status: v.literal("deleted"),
  validatedAt: v.number(),
});
const lifecycleState = v.union(
  pendingState,
  connectedState,
  errorState,
  expiredState,
  revokingState,
  revokedState,
  deletedState
);
const lifecycleSnapshot = v.object({
  version: v.number(),
  evidenceId: v.string(),
  requestId: v.string(),
  revision: v.number(),
  ownerId: v.string(),
  connectionId: v.string(),
  provider: v.string(),
  state: lifecycleState,
});

type SubscriptionPlan =
  "free" | "plus" | "pro" | "business" | "enterprise" | "edu";
type ProviderErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "SESSION_EXPIRED"
  | "VALIDATION_FAILED"
  | "CREDENTIAL_REVOKED"
  | "CLEANUP_FAILED";
type InitialCredentialBinding = {
  gatewayCredentialId: string;
  subscriptionAccountType: "chatgpt_subscription";
  subscriptionPlan?: SubscriptionPlan;
};
type LifecycleState =
  | { status: "pending" }
  | {
      status: "connected";
      initialBinding?: InitialCredentialBinding;
      validatedAt: number;
    }
  | {
      status: "error" | "expired";
      validatedAt: number;
      errorCode: ProviderErrorCode;
    }
  | { status: "revoking" }
  | {
      status: "revoked";
      validatedAt: number;
      errorCode?: ProviderErrorCode;
    }
  | { status: "deleted"; validatedAt: number };

type GatewayLifecycleSnapshot = {
  version: number;
  evidenceId: string;
  requestId: string;
  revision: number;
  ownerId: string;
  connectionId: string;
  provider: string;
  state: LifecycleState;
};

type LifecycleStatus = LifecycleState["status"];

const allowedTransitions: Record<LifecycleStatus, readonly LifecycleStatus[]> =
  {
    pending: ["connected", "error", "expired", "revoking"],
    connected: ["connected", "error", "expired", "revoking"],
    error: ["error", "connected", "expired", "revoking"],
    expired: ["expired", "connected", "error", "revoking"],
    revoking: ["revoked"],
    revoked: ["deleted"],
    deleted: [],
  };

/** Rejects values that could carry raw provider output or ambiguous identifiers. */
function requireSafeSnapshot(snapshot: GatewayLifecycleSnapshot): void {
  const identifiers = [
    snapshot.ownerId,
    snapshot.evidenceId,
    snapshot.requestId,
  ];

  if (
    snapshot.version !== 1 ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 1 ||
    identifiers.some(
      (value) =>
        value.length < 1 ||
        value.length > MAX_IDENTIFIER_LENGTH ||
        !IDENTIFIER_PATTERN.test(value)
    ) ||
    snapshot.provider !== "codex"
  ) {
    throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
  }

  const { state } = snapshot;
  if ("validatedAt" in state) {
    if (!Number.isSafeInteger(state.validatedAt) || state.validatedAt < 1) {
      throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
    }
  }
  if (state.status === "connected" && state.initialBinding !== undefined) {
    const { gatewayCredentialId } = state.initialBinding;
    if (
      gatewayCredentialId.length < 1 ||
      gatewayCredentialId.length > MAX_IDENTIFIER_LENGTH ||
      !IDENTIFIER_PATTERN.test(gatewayCredentialId)
    ) {
      throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
    }
  }
}

/** Normalizes the bound connection id without exposing storage validation details. */
function requireConnectionId(
  ctx: MutationCtx,
  rawConnectionId: string
): Id<"aiConnections"> {
  try {
    const connectionId = ctx.db.normalizeId("aiConnections", rawConnectionId);
    if (connectionId !== null) return connectionId;
  } catch {
    // Return the same stable error as every missing or mismatched binding.
  }

  throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
}

/** Produces a deterministic semantic fingerprint for exact duplicate detection. */
function fingerprintSnapshot(snapshot: GatewayLifecycleSnapshot): string {
  const state = snapshot.state;
  return JSON.stringify([
    snapshot.version,
    snapshot.evidenceId,
    snapshot.requestId,
    snapshot.revision,
    snapshot.ownerId,
    snapshot.connectionId,
    snapshot.provider,
    state.status,
    state.status === "connected"
      ? (state.initialBinding?.gatewayCredentialId ?? null)
      : null,
    state.status === "connected"
      ? (state.initialBinding?.subscriptionAccountType ?? null)
      : null,
    state.status === "connected"
      ? (state.initialBinding?.subscriptionPlan ?? null)
      : null,
    "validatedAt" in state ? state.validatedAt : null,
    "errorCode" in state ? (state.errorCode ?? null) : null,
  ]);
}

/** Rejects corrupt stored combinations before any transition can preserve them. */
function requireConsistentStoredBinding(
  connection: Doc<"aiConnections">
): void {
  const hasHandle = connection.gatewayCredentialId !== undefined;
  const hasAccountType = connection.subscriptionAccountType !== undefined;
  const hasPlan = connection.subscriptionPlan !== undefined;
  const hasCompleteDisplayBinding = hasHandle && hasAccountType;
  const isProviderState =
    connection.status === "pending" ||
    connection.status === "connected" ||
    connection.status === "error" ||
    connection.status === "expired";

  if (
    (isProviderState && hasHandle !== hasAccountType) ||
    (isProviderState && hasPlan && !hasCompleteDisplayBinding) ||
    (connection.status === "pending" &&
      (hasHandle || hasAccountType || hasPlan)) ||
    (connection.status === "connected" && !hasCompleteDisplayBinding) ||
    (connection.status === "revoking" && (hasAccountType || hasPlan)) ||
    ((connection.status === "revoked" || connection.status === "deleted") &&
      (hasHandle || hasAccountType || hasPlan))
  ) {
    throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
  }
}

/** Allows one globally unique opaque handle to be established exactly once. */
async function requireCredentialBindingTransition(
  ctx: MutationCtx,
  connection: Doc<"aiConnections">,
  state: LifecycleState
): Promise<void> {
  requireConsistentStoredBinding(connection);
  if (state.status !== "connected") return;

  if (connection.status === "pending") {
    const { initialBinding } = state;
    if (initialBinding === undefined) {
      throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
    }

    // The indexed read participates in the mutation transaction. Concurrent
    // claims on different rows therefore conflict on this shared range, and a
    // retry observes the winner before either duplicate binding can commit.
    const existingBinding = await ctx.db
      .query("aiConnections")
      .withIndex("by_gateway_credential", (query) =>
        query.eq("gatewayCredentialId", initialBinding.gatewayCredentialId)
      )
      .first();
    if (existingBinding !== null && existingBinding._id !== connection._id) {
      throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
    }
    return;
  }

  // Recovery and revalidation derive the existing binding from storage. An
  // echoed binding is rejected even when identical so it can never become an
  // alternate source of authority.
  if (
    state.initialBinding !== undefined ||
    connection.gatewayCredentialId === undefined ||
    connection.subscriptionAccountType !== "chatgpt_subscription"
  ) {
    throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
  }
}

/** Returns only provider-validated fields allowed by the target lifecycle state. */
function lifecyclePatch(state: LifecycleState): Partial<Doc<"aiConnections">> {
  switch (state.status) {
    case "pending":
      return {
        status: state.status,
        isDefault: false,
        gatewayCredentialId: undefined,
        subscriptionAccountType: undefined,
        subscriptionPlan: undefined,
        lastValidationAt: undefined,
        lastErrorCode: undefined,
      };
    case "connected":
      return {
        status: state.status,
        ...(state.initialBinding === undefined
          ? {}
          : {
              gatewayCredentialId: state.initialBinding.gatewayCredentialId,
              subscriptionAccountType:
                state.initialBinding.subscriptionAccountType,
              subscriptionPlan: state.initialBinding.subscriptionPlan,
            }),
        lastValidationAt: state.validatedAt,
        lastErrorCode: undefined,
      };
    case "error":
    case "expired":
      return {
        status: state.status,
        isDefault: false,
        lastValidationAt: state.validatedAt,
        lastErrorCode: state.errorCode,
      };
    case "revoking":
      return {
        status: state.status,
        isDefault: false,
        subscriptionAccountType: undefined,
        subscriptionPlan: undefined,
        lastValidationAt: undefined,
        lastErrorCode: undefined,
      };
    case "revoked":
      return {
        status: state.status,
        isDefault: false,
        gatewayCredentialId: undefined,
        subscriptionAccountType: undefined,
        subscriptionPlan: undefined,
        lastValidationAt: state.validatedAt,
        lastErrorCode: state.errorCode,
      };
    case "deleted":
      return {
        status: state.status,
        isDefault: false,
        gatewayCredentialId: undefined,
        subscriptionAccountType: undefined,
        subscriptionPlan: undefined,
        lastValidationAt: state.validatedAt,
        lastErrorCode: undefined,
      };
  }
}

/** Applies one already-authenticated gateway lifecycle snapshot transactionally. */
const reconcileGatewayLifecycle = internalMutation({
  args: { snapshot: lifecycleSnapshot },
  handler: async (ctx, { snapshot }) => {
    requireSafeSnapshot(snapshot);
    const connectionId = requireConnectionId(ctx, snapshot.connectionId);
    const fingerprint = fingerprintSnapshot(snapshot);
    const [evidenceReceipt, requestReceipt] = await Promise.all([
      ctx.db
        .query("aiConnectionLifecycleReceipts")
        .withIndex("by_evidence", (query) =>
          query.eq("evidenceId", snapshot.evidenceId)
        )
        .first(),
      ctx.db
        .query("aiConnectionLifecycleReceipts")
        .withIndex("by_request", (query) =>
          query.eq("requestId", snapshot.requestId)
        )
        .first(),
    ]);

    if (evidenceReceipt !== null || requestReceipt !== null) {
      const isExactDuplicate =
        evidenceReceipt !== null &&
        requestReceipt !== null &&
        evidenceReceipt._id === requestReceipt._id &&
        evidenceReceipt.fingerprint === fingerprint;

      if (!isExactDuplicate) {
        throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
      }

      return {
        connectionId: evidenceReceipt.connectionId,
        status: evidenceReceipt.status,
        revision: evidenceReceipt.revision,
        applied: false,
      };
    }

    const connection = await ctx.db.get("aiConnections", connectionId);
    if (
      connection === null ||
      connection.ownerId !== snapshot.ownerId ||
      connection.provider !== snapshot.provider
    ) {
      throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
    }

    const expectedRevision = (connection.lifecycleRevision ?? 0) + 1;
    if (snapshot.revision !== expectedRevision) {
      throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
    }
    if (
      !allowedTransitions[connection.status].includes(snapshot.state.status)
    ) {
      throw new ConvexError(LIFECYCLE_TRANSITION_REJECTED);
    }
    await requireCredentialBindingTransition(ctx, connection, snapshot.state);

    const appliedAt = Date.now();
    await ctx.db.insert("aiConnectionLifecycleReceipts", {
      connectionId,
      ownerId: snapshot.ownerId,
      provider: "codex",
      evidenceId: snapshot.evidenceId,
      requestId: snapshot.requestId,
      revision: snapshot.revision,
      version: 1,
      status: snapshot.state.status,
      fingerprint,
      appliedAt,
    });
    await ctx.db.patch(connectionId, {
      ...lifecyclePatch(snapshot.state),
      lifecycleVersion: 1,
      lifecycleRevision: snapshot.revision,
      updatedAt: appliedAt,
    });

    return {
      connectionId,
      status: snapshot.state.status,
      revision: snapshot.revision,
      applied: true,
    };
  },
});

export {
  type GatewayLifecycleSnapshot,
  type LifecycleState,
  reconcileGatewayLifecycle,
};
