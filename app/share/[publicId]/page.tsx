import { fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import Flow from "@/components/flow/Flow";
import { ShareTopBar } from "@/components/share-top-bar";
import { api } from "@/convex/_generated/api";

type SharedMindmapPageParams = Promise<{ publicId: string }>;

/**
 * Resolves and renders a public shared map without consulting Clerk.
 *
 * The lookup lives inside the Suspense hole because cacheComponents rejects
 * blocking routes outright. The concession: an unknown or revoked share
 * answers HTTP 200 with 404 content — but Next injects
 * `<meta name="robots" content="noindex">` when notFound() fires in a
 * streamed boundary, so crawlers still drop the page.
 */
async function SharedMindmapContent({
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

/** Static shell: the frame prerenders; the map itself streams in. */
function SharedMindmapPage({ params }: { params: SharedMindmapPageParams }) {
  return (
    <main className="flex h-svh w-full flex-col">
      <Suspense fallback={null}>
        <SharedMindmapContent params={params} />
      </Suspense>
    </main>
  );
}

export { SharedMindmapPage as default };
