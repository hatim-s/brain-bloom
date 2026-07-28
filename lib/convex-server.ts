import { auth } from "@clerk/nextjs/server";
import { cache } from "react";

type ClerkAuthState = Awaited<ReturnType<typeof auth>>;

/** Returns one request-cached Clerk Convex JWT, or null when unconfigured. */
const getConvexAuthToken = cache(
  async (authState?: ClerkAuthState): Promise<string | null> => {
    const { getToken, userId } = authState ?? (await auth());

    if (!userId) {
      throw new Error("You must be signed in to access mindmaps.");
    }

    return getToken({ template: "convex" });
  }
);

export { getConvexAuthToken };
