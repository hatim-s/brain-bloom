import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

const LIFECYCLE_SNAPSHOT_REJECTED = "Lifecycle snapshot rejected";
const LIFECYCLE_TRANSITION_REJECTED = "Lifecycle transition rejected";
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_DISPLAY_LENGTH = 160;
const MAX_ERROR_CODE_LENGTH = 64;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const pendingState = v.object({ status: v.literal("pending") });
const connectedState = v.object({
  status: v.literal("connected"),
  gatewayCredentialId: v.string(),
  accountHint: v.optional(v.string()),
  planLabel: v.optional(v.string()),
  validatedAt: v.number(),
});
const errorState = v.object({
  status: v.literal("error"),
  gatewayCredentialId: v.optional(v.string()),
  accountHint: v.optional(v.string()),
  planLabel: v.optional(v.string()),
  validatedAt: v.number(),
  errorCode: v.string(),
});
const expiredState = v.object({
  status: v.literal("expired"),
  gatewayCredentialId: v.optional(v.string()),
  accountHint: v.optional(v.string()),
  planLabel: v.optional(v.string()),
  validatedAt: v.number(),
  errorCode: v.string(),
});
const revokingState = v.object({
  status: v.literal("revoking"),
  gatewayCredentialId: v.string(),
});
const revokedState = v.object({
  status: v.literal("revoked"),
  validatedAt: v.number(),
  errorCode: v.optional(v.string()),
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

type LifecycleState =
  | { status: "pending" }
  | {
      status: "connected";
      gatewayCredentialId: string;
      accountHint?: string;
      planLabel?: string;
      validatedAt: number;
    }
  | {
      status: "error" | "expired";
      gatewayCredentialId?: string;
      accountHint?: string;
      planLabel?: string;
      validatedAt: number;
      errorCode: string;
    }
  | {
      status: "revoking";
      gatewayCredentialId: string;
    }
  | {
      status: "revoked";
      validatedAt: number;
      errorCode?: string;
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
    pending: ["pending", "connected", "error", "expired", "revoking"],
    connected: ["connected", "error", "expired", "revoking"],
    error: ["error", "connected", "expired", "revoking"],
    expired: ["expired", "connected", "error", "revoking"],
    revoking: ["revoked"],
    revoked: ["deleted"],
    deleted: [],
  };

/** Detects display-unsafe ASCII controls without retaining provider text. */
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

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
  if (
    "gatewayCredentialId" in state &&
    state.gatewayCredentialId !== undefined
  ) {
    if (
      state.gatewayCredentialId.length < 1 ||
      state.gatewayCredentialId.length > MAX_IDENTIFIER_LENGTH ||
      !IDENTIFIER_PATTERN.test(state.gatewayCredentialId)
    ) {
      throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
    }
  }
  for (const displayValue of [
    "accountHint" in state ? state.accountHint : undefined,
    "planLabel" in state ? state.planLabel : undefined,
  ]) {
    if (
      displayValue !== undefined &&
      (displayValue.length < 1 ||
        displayValue.length > MAX_DISPLAY_LENGTH ||
        hasControlCharacters(displayValue))
    ) {
      throw new ConvexError(LIFECYCLE_SNAPSHOT_REJECTED);
    }
  }
  if ("errorCode" in state && state.errorCode !== undefined) {
    if (
      state.errorCode.length > MAX_ERROR_CODE_LENGTH ||
      !ERROR_CODE_PATTERN.test(state.errorCode)
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
    "gatewayCredentialId" in state ? (state.gatewayCredentialId ?? null) : null,
    "accountHint" in state ? (state.accountHint ?? null) : null,
    "planLabel" in state ? (state.planLabel ?? null) : null,
    "validatedAt" in state ? state.validatedAt : null,
    "errorCode" in state ? (state.errorCode ?? null) : null,
  ]);
}

/** Returns only provider-validated fields allowed by the target lifecycle state. */
function lifecyclePatch(state: LifecycleState): Partial<Doc<"aiConnections">> {
  switch (state.status) {
    case "pending":
      return {
        status: state.status,
        isDefault: false,
        gatewayCredentialId: undefined,
        accountHint: undefined,
        planLabel: undefined,
        lastValidationAt: undefined,
        lastErrorCode: undefined,
      };
    case "connected":
      return {
        status: state.status,
        gatewayCredentialId: state.gatewayCredentialId,
        accountHint: state.accountHint,
        planLabel: state.planLabel,
        lastValidationAt: state.validatedAt,
        lastErrorCode: undefined,
      };
    case "error":
    case "expired":
      return {
        status: state.status,
        isDefault: false,
        gatewayCredentialId: state.gatewayCredentialId,
        accountHint: state.accountHint,
        planLabel: state.planLabel,
        lastValidationAt: state.validatedAt,
        lastErrorCode: state.errorCode,
      };
    case "revoking":
      return {
        status: state.status,
        isDefault: false,
        gatewayCredentialId: state.gatewayCredentialId,
        accountHint: undefined,
        planLabel: undefined,
        lastValidationAt: undefined,
        lastErrorCode: undefined,
      };
    case "revoked":
      return {
        status: state.status,
        isDefault: false,
        gatewayCredentialId: undefined,
        accountHint: undefined,
        planLabel: undefined,
        lastValidationAt: state.validatedAt,
        lastErrorCode: state.errorCode,
      };
    case "deleted":
      return {
        status: state.status,
        isDefault: false,
        gatewayCredentialId: undefined,
        accountHint: undefined,
        planLabel: undefined,
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
