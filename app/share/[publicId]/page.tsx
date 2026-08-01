import { fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DotField } from "@/components/dot-field";
import Flow from "@/components/flow/Flow";
import { ShareTopBar } from "@/components/share-top-bar";
import { Wordmark } from "@/components/wordmark";
import { api } from "@/convex/_generated/api";

type SharedMindmapPageParams = Promise<{ publicId: string }>;

/**
 * Canopy light over the empty canvas region.
 *
 * The Never Flat Rule applies to the waiting state too: before the map arrives,
 * the ground is still the grove — one very low-alpha moss field mixed from
 * --primary so both themes resolve live, no hex pinned here.
 */
const CANOPY_STYLE = {
  backgroundImage:
    "radial-gradient(110% 72% at 50% 0%, color-mix(in oklab, var(--primary) 7%, transparent) 0%, transparent 66%)",
};

/**
 * Placeholder held while the shared map streams in.
 *
 * It draws the finished frame — the same 52px raised band with its hairline and
 * Raised shadow, the same identity, the grove ground already lit under the
 * canvas grid — with the map's title as a single quiet block, so the arrival
 * reads as content filling a frame that was always there rather than a page
 * assembling itself. Nothing animates: a shimmer would be the loudest thing in
 * a calm product.
 */
function SharedMindmapFallback() {
  return (
    <>
      <header className="relative z-10 flex h-13 shrink-0 items-center gap-3 border-b border-border bg-card pl-4 text-card-foreground shadow-raised sm:gap-4 sm:pl-6">
        <Wordmark className="text-[0.8125rem]" />
        <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
        <span
          aria-hidden="true"
          className="h-3 w-40 max-w-[35%] rounded-full bg-secondary"
        />
        <span className="sr-only">Loading the shared map</span>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={CANOPY_STYLE}
        />
        <DotField />
      </div>
    </>
  );
}

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
    <main className="flex h-svh w-full flex-col bg-background">
      <Suspense fallback={<SharedMindmapFallback />}>
        <SharedMindmapContent params={params} />
      </Suspense>
    </main>
  );
}

export { SharedMindmapPage as default };
