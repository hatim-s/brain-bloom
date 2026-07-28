import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// "/" stays protected until P7 ships a real landing page — its current content
// is the authenticated dashboard, which fetches user data.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

const proxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    // Clerk requires an absolute URL here; a bare path throws ERR_INVALID_URL.
    await auth.protect({
      unauthenticatedUrl: new URL("/sign-in", request.url).toString(),
    });
  }
});

// Next parses `config` statically at compile time, so it must be exported inline —
// a re-export from a trailing `export { ... }` statement fails the build.
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - Next.js internals
     * - common static files, unless they are explicitly requested via search params
     */
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

export { proxy };
