import { fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import Flow from "@/components/flow/Flow";
import { ShareTopBar } from "@/components/share-top-bar";
import { api } from "@/convex/_generated/api";

type SharedMindmapPageParams = Promise<{ publicId: string }>;

/** Loads a public shared map without consulting Clerk authentication. */
async function SharedMindmapCanvas({
  params,
}: {
  params: SharedMindmapPageParams;
}) {
  const { publicId } = await params;
  const result = await fetchQuery(api.mindmaps.getShared, { publicId }).catch(
    (error: unknown) => {
      // Private and absent IDs intentionally resolve to the same global 404.
      if (error instanceof ConvexError && error.data === "Not found") {
        return null;
      }

      throw error;
    }
  );

  if (result === null) {
    notFound();
  }

  return (
    <>
      <ShareTopBar mindmapName={result.mindmap.name} />
      <div className="min-h-0 flex-1">
        <Flow mindmap={result.mindmap} nodes={result.nodes} readOnly />
      </div>
    </>
  );
}

/** Public static shell that streams only maps explicitly marked shared. */
function SharedMindmapPage({ params }: { params: SharedMindmapPageParams }) {
  return (
    <main className="flex h-full w-full flex-col">
      <Suspense
        fallback={
          <div
            aria-label="Loading shared mindmap"
            className="h-full w-full bg-background"
            role="status"
          />
        }
      >
        <SharedMindmapCanvas params={params} />
      </Suspense>
    </main>
  );
}

export { SharedMindmapPage as default };
