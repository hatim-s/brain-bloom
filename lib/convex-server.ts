import { auth } from "@clerk/nextjs/server";
import { cache } from "react";

type ClerkAuthState = Awaited<ReturnType<typeof auth>>;

/** Detects Clerk's current Convex integration on the normal session token. */
function hasConvexAudience(
  sessionClaims: ClerkAuthState["sessionClaims"]
): boolean {
  const audience = sessionClaims?.aud;

  return (
    audience === "convex" ||
    (Array.isArray(audience) && audience.includes("convex"))
  );
}

/** Returns one request-cached Clerk Convex JWT, or null when unconfigured. */
const getConvexAuthToken = cache(
  async (authState?: ClerkAuthState): Promise<string | null> => {
    const { getToken, sessionClaims, userId } = authState ?? (await auth());

    if (!userId) {
      throw new Error("You must be signed in to access mindmaps.");
    }

    // Clerk's current Convex integration adds aud="convex" to the normal
    // session token. Older applications may still use the legacy template.
    if (hasConvexAudience(sessionClaims)) {
      return getToken();
    }

    return getToken({ template: "convex" });
  }
);

export { getConvexAuthToken };
