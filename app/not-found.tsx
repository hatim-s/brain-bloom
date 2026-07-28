import Link from "next/link";

import { DotField } from "@/components/dot-field";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

/**
 * Global fallback for routes and map identifiers that do not resolve.
 *
 * It borrows the auth shell wholesale — dot field, centred column, one card
 * held by a hairline — because a 404 is still the product talking, and the
 * visitor most likely arrived here from a shared link they cannot open.
 */
function NotFound() {
  return (
    <main className="relative h-svh w-full overflow-hidden">
      <DotField />
      <div className="relative flex h-full w-full justify-center overflow-y-auto px-6 py-12">
        <div className="my-auto flex w-full max-w-md flex-col gap-8">
          <div className="flex flex-col items-center gap-1.5">
            <Wordmark />
            <p className="text-center text-sm text-muted-foreground">
              Grow and organize ideas.
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-line-strong bg-card p-8 text-card-foreground">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              404
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Nothing grows here
            </h1>
            <p className="text-sm text-muted-foreground">
              The page may have moved, or the map behind this link may no longer
              be shared.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button asChild>
                <Link href="/">Back to home</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/maps">Your maps</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export { NotFound as default };
