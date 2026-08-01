import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Suspense } from "react";

import { ConversationDemo } from "@/components/landing/conversation-demo";
import { DepthChain } from "@/components/landing/depth-chain";
import { HeroMapDemo } from "@/components/landing/hero-map-demo";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

/*
 * Direction contract — The Grove, canvas canon played straight in the dark.
 *
 * THESIS: the product demonstrates itself; a real prompt grows a real map in
 * the first viewport and keeps breathing there on a slow ambient loop. Refuses
 * the icon-card feature grid.
 * OWN-WORLD: a deep forest ground carrying canopy atmosphere and a whisper of
 * grain; warm ivory type tight-tracked on top of it; moss green is the one
 * voice of action; clay marks only where the model touched the map; shadows are
 * forest ink falling from one soft overhead light.
 * STORY: a learner sees their question become structure, believes growth is
 * conversational and deep, and signs in.
 * FIRST VIEWPORT: a centered hook standing in a soft clearing of canopy light,
 * one moss action, and beneath it an elevated canvas sheet where the
 * photosynthesis map grows and settles.
 * FORM: canon canvas-tool landing (user's standing canon commitment) staged on
 * the product's own canvas. Scrolling descends through layered ground rather
 * than past hairlines: atmospheric clearing, a lifted band, a sheet standing on
 * the bare ground, then the closing clearing. Nothing here is flat.
 */

/** Resolves the request-specific landing action without blocking the shell. */
async function LandingAuthCta({
  size,
  variant,
}: {
  size?: "default" | "lg";
  variant?: "default" | "outline";
}) {
  const { userId } = await auth();

  return (
    <Button asChild size={size} variant={variant}>
      <Link href={userId ? "/maps" : "/sign-in"}>
        {userId ? "Open your maps" : "Sign in"}
      </Link>
    </Button>
  );
}

/**
 * Suspense-wrapped CTA so each placement stays statically prerenderable.
 * The header placement is an outline so only the hero and the close carry
 * moss — one saturated voice per viewport.
 */
function AuthCta({
  size,
  variant,
}: {
  size?: "default" | "lg";
  variant?: "default" | "outline";
}) {
  return (
    <Suspense
      fallback={
        <Button disabled size={size} type="button" variant={variant}>
          Checking account…
        </Button>
      }
    >
      <LandingAuthCta size={size} variant={variant} />
    </Suspense>
  );
}

/**
 * The reading column. Every band is full-bleed so its tonal field can run edge
 * to edge; the copy inside each one lands on this shared measure.
 */
const COLUMN = "mx-auto w-full max-w-5xl px-6 sm:px-8";

/**
 * A section sheet: the raised surface a passage of copy and its demo stand on,
 * lifted off whatever band it sits in. Hero-family radius per the shapes scale.
 */
const SHEET =
  "overflow-hidden rounded-[22px] border border-border bg-card shadow-floating";

/**
 * The well inside a sheet — a tonal step back down, so the demo reads as
 * something looked into rather than another flat panel.
 */
const WELL = "border-t border-border bg-background/50";

