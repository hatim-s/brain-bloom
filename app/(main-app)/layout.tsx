import { fetchQuery } from "convex/nextjs";
import { cookies } from "next/headers";
import { PropsWithChildren, Suspense } from "react";

import {
  ActiveFloatingSidebar,
  FloatingSidebar,
  SidebarNotch,
} from "@/components/sidebar";
import {
  SIDEBAR_STATE_COOKIE,
  SidebarProvider,
} from "@/components/sidebar/sidebar-provider";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import { getFreshConvexAuthToken } from "@/lib/convex-server";

/**
 * Loads the authenticated navigation list inside the layout's dynamic island.
 *
 * This render also runs inside server-action response roundtrips (Next
 * re-renders the current route in the action's own request), which for a
 * minutes-long AI generation is far past the request token's validity — so the
 * token is minted fresh here, never taken from the request cache. A failed
 * sidebar load degrades to a quiet notice instead of failing the roundtrip
 * that just persisted the user's map.
 *
 * The failure is passed down explicitly rather than collapsed into an empty
 * list: "no maps yet" is a confident statement about the account, and a token
 * we could not mint tells us nothing about the account at all. Rendering the
 * invitation on a load failure hides the user's maps behind a lie.
 */
async function MindmapSidebar() {
  try {
    const token = await getFreshConvexAuthToken();

    // A null token is not "signed in with nothing to show" — it is every rung
    // of the mint chain failing, so the map list is unknown, not empty.
    if (token === null) {
      // eslint-disable-next-line no-console -- nav chrome must not sink the response; keep the cause visible
      console.error(
        "MindmapSidebar load failed: no Convex token could be minted"
      );
      return <ActiveFloatingSidebar loadFailed mindmaps={[]} />;
    }

    const mindmaps = await fetchQuery(api.mindmaps.listMine, {}, { token });

    return <ActiveFloatingSidebar mindmaps={mindmaps} />;
  } catch (error) {
    // eslint-disable-next-line no-console -- nav chrome must not sink the response; keep the cause visible
    console.error("MindmapSidebar load failed", error);
    return <ActiveFloatingSidebar loadFailed mindmaps={[]} />;
  }
}

/**
 * The cookie-aware shell: reads the sidebar preference so this server render
 * and every Suspense-streamed subtree agree with the client's first paint. A
 * client-only store made the server guess "closed", and hydration flagged the
 * mismatch on the streamed sidebar.
 *
 * Runtime data (cookies) must live under a Suspense boundary with
 * `cacheComponents`, which is why this is a child of the layout rather than
 * the layout itself.
 *
 * Order matters beyond reading order: the panel renders before the page so the
 * page can be a CSS sibling of it and step aside when it opens, rather than
 * being covered by a panel that floats above the content.
 */
async function AppShell({ children }: PropsWithChildren) {
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get(SIDEBAR_STATE_COOKIE)?.value === "open";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      {/* The fallback must stay hook-free: FloatingSidebar reads useParams(),
          which is request-time data and cannot render in the static shell. */}
      <Suspense fallback={<FloatingSidebar mindmaps={[]} />}>
        <MindmapSidebar />
      </Suspense>
      {/* The closed panel's edge tab. Rendered by the shell rather than by each
          page, so every surface under it — canvas and list pages alike — gets
          the same way back to the navigation, and it stays a sibling *before*
          the page so the page's `peer-data-[state=expanded]` rules still see
          the panel that precedes them. */}
      <SidebarNotch />
      {children}
      {/* No rich colours: a toast is a popover sheet like every other floating
          surface, and a filled red panel is exactly the shout the error style
          avoids. Severity is carried by the copy and the destructive text. */}
      <Toaster expand position="bottom-right" />
    </SidebarProvider>
  );
}

/**
 * Keeps protected-only chrome out of public and authentication surfaces.
 * The shell's fallback is one quiet viewport of ground: every child route
 * paints its own designed loading state the moment the shell resolves.
 */
function MainAppLayout({ children }: PropsWithChildren) {
  return (
    <Suspense fallback={<div className="h-svh w-full bg-background" />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

export { MainAppLayout as default };
