/*
 * Decorative dot field. It is the same grid the mindmap canvas draws, so the
 * pages outside the app (auth, 404) read as the edge of the product rather
 * than a separate site.
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
 * Fills its nearest positioned ancestor with the canvas dot grid.
 *
 * Purely decorative and inert: it is hidden from assistive technology and
 * never intercepts a pointer event.
 */
function DotField() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={dotFieldStyle}
    />
  );
}

export { DotField };
