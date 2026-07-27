import { type NextRequest } from "next/server";

import { updateSession } from "@/utils/supabase/middleware";

/**
 * Refreshes the Supabase session before protected routes handle a request.
 */
async function proxy(request: NextRequest) {
  return await updateSession(request);
}

// Next parses `config` statically at compile time, so it must be exported inline —
// a re-export from a trailing `export { ... }` statement fails the build.
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

export { proxy };
