import { ArrowUpRight, Eye } from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@/components/wordmark";

/**
 * Public frame above a shared, read-only canvas.
 *
 * A visitor arrives here from a link with no other context, so the bar answers
 * three questions at a glance — whose product this is, which map they are
 * looking at, and why the canvas below will not accept their edits — and then
 * gets out of the way. It is floating chrome in the Grove sense: a raised sheet
 * one tonal step above the forest ground, closed by a hairline and carrying the
 * Raised shadow so it reads as resting *over* the canvas rather than as a strip
 * cut out of it. No accent fills — the single quiet CTA is the only invitation,
 * and nothing here claims the map is private, because a share link is public by
 * design.
 *
 * `relative z-10` only exists so the shadow falls onto the flow instead of
 * being painted over by it.
 *
 * The right padding reserves the strip where the globally-positioned
 * ThemeSwitcher floats, so the CTA never sits underneath it.
 *
 * Chrome only — it never touches the flow beneath it.
 */
function ShareTopBar({ mindmapName }: { mindmapName: string }) {
  return (
    <header className="relative z-10 flex h-13 shrink-0 items-center gap-3 border-b border-border bg-card pl-4 pr-[calc(var(--theme-switcher-inset)+2.75rem)] text-card-foreground shadow-raised sm:gap-4 sm:pl-6">
      <Link
        aria-label="Sprig home"
        className="shrink-0 rounded-sm transition-opacity duration-200 ease-settle hover:opacity-70 motion-reduce:transition-none"
        href="/"
      >
        <Wordmark className="text-[0.8125rem]" />
      </Link>
      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium tracking-[-0.01em]">
        {mindmapName}
      </h1>
      {/* Status, not a badge: a sunken hairline chip in the label voice rather
          than a tracked-out uppercase tag. Reading is a state, so it sits *into*
          the bar instead of sitting on it. It folds away under 640px, where the
          canvas offers no editing affordance to contradict anyway. */}
      <span className="hidden shrink-0 items-center gap-1.5 rounded-sm border border-border bg-secondary px-2 py-1 text-[0.8125rem] leading-none text-muted-foreground sm:inline-flex">
        <Eye aria-hidden="true" className="size-3.5" />
        Read-only
      </span>
      <Link
        aria-label="Made with Sprig — try it"
        className="group inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-200 ease-settle hover:bg-accent hover:text-foreground motion-reduce:transition-none"
        href="/"
      >
        <span className="hidden sm:inline">Made with Sprig — try it</span>
        <span className="sm:hidden">Try Sprig</span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-3.5 transition-transform duration-200 ease-settle group-hover:-translate-y-px group-hover:translate-x-px motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
        />
      </Link>
    </header>
  );
}

export { ShareTopBar };
