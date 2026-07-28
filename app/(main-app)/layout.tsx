import { fetchQuery } from "convex/nextjs";
import { PropsWithChildren, Suspense } from "react";

import { ActiveFloatingSidebar, FloatingSidebar } from "@/components/sidebar";
import { SidebarProvider } from "@/components/sidebar/sidebar-provider";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";

/** Loads the authenticated navigation list inside the layout's dynamic island. */
async function MindmapSidebar() {
  const token = await getConvexAuthToken();
  const mindmaps =
    token === null
      ? []
      : await fetchQuery(api.mindmaps.listMine, {}, { token });

  return <ActiveFloatingSidebar mindmaps={mindmaps} />;
}

/**
 * Keeps protected-only chrome out of public and authentication surfaces.
 *
 * The sidebar owns its request-time Suspense boundary while children remain
 * outside it, so route-level static shells such as the dashboard heading and
 * card skeleton reach the first response. Editable canvases mount their Convex
 * client inside their existing route boundary, where the random client
 * construction is safe without swallowing sibling static content.
 */
function MainAppLayout({ children }: PropsWithChildren) {
  return (
    <SidebarProvider>
      {/* The fallback must stay hook-free: FloatingSidebar reads useParams(),
          which is request-time data and cannot render in the static shell. */}
      <Suspense fallback={<FloatingSidebar mindmaps={[]} />}>
        <MindmapSidebar />
      </Suspense>
      {children}
      <Toaster position="bottom-right" richColors expand />
    </SidebarProvider>
  );
}

export { MainAppLayout as default };
