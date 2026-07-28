import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { Suspense } from "react";

import { ConvexAuthNotice } from "@/components/convex-auth-notice";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";
import { MindmapDB } from "@/types/Mindmap";

/** Formats a persisted update timestamp for the server-rendered card. */
function formatUpdatedAt(updatedAt: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updatedAt));
}

/** Renders one owned map with its last update and canonical canvas link. */
function MindmapCard({ mindmap }: { mindmap: MindmapDB }) {
  const updatedAt = formatUpdatedAt(mindmap.updatedAt);

  return (
    <li className="rounded-lg border border-line-strong bg-card p-5">
      <article className="flex h-full flex-col items-start gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium">{mindmap.name}</h2>
          <p className="text-sm text-muted-foreground">
            Updated{" "}
            <time dateTime={new Date(mindmap.updatedAt).toISOString()}>
              {updatedAt}
            </time>
          </p>
        </div>
        <Link
          className="mt-auto font-medium text-primary underline underline-offset-4"
          href={`/maps/${mindmap.publicId}`}
        >
          Open map
        </Link>
      </article>
    </li>
  );
}

/** Loads the signed-in user's dashboard cards per request. */
async function MindmapList() {
  const token = await getConvexAuthToken();
  if (token === null) {
    return <ConvexAuthNotice />;
  }

  const mindmaps = await fetchQuery(api.mindmaps.listMine, {}, { token });

  if (mindmaps.length === 0) {
    return (
      <p className="rounded-lg border border-line-strong bg-card p-5 text-muted-foreground">
        You do not have any maps yet. Start one when you are ready.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {mindmaps.map((mindmap) => (
        <MindmapCard key={mindmap._id} mindmap={mindmap} />
      ))}
    </ul>
  );
}

/** Static dashboard loading structure shown while the owned list resolves. */
function MindmapListSkeleton() {
  return (
    <div
      aria-label="Loading your maps"
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      role="status"
    >
      {[0, 1].map((card) => (
        <div
          aria-hidden="true"
          className="h-32 rounded-lg border border-border bg-card"
          key={card}
        />
      ))}
    </div>
  );
}

/** Authenticated dashboard and canonical hub for a user's maps. */
function MapsPage() {
  return (
    <main className="h-full w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-20">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Your maps</h1>
            <p className="text-muted-foreground">
              Open an existing mindmap or start a new one.
            </p>
          </div>
          <Button asChild>
            <Link href="/new">New map</Link>
          </Button>
        </header>
        <Suspense fallback={<MindmapListSkeleton />}>
          <MindmapList />
        </Suspense>
      </div>
    </main>
  );
}

export { MapsPage as default };
