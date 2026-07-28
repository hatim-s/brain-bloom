/*
 * Decorative dot field. It is the same grid the mindmap canvas draws, so the
 * auth pages read as the edge of the product rather than a separate site.
 *
 * The mask is an alpha channel, not a colour: `#000` here means "fully opaque
 * mask" and never paints a pixel, so the visible dots stay on --canvas-dot.
 */
const DOT_FIELD_MASK =
  "radial-gradient(ellipse 62% 58% at 50% 46%, #000 0%, transparent 100%)";

const dotFieldStyle = {
  backgroundImage: "radial-gradient(var(--canvas-dot) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
  maskImage: DOT_FIELD_MASK,
  WebkitMaskImage: DOT_FIELD_MASK,
};

/**
 * Frame shared by every unauthenticated route.
 *
 * A single centred column on the page surface: wordmark, then one card held by
 * a hairline. The card is the only raised-feeling thing on the page, and it is
 * raised by a line rather than a shadow, matching the rest of the product.
 */
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex h-svh w-full items-center justify-center overflow-y-auto px-6 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={dotFieldStyle}
      />
      <div className="relative flex w-full max-w-md flex-col gap-8">
        <div className="flex flex-col items-center gap-1.5">
          <span className="flex items-center gap-2.5 font-mono text-sm uppercase tracking-[0.28em] text-foreground">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-primary"
            />
            {/* The negative margin eats the trailing letter-space so the
                wordmark optically centres against the tagline below it. */}
            <span className="-mr-[0.28em]">Sprig</span>
          </span>
          <p className="text-center text-sm text-muted-foreground">
            Grow and organize ideas.
          </p>
        </div>
        <div className="rounded-lg border border-line-strong bg-card p-8 text-card-foreground">
          {children}
        </div>
      </div>
    </main>
  );
}
