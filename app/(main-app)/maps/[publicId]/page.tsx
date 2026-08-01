import { fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ConvexAuthNotice } from "@/components/convex-auth-notice";
import Flow from "@/components/flow/Flow";
import { Header } from "@/components/header";
import { Stack } from "@/components/ui/stack";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

type MindmapPageParams = Promise<{ publicId: string }>;

/** Loads one authenticated canvas after its request params become available. */
async function MindmapCanvas({ params }: { params: MindmapPageParams }) {
  const { publicId } = await params;
  const token = await getConvexAuthToken();
  if (token === null) {
    return <ConvexAuthNotice />;
  }

  const result = await fetchQuery(
    api.mindmaps.getByPublicId,
    { publicId },
    { token }
  ).catch((error: unknown) => {
    // Private and absent IDs intentionally share the same public error.
    if (error instanceof ConvexError && error.data === "Not found") {
      return null;
    }

    throw error;
  });

  if (result === null) {
    notFound();
  }

  return (
    // The header's inline rename shares the canvas's Convex client, so the
    // provider wraps both surfaces rather than the flow alone.
    <ConvexClientProvider>
      <Header mindmap={result.mindmap} />
      {/* Full-bleed, deliberately: the shell is full-bleed with panels floating
          over it (DESIGN.md Layout), and the Sprig panel already takes its own
          column out of this box. Padding this shell for the navigation panel
          instead would resize the resizable group every time that panel is
          toggled — react-resizable-panels holds its layout in percentages, so
          the Sprig card would stop measuring the shared panel width. */}
      <Stack className="flex-1 relative">
        <Flow
          mindmap={result.mindmap}
          nodes={result.nodes}
          readOnly={!result.mindmap.isOwner}
        />
      </Stack>
    </ConvexClientProvider>
  );
}

/** Static canvas shell that streams request-specific map data. */
function MindmapPage({ params }: { params: MindmapPageParams }) {
  return (
    <Suspense
      fallback={
        <main
          aria-label="Loading mindmap"
          // A full-viewport ground, so it carries atmosphere rather than one
          // flat fill (the Never Flat Rule) — the wait is finished at the same
          // fidelity as the canvas it becomes.
          className="sprig-atmosphere flex h-full w-full items-center justify-center"
          role="status"
        >
          {/* The same ambient-dot language the canvas uses for quiet work, in
              moss: the product is fetching the map, not the model touching it,
              so this dot must not be clay. */}
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse"
            />
            Opening map
          </span>
        </main>
      }
    >
      <MindmapCanvas params={params} />
    </Suspense>
  );
}

export { MindmapPage as default };
