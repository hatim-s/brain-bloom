import { fetchQuery } from "convex/nextjs";
import { ArrowRight, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { CSSProperties, Suspense } from "react";

import { ConvexAuthNotice } from "@/components/convex-auth-notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";
import { MindmapDB } from "@/types/Mindmap";

import { MapGlyph } from "./map-glyph";
import { formatRelativeUpdatedAt } from "./relative-time";

/**
 * The row geometry, shared by the real rows and the loading state so the list
 * does not resize when the data arrives.
 */
const ROW_SHELL_CLASS =
  "flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3.5 shadow-rest sm:px-5 sm:py-4";

/**
 * The glyph's housing, and the row's visual anchor.
 *
 * Deliberately larger than an icon slot: the sprig is the one thing on this
 * screen doing any talking, so it gets room to be looked at.
 */
const GLYPH_WELL_CLASS =
  "flex size-11 shrink-0 items-center justify-center rounded-lg border";

/**
 * A moss tint mixed from the accent token itself, so it retunes with the token
 * and flips with the theme instead of being a second hand-picked colour.
 */
const GLYPH_WELL_STYLE: CSSProperties = {
  backgroundColor: "color-mix(in oklab, var(--primary) 9%, transparent)",
  borderColor: "color-mix(in oklab, var(--primary) 16%, transparent)",
};

/** The empty state's larger well, same material as the row wells. */
const EMPTY_WELL_STYLE: CSSProperties = {
  backgroundColor: "color-mix(in oklab, var(--primary) 7%, transparent)",
  borderColor: "color-mix(in oklab, var(--primary) 14%, transparent)",
};

/** The invitation panel's ground: a whisper of the grove, not a grey card. */
const EMPTY_PANEL_STYLE: CSSProperties = {
  backgroundColor: "color-mix(in oklab, var(--primary) 4%, transparent)",
};

/**
 * The glyph's one slow breath on row hover.
 *
 * A long transition rather than a keyframe animation: the mark grows from its
 * base towards the light while the pointer rests, and settles back the moment it
 * leaves. Both the transition and the transform are dropped under
 * prefers-reduced-motion, so nothing moves at all.
 */
const GLYPH_BREATH_CLASS = [
  "size-8 origin-bottom text-primary",
  "transition-transform duration-[1400ms] ease-settle group-hover:scale-[1.05]",
  "motion-reduce:transition-none motion-reduce:group-hover:scale-100",
].join(" ");

/** Widths that make the skeleton read as titles rather than as a grey block. */
const SKELETON_TITLE_WIDTHS = ["w-[58%]", "w-[42%]", "w-[68%]", "w-[50%]"];

/** Spells out a timestamp for the hover title, behind the relative phrase. */
function formatExactUpdatedAt(updatedAt: number): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(updatedAt));
}

/**
 * Renders one owned map as a single link target.
 *
 * The whole row is the anchor rather than an "Open map" link inside it, so the
 * pointer target and the keyboard target are the same object and the focus ring
 * traces the row the user is actually about to open. It lifts a single pixel on
 * hover — the sheet coming off the desk, not an animation.
 *
 * The glyph is seeded from `publicId`, so a map keeps the same mark for its whole
 * life and no two rows in a list look alike.
 */
