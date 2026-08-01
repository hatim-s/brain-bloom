"use client";

import { PropsWithChildren, useState } from "react";

import { useEventCallback } from "@/hooks/use-event-callback";

import { SidebarProvider as BaseSidebarProvider } from "../ui/sidebar";

/** Cookie that remembers the panel's open/closed preference between visits. */
const SIDEBAR_STATE_COOKIE = "sidebar-state";

/** A year, in seconds: the preference should outlive the session. */
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Owns whether the navigation panel is open, and remembers the choice.
 *
 * The preference lives in a cookie rather than localStorage so the server
 * layout can read it and render the true state on first paint. A client-only
 * store forces the server to guess "closed", and the guess hydration-mismatches
 * against any Suspense-streamed subtree that arrives after the client has
 * already applied the stored preference.
 */
function SidebarProvider({
  children,
  defaultOpen = false,
}: PropsWithChildren<{ defaultOpen?: boolean }>) {
  const [open, setOpen] = useState(defaultOpen);

  const handleToggle = useEventCallback((_open: boolean) => {
    setOpen(_open);
    document.cookie = `${SIDEBAR_STATE_COOKIE}=${_open ? "open" : "closed"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
    return _open;
  });

  return (
    <BaseSidebarProvider open={open} onOpenChange={handleToggle}>
      {children}
    </BaseSidebarProvider>
  );
}

export { SIDEBAR_STATE_COOKIE, SidebarProvider };
