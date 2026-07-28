import { auth } from "@clerk/nextjs/server";

/** Returns the current Clerk session's Convex JWT template token. */
async function getConvexAuthToken(): Promise<string> {
  const { getToken, userId } = await auth();

  if (!userId) {
    throw new Error("You must be signed in to access mindmaps.");
  }

  const token = await getToken({ template: "convex" });
  if (!token) {
    throw new Error("The Clerk Convex token template is unavailable.");
  }

  return token;
}

export { getConvexAuthToken };
