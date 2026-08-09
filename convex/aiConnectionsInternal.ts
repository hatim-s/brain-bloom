import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";

const CONNECTION_ALREADY_PENDING = "Connection already pending";
const CONNECTION_UNAVAILABLE = "Connection unavailable";
const INVALID_CONNECTION_REQUEST = "Invalid connection request";

type ConnectionContext = MutationCtx | QueryCtx;
type SafeConnection = Omit<
  Doc<"aiConnections">,
  "ownerId" | "gatewayCredentialId" | "lifecycleRevision" | "lifecycleVersion"
>;

/** Removes owner and gateway-only identifiers from an owner-facing connection. */
function toSafeConnection(connection: Doc<"aiConnections">): SafeConnection {
  return {
    _id: connection._id,
    _creationTime: connection._creationTime,
    provider: connection.provider,
    label: connection.label,
    status: connection.status,
    authenticationMethod: connection.authenticationMethod,
    subscriptionAccountType: connection.subscriptionAccountType,
    subscriptionPlan: connection.subscriptionPlan,
    isDefault: connection.isDefault,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    lastValidationAt: connection.lastValidationAt,
    lastErrorCode: connection.lastErrorCode,
  };
}

/** Normalizes an untrusted string without exposing Convex's validator details. */
function requireConnectionId(
  ctx: ConnectionContext,
  connectionId: string
): Id<"aiConnections"> {
  try {
    const normalized = ctx.db.normalizeId("aiConnections", connectionId);
    if (normalized !== null) {
      return normalized;
    }
  } catch {
    // Normalize storage/runtime validation failures to the stable public code.
  }

  throw new ConvexError(INVALID_CONNECTION_REQUEST);
}

/** Loads an owned connection without revealing whether another owner's id exists. */
async function getOwnedConnection(
  ctx: ConnectionContext,
  connectionId: Id<"aiConnections">,
  subject: string
): Promise<Doc<"aiConnections">> {
  const connection = await ctx.db.get("aiConnections", connectionId);

  if (connection === null || connection.ownerId !== subject) {
    throw new ConvexError(CONNECTION_UNAVAILABLE);
  }

  return connection;
}

/** Returns secret-free metadata for one server-asserted owner. */
const listOwned = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, { subject }) => {
    const connections = await ctx.db
      .query("aiConnections")
      .withIndex("by_owner", (index) => index.eq("ownerId", subject))
      .order("desc")
      .collect();

    return connections.map(toSafeConnection);
  },
});

/** Returns safe status only when a server-asserted owner owns the connection. */
const getOwnedStatus = internalQuery({
  args: { subject: v.string(), connectionId: v.string() },
  handler: async (ctx, { subject, connectionId: rawConnectionId }) => {
    const connectionId = requireConnectionId(ctx, rawConnectionId);
    const connection = await getOwnedConnection(ctx, connectionId, subject);

    return toSafeConnection(connection);
  },
});

/** Creates one server-derived pending Codex record per owner at a time. */
const createPendingCodexOwned = internalMutation({
  args: { subject: v.string() },
  handler: async (ctx, { subject }) => {
    const existingPending = await ctx.db
      .query("aiConnections")
      .withIndex("by_owner_provider_status", (index) =>
        index
          .eq("ownerId", subject)
          .eq("provider", "codex")
          .eq("status", "pending")
      )
      .first();

    if (existingPending !== null) {
      throw new ConvexError(CONNECTION_ALREADY_PENDING);
    }

    const now = Date.now();
    const connectionId = await ctx.db.insert("aiConnections", {
      ownerId: subject,
      provider: "codex",
      label: "Codex",
      status: "pending",
      authenticationMethod: "device_code",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    return { connectionId };
  },
});

/** Atomically makes one connected Codex record the server-asserted owner's sole default. */
const selectDefaultCodexOwned = internalMutation({
  args: { subject: v.string(), connectionId: v.string() },
  handler: async (ctx, { subject, connectionId: rawConnectionId }) => {
    const connectionId = requireConnectionId(ctx, rawConnectionId);
    const selected = await getOwnedConnection(ctx, connectionId, subject);

    if (selected.provider !== "codex" || selected.status !== "connected") {
      throw new ConvexError(CONNECTION_UNAVAILABLE);
    }

    const connections = await ctx.db
      .query("aiConnections")
      .withIndex("by_owner", (index) => index.eq("ownerId", subject))
      .collect();
    const now = Date.now();

    // Convex mutations are transactional, so clearing stale duplicate defaults
    // and selecting the target cannot expose an intermediate state.
    await Promise.all(
      connections.map((connection) => {
        const shouldBeDefault = connection._id === selected._id;

        if (connection.isDefault === shouldBeDefault) {
          return Promise.resolve();
        }

        return ctx.db.patch(connection._id, {
          isDefault: shouldBeDefault,
          updatedAt: now,
        });
      })
    );

    return { connectionId: selected._id };
  },
});

export {
  createPendingCodexOwned,
  getOwnedStatus,
  listOwned,
  selectDefaultCodexOwned,
};
