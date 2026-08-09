import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/access";
import { isPersonalBetaSubjectAllowed } from "./lib/personalBeta";

const PERSONAL_BETA_ACCESS_UNAVAILABLE = "Personal beta access unavailable";
const CONNECTION_ALREADY_PENDING = "Connection already pending";
const CONNECTION_UNAVAILABLE = "Connection unavailable";

type ConnectionContext = MutationCtx | QueryCtx;
type SafeConnection = Omit<
  Doc<"aiConnections">,
  "ownerId" | "gatewayCredentialId"
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
    accountHint: connection.accountHint,
    planLabel: connection.planLabel,
    isDefault: connection.isDefault,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    lastValidationAt: connection.lastValidationAt,
    lastErrorCode: connection.lastErrorCode,
  };
}

/** Requires the current Clerk subject to remain on the server-controlled beta list. */
function requirePersonalBetaAccess(subject: string): void {
  if (!isPersonalBetaSubjectAllowed(subject)) {
    throw new ConvexError(PERSONAL_BETA_ACCESS_UNAVAILABLE);
  }
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

/** Lists only secret-free metadata for the authenticated owner. */
const list = query({
  args: {},
  handler: async (ctx) => {
    const subject = await requireUser(ctx);
    const connections = await ctx.db
      .query("aiConnections")
      .withIndex("by_owner", (index) => index.eq("ownerId", subject))
      .order("desc")
      .collect();

    return connections.map(toSafeConnection);
  },
});

/** Reads safe status for one owned connection, including after de-allowlisting. */
const getStatus = query({
  args: { connectionId: v.id("aiConnections") },
  handler: async (ctx, { connectionId }) => {
    const subject = await requireUser(ctx);
    const connection = await getOwnedConnection(ctx, connectionId, subject);

    return toSafeConnection(connection);
  },
});

/** Creates one server-derived pending Codex device-code connection per owner at a time. */
const createPendingCodex = mutation({
  args: {},
  handler: async (ctx) => {
    const subject = await requireUser(ctx);
    requirePersonalBetaAccess(subject);

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

/** Atomically makes one connected Codex connection the owner's sole default. */
const selectDefaultCodex = mutation({
  args: { connectionId: v.id("aiConnections") },
  handler: async (ctx, { connectionId }) => {
    const subject = await requireUser(ctx);
    requirePersonalBetaAccess(subject);
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

export { createPendingCodex, getStatus, list, selectDefaultCodex };
