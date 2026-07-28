import Link from "next/link";

import { Wordmark } from "@/components/wordmark";

/**
 * Public frame above a shared, read-only canvas.
 *
 * A visitor arrives here from a link with no other context, so the bar has to
 * answer three questions at a glance: whose product this is, which map they are
 * looking at, and why the canvas below will not accept their edits. It is chrome
 * only — it never touches the flow beneath it.
 */
function ShareTopBar({ mindmapName }: { mindmapName: string }) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border pl-5 pr-18 sm:gap-4 sm:pl-6 sm:pr-20">
      <Link
        aria-label="Sprig home"
        className="shrink-0 rounded-sm transition-opacity duration-200 ease-organic hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        href="/"
      >
        <Wordmark className="text-xs" />
      </Link>
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
        {mindmapName}
      </h1>
      <span className="shrink-0 rounded-sm border border-border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Read-only
      </span>
    </header>
  );
}

export { ShareTopBar };
