import Link from "next/link";

import { DotField } from "@/components/dot-field";
import { Wordmark } from "@/components/wordmark";

/**
 * Canopy light over the auth ground.
 *
 * The Never Flat Rule: a full-viewport surface earns one layer of depth before
 * content lands on it. Two very low-alpha moss fields — light spilling in from
 * above the fold, a deeper pool of shade gathering at the bottom — mixed from
 * --primary so both themes resolve live and no hex is pinned here. Standing at
 * the edge of the forest, looking in.
 */
const CANOPY_STYLE = {
  backgroundImage: [
    "radial-gradient(120% 78% at 50% -12%, color-mix(in oklab, var(--primary) 9%, transparent) 0%, transparent 64%)",
    "radial-gradient(96% 62% at 50% 112%, color-mix(in oklab, var(--primary) 5%, transparent) 0%, transparent 72%)",
  ].join(", "),
};

/**
 * Frame shared by every unauthenticated route.
 *
 * Identity above, a quiet reassurance below, and the grove ground behind the
 * whole thing — one soft moss canopy layer with the canvas dot field fading out
 * over it — so the door reads as part of the product rather than a separate
 * site. The Clerk widget brings its own themed card (appearance is set globally
 * on ClerkProvider) and the hand-rolled forms carry their own sheet, so the
 * layout supplies only ground and column; wrapping either in a second sheet
 * would double-card it.
 *
 * The scroll container is deliberately `min-h-full` + `items-center` rather
 * than auto margins: a tall form (sign-up verification at 375px) then grows the
 * flex line instead of overflowing past the top edge where it cannot be reached.
 */
function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative h-svh w-full overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={CANOPY_STYLE}
      />
      <DotField />
      <div className="relative h-full w-full overflow-y-auto">
        <div className="flex min-h-full items-center justify-center px-5 py-12 sm:px-6 sm:py-16">
          <div className="flex w-full max-w-[26rem] flex-col items-center gap-6">
            <Link
              aria-label="Sprig home"
              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
              href="/"
            >
              <Wordmark />
            </Link>

            {children}

            <p className="text-center text-[0.8125rem] leading-relaxed text-muted-foreground">
              Your maps stay private until you choose to share them.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export { AuthLayout as default };