function MindmapRow({ mindmap, now }: { mindmap: MindmapDB; now: number }) {
  return (
    <li>
      <Link
        className={`group ${ROW_SHELL_CLASS} transition-[border-color,box-shadow,transform] duration-200 ease-settle hover:-translate-y-px hover:border-line-strong hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
        href={`/maps/${mindmap.publicId}`}
      >
        <span
          aria-hidden="true"
          className={GLYPH_WELL_CLASS}
          style={GLYPH_WELL_STYLE}
        >
          <MapGlyph className={GLYPH_BREATH_CLASS} seed={mindmap.publicId} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-[1.0625rem] font-semibold leading-snug tracking-[-0.01em]">
            {mindmap.name}
          </h2>
          <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <time
              dateTime={new Date(mindmap.updatedAt).toISOString()}
              title={formatExactUpdatedAt(mindmap.updatedAt)}
            >
              {formatRelativeUpdatedAt(mindmap.updatedAt, now)}
            </time>
            {mindmap.visibility === "shared" ? (
              <>
                <span
                  aria-hidden="true"
                  className="size-[3px] rounded-full bg-current opacity-50"
                />
                <span>Shared link</span>
              </>
            ) : null}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 ease-settle group-hover:opacity-100 motion-reduce:transition-none"
        />
      </Link>
    </li>
  );
}

/**
 * The invitation shown to someone who has never made a map.
 *
 * It speaks the same glyph language as the rows, one stage earlier: a seedling
 * with a single branch, and no clay accent because the model has not touched
 * anything yet. The whole panel is the link, so the warm copy and the action are
 * one object and the state needs no button of its own — the page already carries
 * the single moss action this view is allowed.
 */
function EmptyMapsInvitation() {
  return (
    <Link
      className="group flex flex-col items-center gap-5 rounded-lg border border-dashed border-line-strong px-6 py-14 text-center transition-colors duration-200 ease-settle hover:border-primary motion-reduce:transition-none sm:px-10 sm:py-16"
      href="/new"
      style={EMPTY_PANEL_STYLE}
    >
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-lg border"
        style={EMPTY_WELL_STYLE}
      >
        <MapGlyph
          accent={false}
          branchCount={1}
          className="size-11 origin-bottom text-primary transition-transform duration-[1400ms] ease-settle group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          seed="seedling"
        />
      </span>
      <span className="flex flex-col items-center gap-2">
        <span className="text-xl font-semibold tracking-[-0.02em]">
          No maps yet
        </span>
        <span className="max-w-[44ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
          Write down one idea — a topic, a question, a chapter you are stuck on
          — and Sprig grows it into a map you can explore and extend.
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-primary">
        Start your first map
        <ArrowRight
          aria-hidden="true"
          className="size-3.5 transition-transform duration-200 ease-settle group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

/** Loads the signed-in user's maps per request. */
async function MindmapList() {
  const token = await getConvexAuthToken();
  if (token === null) {
    return <ConvexAuthNotice />;
  }

  const mindmaps = await fetchQuery(api.mindmaps.listMine, {}, { token });
  // One clock reading for the whole list, so every row is relative to the
  // same instant and the list cannot disagree with itself.
  const now = Date.now();

  if (mindmaps.length === 0) {
    return <EmptyMapsInvitation />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {mindmaps.map((mindmap) => (
        <MindmapRow key={mindmap._id} mindmap={mindmap} now={now} />
      ))}
    </ul>
  );
}

/**
 * Loading structure shown while the owned list resolves.
 *
 * Same rows, same paddings, same rhythm as the resolved list: the arrival is a
 * fill-in rather than a re-layout.
 */
function MindmapListSkeleton() {
  return (
    <div aria-label="Loading your maps" role="status">
      <ul aria-hidden="true" className="flex flex-col gap-2">
        {SKELETON_TITLE_WIDTHS.map((width) => (
          <li className={ROW_SHELL_CLASS} key={width}>
            <Skeleton className="size-11 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className={`h-[0.9375rem] ${width}`} />
              <Skeleton className="h-3 w-24" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Authenticated dashboard and canonical hub for a user's maps. */
function MapsPage() {
  return (
    <main
      className={[
        "h-full w-full overflow-y-auto bg-background",
        // The panel floats over the page, so the column steps aside for it
        // instead of being covered by it — by the panel's whole track, so the
        // gap either side of the card stays even.
        "transition-[padding] duration-300 ease-settle motion-reduce:transition-none",
        "md:peer-data-[state=expanded]:pl-[var(--sidebar-width)]",
      ].join(" ")}
    >
      {/* The forest floor. The atmosphere rides a full-height wrapper rather
          than the scroll container itself: a background painted on the
          container is sized to whatever box that container ends up with, so a
          list shorter than the viewport ended the field partway down the screen
          and left a hard seam where the ground changed. `min-h-full` covers the
          viewport when the list is short and the whole scroll extent when it is
          long, in both themes. */}
      <div className="sprig-atmosphere flex min-h-full flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 pb-24 pt-16 sm:px-8 sm:pt-20">
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
                Your maps
              </h1>
              <p className="text-[0.9375rem] text-muted-foreground">
                Everything you have grown, most recent first.
              </p>
            </div>
            {/* The one moss action on this view. */}
            <Button asChild size="lg">
              <Link href="/new">
                <Plus />
                New map
              </Link>
            </Button>
          </header>
          <Suspense fallback={<MindmapListSkeleton />}>
            <MindmapList />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

export { MapsPage as default };
