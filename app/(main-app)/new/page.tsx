import type { CSSProperties } from "react";

import { AIMindmapInput } from "@/components/new-ai-mindmap";

/**
 * Canopy light pooling on the forest ground under the composer.
 *
 * The Never Flat Rule: this page is a full viewport of bare ground, so it earns
 * one layer of depth before content lands on it. Two stacked radials mixed from
 * the moss primary at 6% and 4%, fading out to nothing so the page ground shows
 * through at the edges. Everything is built from theme vars, so the pool follows
 * the forest ground in dark and the bone paper in light with no second
 * definition — and no literal color anywhere.
 *
 * The vertical anchor (~54%) is where the composer sits in the centred column:
 * header above it, example chips below it.
 */
const CANOPY_LIGHT_STYLE: CSSProperties = {
  backgroundImage: [
    "radial-gradient(46% 30% at 50% 54%, color-mix(in oklab, var(--primary) 6%, transparent), transparent 70%)",
    "radial-gradient(78% 52% at 50% 60%, color-mix(in oklab, var(--primary) 4%, transparent), transparent 72%)",
  ].join(", "),
};

/**
 * Entry point for generating a new mindmap from a written prompt.
 *
 * The page is the prompt: one centred column, a sentence of orientation, and
 * the composer standing in its pool of light. Nothing else competes for the
 * screen, because every step between arriving here and having a map is a
 * regression.
 */
function NewMindmapPage() {
  return (
    <main
      className={[
        "h-full w-full overflow-y-auto",
        // The panel floats over the page, so the column steps aside for it
        // instead of being covered by it.
        "transition-[padding] duration-300 ease-settle motion-reduce:transition-none",
        "md:peer-data-[state=expanded]:pl-[var(--sidebar-width)]",
      ].join(" ")}
    >
      {/* Pinned to the viewport rather than to the scroll box: light does not
          scroll, and an in-flow layer sized past this container would lengthen
          the page by the size of its own falloff. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={CANOPY_LIGHT_STYLE}
      />

      <div className="relative mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-10 px-5 py-20 sm:px-8 sm:py-24">
        <header className="flex flex-col gap-3">
          <h1 className="text-[2rem] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[2.5rem]">
            Start with one idea.
          </h1>
          <p className="max-w-[46ch] text-base leading-relaxed text-muted-foreground">
            Write what you want to think through. Sprig grows it into a map you
            can explore, extend and reshape.
          </p>
        </header>

        <AIMindmapInput />
      </div>
    </main>
  );
}

export { NewMindmapPage as default };
