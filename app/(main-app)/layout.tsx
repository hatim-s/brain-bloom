import { fetchQuery } from "convex/nextjs";
import { PropsWithChildren, Suspense } from "react";

import { FloatingSidebar } from "@/components/sidebar";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

/** Loads the authenticated navigation list inside the layout's dynamic island. */
async function MindmapSidebar() {
  const token = await getConvexAuthToken();
  const mindmaps =
    token === null
      ? []
      : await fetchQuery(api.mindmaps.listMine, {}, { token });

  return <FloatingSidebar mindmaps={mindmaps} />;
}

/**
 * Keeps the protected app frame prerenderable while its sidebar streams in.
 * ConvexClientProvider mounts here, not in the root layout: constructing the
 * browser ConvexReactClient during the static prerender of public routes trips
 * cacheComponents' Math.random guard, and only this group uses client hooks.
 */
function MainAppLayout({ children }: PropsWithChildren) {
  return (
    // The boundary sits ABOVE the provider: constructing ConvexReactClient
    // involves randomness, which cacheComponents only permits inside a
    // Suspense hole. The whole group is auth-gated and dynamic regardless.
    <Suspense fallback={null}>
      <ConvexClientProvider>
        <Suspense fallback={<FloatingSidebar mindmaps={[]} />}>
          <MindmapSidebar />
        </Suspense>
        {children}
      </ConvexClientProvider>
    </Suspense>
  );
}

export { MainAppLayout as default };
