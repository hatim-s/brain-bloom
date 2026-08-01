import { auth, clerkClient } from "@clerk/nextjs/server";
import { cache } from "react";

type ClerkAuthState = Awaited<ReturnType<typeof auth>>;

/** Detects Clerk's current Convex integration on a token's `aud` claim. */
function isConvexAudience(audience: unknown): boolean {
  return (
    audience === "convex" ||
    (Array.isArray(audience) && audience.includes("convex"))
  );
}

/**
 * Reads the `aud` claim off a JWT without verifying its signature.
 *
 * Verifying is Convex's job — it holds the issuer's keys and rejects anything
 * it dislikes. What we need locally is cheaper and different: a template-less
 * session token is only usable as a Convex token when this instance stamps
 * aud="convex" on it, so we look before we hand one back rather than letting
 * a wrong-audience token fail deep inside a query as "Could not verify OIDC
 * token claim".
 */
function tokenHasConvexAudience(jwt: string): boolean {
  const payload = jwt.split(".")[1];

  if (!payload) {
    return false;
  }

  try {
    // base64url → base64, re-padded: atob is the one decoder available in
    // every runtime this module renders in (node and edge).
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "="
    );
    const claims = JSON.parse(atob(padded)) as { aud?: unknown };

    return isConvexAudience(claims.aud);
  } catch {
    // A token we cannot even parse is a token we must not trust.
    return false;
  }
}

/**
 * Returns one request-cached Clerk Convex JWT, or null when unconfigured.
 *
 * Minted through the Backend API rather than read from the request cookie:
 * the cookie JWT is only refreshed by clerk-js on its own cadence (~90s),
 * while the token itself is valid for ~60s — so a cookie-read token is
 * expired for a large fraction of perfectly healthy requests and Convex
 * rejects it with "Could not verify OIDC token claim".
 */
const getConvexAuthToken = cache(
  async (authState?: ClerkAuthState): Promise<string | null> =>
    getFreshConvexAuthToken(authState)
);

/**
 * Mints a Convex JWT that is valid *now*, for callers that do long work (AI
 * generation runs for minutes) between request start and the Convex call.
 *
 * Every request-context path (`getToken()`, with or without a template) hands
 * back a token anchored to the request's session cookie, whose ~60s validity
 * is anchored to request start — expired by the time a slow action persists,
 * which Convex rejects with "Could not verify OIDC token claim". The Backend
 * API mints with the secret key against the *session id*, so the token it
 * returns is freshly issued no matter how old the request is.
 *
 * The chain is ordered by freshness, and every rung exists because the rung
 * above it has a real failure mode on this instance:
 *
 * 1. Backend API with the "convex" JWT template — the classic integration.
 *    This instance has no JWT templates at all (`GET /v1/jwt_templates` is
 *    empty), so it always 404s here; it stays first so an instance that later
 *    grows a template keeps working without a code change.
 * 2. Backend API with no template — Clerk's newer Convex integration stamps
 *    aud="convex" straight onto the session token, and Convex accepts it. The
 *    audience is checked on the *minted token* rather than on the request's
 *    session claims, because the claims can be stale or absent while the mint
 *    is authoritative.
 * 3. The request's own `getToken()`. Both Backend API rungs resolve a *session
 *    id* read from the request cookie, and a stale id (signed out elsewhere,
 *    rotated session) makes them throw "Not Found" — while the cookie the
 *    middleware just refreshed still carries a usable token. Its ~60s validity
 *    is anchored to request start, which is plenty for a short server render
 *    and is the reason this is the last resort rather than the first.
 * 4. `null` — no token exists. Callers must treat this as a failure to load,
 *    never as an empty result.
 */
async function getFreshConvexAuthToken(
  authState?: ClerkAuthState
): Promise<string | null> {
  const state = authState ?? (await auth());
  const { getToken, sessionId, userId } = state;

  if (!userId || !sessionId) {
    throw new Error("You must be signed in to access mindmaps.");
  }

  const client = await clerkClient();

  try {
    const { jwt } = await client.sessions.getToken(sessionId, "convex");
    return jwt;
  } catch {
    // No "convex" template on this instance (or the session id is stale);
    // fall through to a fresh plain session token.
  }

  try {
    const { jwt } = await client.sessions.getToken(sessionId);

    if (tokenHasConvexAudience(jwt)) {
      return jwt;
    }
  } catch {
    // Stale session id: the Backend API cannot mint against a session it no
    // longer knows. The request's own cookie is the only thing left.
  }

  try {
    const requestToken = await getToken();

    if (requestToken !== null && tokenHasConvexAudience(requestToken)) {
      return requestToken;
    }
  } catch {
    // Nothing mintable anywhere; fall through to null.
  }

  return null;
}

/**
 * How long a freshly minted token is reused before re-minting. Clerk Convex
 * JWTs live ~60s; refreshing at 45s keeps a comfortable validity margin while
 * avoiding a Backend API round-trip per Convex call.
 */
const TOKEN_REUSE_WINDOW_MS = 45_000;

/**
 * Returns an async token getter for flows that outlive one token's validity
 * (streaming chat, slow generations). Each call yields a token that is
 * currently valid, re-minting behind the reuse window.
 */
function createConvexTokenSource(
  authState?: ClerkAuthState
): () => Promise<string | null> {
  let mintedAt = 0;
  let minted: string | null = null;

  return async () => {
    const now = Date.now();

    if (minted === null || now - mintedAt > TOKEN_REUSE_WINDOW_MS) {
      minted = await getFreshConvexAuthToken(authState);
      mintedAt = now;
    }

    return minted;
  };
}

export { createConvexTokenSource, getConvexAuthToken, getFreshConvexAuthToken };
