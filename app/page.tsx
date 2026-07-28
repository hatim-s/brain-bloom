import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

/** Resolves the request-specific landing action without blocking the shell. */
async function LandingAuthCta() {
  const { userId } = await auth();

  return (
    <Button asChild>
      <Link href={userId ? "/maps" : "/sign-in"}>
        {userId ? "Open your maps" : "Sign in"}
      </Link>
    </Button>
  );
}

/**
 * The product, drawn once: a root idea and the two branches it grew.
 *
 * Deliberately hand-built geometry rather than an illustration — same hairline
 * tokens, same 14/10/8 radius family, and the same leaf-dot as the wordmark, so
 * it reads as a piece of the canvas instead of marketing art. Nothing animates.
 */
function MindmapGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="h-auto w-full max-w-[19rem] text-line-strong"
      fill="none"
      role="presentation"
      viewBox="0 0 224 140"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Branch connectors leave the root's right edge flat, then settle into
          each child, matching the curve the canvas draws between nodes. */}
      <path
        d="M96 70 C 116 70 120 30 140 30"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M96 70 C 116 70 120 110 140 110"
        stroke="currentColor"
        strokeWidth="1.25"
      />

      <rect
        className="fill-card"
        height="36"
        rx="12"
        stroke="currentColor"
        strokeWidth="1.25"
        width="88"
        x="8"
        y="52"
      />
      <circle className="fill-primary" cx="24" cy="70" r="3" />
      <rect
        className="fill-border"
        height="3"
        rx="1.5"
        width="44"
        x="34"
        y="68.5"
      />

      <rect
        className="fill-card"
        height="28"
        rx="10"
        stroke="currentColor"
        strokeWidth="1.25"
        width="76"
        x="140"
        y="16"
      />
      <rect
        className="fill-border"
        height="3"
        rx="1.5"
        width="48"
        x="152"
        y="28.5"
      />

      <rect
        className="fill-card"
        height="28"
        rx="10"
        stroke="currentColor"
        strokeWidth="1.25"
        width="76"
        x="140"
        y="96"
      />
      <rect
        className="fill-border"
        height="3"
        rx="1.5"
        width="36"
        x="152"
        y="108.5"
      />
    </svg>
  );
}

/** Public, statically prerenderable introduction to Sprig. */
function Home() {
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-16 px-8 py-12">
        <header>
          <Link
            aria-label="Sprig home"
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            href="/"
          >
            <Wordmark />
          </Link>
        </header>

        <main className="my-auto grid w-full items-center gap-14 md:grid-cols-[minmax(0,1fr)_auto] md:gap-16">
          <div className="flex max-w-xl flex-col items-start gap-5">
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Grow an idea into a map you can see.
            </h1>
            <p className="text-lg leading-relaxed text-muted-foreground">
              Start with one thought, branch it as far as it goes, and keep the
              whole shape of your thinking in view.
            </p>
            {/* Dynamic island: the CTA depends on the request's session, so it
                is the only part of this page that is not prerendered. */}
            <Suspense
              fallback={
                <Button disabled type="button">
                  Checking account…
                </Button>
              }
            >
              <LandingAuthCta />
            </Suspense>
          </div>
          <div className="flex justify-start md:justify-end">
            <MindmapGlyph />
          </div>
        </main>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-6">
          <Wordmark className="text-xs" />
          <p className="text-sm text-muted-foreground">
            Grow and organize ideas.
          </p>
        </footer>
      </div>
    </div>
  );
}

export { Home as default };
