import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { acceptsJsonOverHtml, isPublicPath } from "@/lib/auth-routing";

const proxy = clerkMiddleware(async (auth, request) => {
  // Public landing, auth, and shared-map routes bypass Clerk protection.
  if (isPublicPath(request.nextUrl.pathname)) {
    return;
  }

  const { userId } = await auth();
  if (userId) {
    return;
  }

  if (
    request.nextUrl.pathname.startsWith("/api") ||
    acceptsJsonOverHtml(request.headers.get("accept"))
  ) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const destination = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const unauthenticatedUrl = new URL("/sign-in", request.url);
  unauthenticatedUrl.searchParams.set("redirect_url", destination);

  return NextResponse.redirect(unauthenticatedUrl);
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
