import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type AuthenticatedCtx = QueryCtx | MutationCtx;

/**
 * Requires an authenticated Convex identity and returns its stable subject.
 */
export async function requireUser(ctx: AuthenticatedCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    throw new Error("Unauthenticated");
  }

  return identity.subject;
}

/**
 * Loads a mindmap after verifying that the current user owns it.
 */
export async function requireOwner(
  ctx: AuthenticatedCtx,
  mindmapId: Id<"mindmaps">
): Promise<Doc<"mindmaps">> {
  const subject = await requireUser(ctx);
  const mindmap = await ctx.db.get("mindmaps", mindmapId);

  if (mindmap === null) {
    throw new Error("Not found");
  }

  if (mindmap.ownerId !== subject) {
    throw new Error("Forbidden");
  }

  return mindmap;
}

/**
 * Loads a mindmap that is owned by the user or shared with authenticated users.
 */
export async function requireReadable(
  ctx: AuthenticatedCtx,
  mindmapId: Id<"mindmaps">
): Promise<Doc<"mindmaps">> {
  const subject = await requireUser(ctx);
  const mindmap = await ctx.db.get("mindmaps", mindmapId);

  if (mindmap === null) {
    throw new Error("Not found");
  }

  if (mindmap.ownerId !== subject && mindmap.visibility !== "shared") {
    throw new Error("Forbidden");
  }

  return mindmap;
}
