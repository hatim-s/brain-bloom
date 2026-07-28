import { fetchQuery } from "convex/nextjs";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ConvexAuthNotice } from "@/components/convex-auth-notice";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";
import { MindmapDB } from "@/types/Mindmap";

import { formatRelativeUpdatedAt } from "./relative-time";

/** One grid definition shared by the cards, the empty state and the skeleton. */
const CARD_GRID_CLASS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

/** Every card is the same block: a hairline, the card surface, one height. */
const CARD_CLASS =
  "flex h-full min-h-[8.5rem] flex-col gap-3 rounded-lg p-5 transition-colors duration-200 ease-organic motion-reduce:transition-none";

/** Spells out a timestamp for the hover title, behind the relative phrase. */
function formatExactUpdatedAt(updatedAt: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updatedAt));
}

/**
 * Renders one owned map as a single link target.
 *
 * The whole card is the anchor rather than a "Open map" link inside it, so the
 * pointer target and the keyboard target are the same object and the focus ring
 * traces the card the user is actually about to open.
 */
function MindmapCard({ mindmap, now }: { mindmap: MindmapDB; now: number }) {
  return (
    <li>
      <Link
        className={`${CARD_CLASS} border border-line-strong bg-card text-card-foreground hover:bg-accent`}
        href={`/maps/${mindmap.publicId}`}
      >
        <h2 className="line-clamp-2 text-base font-medium leading-snug">
          {mindmap.name}
        </h2>
        <p className="mt-auto font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <time
            dateTime={new Date(mindmap.updatedAt).toISOString()}
            title={formatExactUpdatedAt(mindmap.updatedAt)}
          >
            {formatRelativeUpdatedAt(mindmap.updatedAt, now)}
          </time>
        </p>
      </Link>
    </li>
  );
}

/**
 * The one way to start a map, wherever the grid is shown.
 *
 * A dashed hairline marks it as an empty slot rather than an existing map, and
 * it is deliberately the same size and shape as one so the grid stays even.
 */
function NewMapCard() {
  return (
    <li>
      <Link
        className={`${CARD_CLASS} border border-dashed border-line-strong text-muted-foreground hover:border-primary hover:text-foreground`}
        href="/new"
      >
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-sm border border-dashed border-line-strong"
        >
          <Plus className="size-4" />
        </span>
        <span className="mt-auto text-base font-medium text-foreground">
          New map
        </span>
        <span className="text-sm">Start from a blank canvas.</span>
      </Link>
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
  // One clock reading for the whole grid, so every card is relative to the
  // same instant and the list cannot disagree with itself.
  const now = Date.now();

  if (mindmaps.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-muted-foreground">No maps yet — grow your first.</p>
        <ul className={CARD_GRID_CLASS}>
          <NewMapCard />
        </ul>
      </div>
    );
  }

  return (
    <ul className={CARD_GRID_CLASS}>
      {mindmaps.map((mindmap) => (
        <MindmapCard key={mindmap._id} mindmap={mindmap} now={now} />
      ))}
      <NewMapCard />
    </ul>
  );
}

/** Static dashboard loading structure shown while the owned list resolves. */
function MindmapListSkeleton() {
  return (
    <div
      aria-label="Loading your maps"
      className={CARD_GRID_CLASS}
      role="status"
    >
      {[0, 1, 2].map((card) => (
        <div
          aria-hidden="true"
          className="min-h-[8.5rem] rounded-lg border border-border bg-card"
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
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Your maps</h1>
          <p className="text-muted-foreground">
            Open an existing mindmap or start a new one.
          </p>
        </header>
        <Suspense fallback={<MindmapListSkeleton />}>
          <MindmapList />
        </Suspense>
      </div>
    </main>
  );
}

export { MapsPage as default };
