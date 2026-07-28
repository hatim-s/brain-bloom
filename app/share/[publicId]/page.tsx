import { fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import Flow from "@/components/flow/Flow";
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
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-6">
        <Link className="font-medium" href="/">
          Sprig
        </Link>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <h1 className="truncate text-sm font-medium">{result.mindmap.name}</h1>
        <p className="ml-auto text-sm text-muted-foreground">Read-only</p>
      </header>
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
