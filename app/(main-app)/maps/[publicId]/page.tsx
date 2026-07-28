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
    <>
      <Header mindmap={result.mindmap} />
      <Stack className="flex-1 relative">
        <ConvexClientProvider>
          <Flow
            mindmap={result.mindmap}
            nodes={result.nodes}
            readOnly={!result.mindmap.isOwner}
          />
        </ConvexClientProvider>
      </Stack>
    </>
  );
}

/** Static canvas shell that streams request-specific map data. */
function MindmapPage({ params }: { params: MindmapPageParams }) {
  return (
    <Suspense
      fallback={
        <main
          aria-label="Loading mindmap"
          className="h-full w-full bg-background"
          role="status"
        />
      }
    >
      <MindmapCanvas params={params} />
    </Suspense>
  );
}

export { MindmapPage as default };
