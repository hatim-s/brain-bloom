"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { PropsWithChildren, useState } from "react";

/**
 * Supplies the browser Convex client with Clerk session tokens.
 *
 * Placeholder-environment CI builds may omit NEXT_PUBLIC_CONVEX_URL. In that
 * case this provider deliberately leaves its children unwrapped until P6
 * hardens the frontend data dependency.
 */
export function ConvexClientProvider({ children }: PropsWithChildren) {
  const [client] = useState(() => {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    return convexUrl ? new ConvexReactClient(convexUrl) : null;
  });

  if (!client) {
    return children;
  }

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