/** Public, statically prerenderable introduction to Sprig. */
function Home() {
  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      {/* The forest floor. `sprig-atmosphere` rides a content-height wrapper
          rather than the scroll container so its canopy gradient and grain span
          the whole page instead of only the first screenful. */}
      <div className="sprig-atmosphere flex min-h-full flex-col">
        <div className={COLUMN}>
          {/* Right padding clears the globally-fixed ThemeSwitcher, which sits
              in the same row until the centered container's margin exceeds the
              switcher strip (~1136px); xl releases it. */}
          <header className="flex items-center justify-between py-6 pr-[calc(var(--theme-switcher-inset)+1.25rem)] xl:pr-0">
            <Link
              aria-label="Sprig home"
              className="inline-flex rounded-sm"
              href="/"
            >
              <Wordmark />
            </Link>
            <AuthCta variant="outline" />
          </header>
        </div>

        <main className="flex flex-col">
          {/* Band 1 — the lit clearing. The hook, one action, and the product
              proving itself on an elevated canvas sheet. */}
          <section className={`${COLUMN} pb-24 pt-14 sm:pb-28 sm:pt-20`}>
            <div className="relative flex flex-col items-center gap-14 sm:gap-16">
              {/* Canopy light pooling behind the display type, so the h1 stands
                  in a clearing instead of on a bare field. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 -top-20 h-[24rem] bg-[radial-gradient(52%_58%_at_50%_42%,var(--card),transparent_70%)] opacity-70"
              />

              <div className="relative flex max-w-2xl flex-col items-center gap-5 text-center">
                <h1 className="text-balance text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
                  Turn one question into a map of understanding.
                </h1>
                <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
                  Sprig asks a real AI agent to think your topic through, then
                  draws the whole shape of it — branch by branch, ready to
                  explore.
                </p>
                <AuthCta size="lg" />
              </div>

              {/* The canvas frame: a raised sheet under overhead light, kept a
                  tonal step *below* the node cards inside it so the map still
                  reads as clearings on a ground. */}
              <div className="relative w-full overflow-hidden rounded-[22px] border border-border bg-card/35 shadow-floating">
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-[radial-gradient(var(--canvas-dot)_1px,transparent_1px)] bg-[size:24px_24px]"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_-12%,var(--card),transparent_62%)] opacity-60"
                />
                {/* The lit top edge of the sheet. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-card"
                />
                <div className="relative px-2 py-6 sm:px-8 sm:py-12">
                  <HeroMapDemo />
                </div>
              </div>
            </div>
          </section>

          {/* Band 2 — a lifted tonal field. Conversational growth, shown as the
              exchange it actually is. */}
          <section className="border-y border-border bg-card/40 py-20 sm:py-24">
            <div className={COLUMN}>
              <div className={SHEET}>
                <div className="px-6 pb-8 pt-10 sm:px-10 sm:pb-9 sm:pt-12">
                  <div className="flex max-w-xl flex-col gap-3">
                    <h2 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
                      Grow it by talking to it.
                    </h2>
                    <p className="leading-relaxed text-muted-foreground">
                      Every branch is a conversation away. Ask for depth where
                      you need it and Sprig extends the map in place — it never
                      regenerates what you have already built.
                    </p>
                  </div>
                </div>
                <div className={`${WELL} px-6 py-10 sm:px-10 sm:py-12`}>
                  <ConversationDemo />
                </div>
              </div>
            </div>
          </section>

          {/* Band 3 — back down onto the bare ground, lit from one corner, with
              the sheet standing on it. Depth demonstrated as one followed path. */}
          <section className="relative py-20 sm:py-24">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(65%_95%_at_12%_0%,var(--card),transparent_68%)] opacity-45"
            />
            <div className={`relative ${COLUMN}`}>
              <div className={SHEET}>
                <div className="px-6 pb-8 pt-10 sm:px-10 sm:pb-9 sm:pt-12">
                  <div className="flex max-w-xl flex-col gap-3">
                    <h2 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
                      Depth, not decoration.
                    </h2>
                    <p className="leading-relaxed text-muted-foreground">
                      Generation runs on a real coding agent — the same
                      multi-step reasoning that plans software plans your map.
                      Branches follow the actual structure of a topic, and keep
                      going until it makes sense.
                    </p>
                  </div>
                </div>
                <div className={`${WELL} px-6 py-10 sm:px-10 sm:py-12`}>
                  <DepthChain />
                </div>
              </div>
            </div>
          </section>

          {/* Band 4 — the close: its own clearing in the atmosphere, one moss
              action, nothing else competing. */}
          <section className="sprig-atmosphere border-t border-border py-24 sm:py-32">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(48%_62%_at_50%_34%,var(--popover),transparent_72%)] opacity-55"
            />
            <div
              className={`relative flex flex-col items-center gap-6 text-center ${COLUMN}`}
            >
              <h2 className="text-balance text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">
                Give a topic room to grow.
              </h2>
              <p className="max-w-md text-pretty leading-relaxed text-muted-foreground">
                Your first map is a single prompt away.
              </p>
              <AuthCta size="lg" />
            </div>
          </section>
        </main>

        <div className={COLUMN}>
          <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border py-8">
            <Wordmark className="text-sm" />
            <p className="text-sm text-muted-foreground">
              Runs on your own Claude Code or Codex subscription — no hosted
              keys.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export { Home as default };
