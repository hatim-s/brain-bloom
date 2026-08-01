import { Compass } from "lucide-react";
import Link from "next/link";

import { DotField } from "@/components/dot-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Wordmark } from "@/components/wordmark";

/**
 * Canopy light over the 404 ground.
 *
 * The same soft moss field the auth shell stands on, mixed from --primary so
 * both themes resolve live: a dead end is still somewhere in the grove, and the
 * Never Flat Rule does not take an exception for error pages.
 */
const CANOPY_STYLE = {
  backgroundImage: [
    "radial-gradient(120% 78% at 50% -12%, color-mix(in oklab, var(--primary) 9%, transparent) 0%, transparent 64%)",
    "radial-gradient(96% 62% at 50% 112%, color-mix(in oklab, var(--primary) 5%, transparent) 0%, transparent 72%)",
  ].join(", "),
};

/**
 * Global fallback for routes and map identifiers that do not resolve.
 *
 * It borrows the auth shell wholesale — moss canopy, dot field, centred column,
 * one raised sheet on the grove ground — because a 404 is still the product
 * talking, and the visitor most likely arrived from a shared link they cannot
 * open. The copy blames neither side (a share link can simply have been turned
 * off) and the card ends in the two ways forward: one moss action, one quiet.
 */
function NotFound() {
  return (
    <main className="relative h-svh w-full overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={CANOPY_STYLE}
      />
      <DotField />
      <div className="relative flex h-full w-full justify-center overflow-y-auto px-6 py-12">
        <div className="my-auto flex w-full max-w-md flex-col gap-8">
          <div className="flex flex-col items-center gap-1.5">
            <Wordmark />
            <p className="text-center text-sm text-muted-foreground">
              Grow and organize ideas.
            </p>
          </div>
          <Card className="p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4">
              {/* A sunken well with a hairline, not a coloured badge: the mark
                  orients the page without spending the accent on decoration. */}
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground"
              >
                <Compass className="size-5" />
              </span>
              {/* A technical value, so it keeps the mono voice — but plainly
                  set, not tracked out into a decorative tag. */}
              <span className="font-mono text-[0.8125rem] text-muted-foreground">
                404
              </span>
            </div>
            <h1 className="mt-6 text-[1.75rem] font-semibold leading-[1.2] tracking-[-0.02em]">
              We couldn&rsquo;t find that page
            </h1>
            <p className="mt-2 text-[0.9375rem] leading-[1.55] text-muted-foreground">
              The address may have changed, or the map behind this link may no
              longer be shared. Nothing of yours was lost.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button asChild>
                <Link href="/maps">Go to your maps</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/">Back to home</Link>
              </Button>
            </div>
            <p className="mt-6 border-t border-border pt-4 text-[0.8125rem] leading-[1.5] text-muted-foreground">
              If someone sent you this link, ask them for a fresh one — shared
              maps open for anyone who has the current link.
            </p>
          </Card>
        </div>
      </div>
    </main>
  );
}

export { NotFound as default };
