import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { requireUser } from "./lib/access";
import { isPersonalBetaSubjectAllowed } from "./lib/personalBeta";

const PERSONAL_BETA_ACCESS_UNAVAILABLE = "Personal beta access unavailable";
const INVALID_CONNECTION_REQUEST = "Invalid connection request";

type ConnectionRateEndpoint =
  | "createPendingCodex"
  | "selectDefaultCodex"
  | "list"
  | "getStatus";
type SafeConnection = Omit<
  Doc<"aiConnections">,
  "ownerId" | "gatewayCredentialId" | "lifecycleRevision" | "lifecycleVersion"
>;

// Explicit references avoid a generated-API type cycle in the module whose
// public actions call these internal functions.
const consumeRateBudget = makeFunctionReference<
  "mutation",
  { subject: string; endpoint: ConnectionRateEndpoint },
  null
>("connectionRateBudget:consume");
const listOwned = makeFunctionReference<
  "query",
  { subject: string },
  SafeConnection[]
>("aiConnectionsInternal:listOwned");
const getOwnedStatus = makeFunctionReference<
  "query",
  { subject: string; connectionId: string },
  SafeConnection
>("aiConnectionsInternal:getOwnedStatus");
const createPendingCodexOwned = makeFunctionReference<
  "mutation",
  { subject: string },
  { connectionId: Id<"aiConnections"> }
>("aiConnectionsInternal:createPendingCodexOwned");
const selectDefaultCodexOwned = makeFunctionReference<
  "mutation",
  { subject: string; connectionId: string },
  { connectionId: Id<"aiConnections"> }
>("aiConnectionsInternal:selectDefaultCodexOwned");

/** Requires the current Clerk subject to remain on the server-controlled beta list. */
function requirePersonalBetaAccess(subject: string): void {
  if (!isPersonalBetaSubjectAllowed(subject)) {
    throw new ConvexError(PERSONAL_BETA_ACCESS_UNAVAILABLE);
  }
}

/** Requires a public call to supply an exact empty argument object. */
function requireEmptyArguments(args: unknown): void {
  if (
    typeof args !== "object" ||
    args === null ||
    Array.isArray(args) ||
    Object.keys(args).length !== 0
  ) {
    throw new ConvexError(INVALID_CONNECTION_REQUEST);
  }
}

/** Parses the sole connection id only after the known owner has spent capacity. */
function requireConnectionIdString(args: unknown): string {
  if (
    typeof args !== "object" ||
    args === null ||
    Array.isArray(args) ||
    Object.keys(args).length !== 1 ||
    !("connectionId" in args) ||
    typeof args.connectionId !== "string"
  ) {
    throw new ConvexError(INVALID_CONNECTION_REQUEST);
  }

  return args.connectionId;
}

/** Lists rate-limited, secret-free metadata for the authenticated owner. */
const list = action({
  // Broad validation lets malformed known-owner attempts consume capacity
  // before the handler returns a stable application-level error.
  args: v.record(v.string(), v.any()),
  handler: async (ctx, args: unknown) => {
    const subject = await requireUser(ctx);
    await ctx.runMutation(consumeRateBudget, {
      subject,
      endpoint: "list",
    });
    requireEmptyArguments(args);

    return ctx.runQuery(listOwned, { subject });
  },
});

/** Reads rate-limited safe status, including after owner de-allowlisting. */
const getStatus = action({
  args: v.record(v.string(), v.any()),
  handler: async (ctx, args: unknown) => {
    const subject = await requireUser(ctx);
    await ctx.runMutation(consumeRateBudget, {
      subject,
      endpoint: "getStatus",
    });
    const connectionId = requireConnectionIdString(args);

    return ctx.runQuery(getOwnedStatus, {
      subject,
      connectionId,
    });
  },
});

/** Creates one server-derived pending Codex connection after charging capacity. */
const createPendingCodex = action({
  args: v.record(v.string(), v.any()),
  handler: async (ctx, args: unknown) => {
    const subject = await requireUser(ctx);
    await ctx.runMutation(consumeRateBudget, {
      subject,
      endpoint: "createPendingCodex",
    });
    requireEmptyArguments(args);
    requirePersonalBetaAccess(subject);

    return ctx.runMutation(createPendingCodexOwned, { subject });
  },
});

/** Selects a connected Codex default after charging capacity and checking beta access. */
const selectDefaultCodex = action({
  args: v.record(v.string(), v.any()),
  handler: async (ctx, args: unknown) => {
    const subject = await requireUser(ctx);
    await ctx.runMutation(consumeRateBudget, {
      subject,
      endpoint: "selectDefaultCodex",
    });
    const connectionId = requireConnectionIdString(args);
    requirePersonalBetaAccess(subject);

    return ctx.runMutation(selectDefaultCodexOwned, { subject, connectionId });
  },
});

export { createPendingCodex, getStatus, list, selectDefaultCodex };
