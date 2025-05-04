import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const publicPaths = [
  "/sign-in",
  "/sign-up",
  "/auth/callback",
  "/forgot-password",
];

export const updateSession = async (request: NextRequest) => {
  // Create an unmodified response
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const { pathname } = request.nextUrl;

  // Skip auth check for public paths
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // This will refresh session if expired - required for Server Components
  // https://supabase.com/docs/guides/auth/server-side/nextjs
  const user = await supabase.auth.getUser();

  if (!user.data.user) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return response;
};
