/*
 * Decorative dot field. It is literally the grid the mindmap canvas draws —
 * a 28px pitch of 1.5px dots on --canvas-dot, matching Flow's `<Background
 * gap={28} size={1.5} />` — so the pages outside the app (auth, 404, a shared
 * map that is still streaming) read as the edge of the product rather than a
 * separate site.
 *
 * The mask is an alpha channel, not a colour: `#000` here means "fully opaque
 * mask" and never paints a pixel, so the visible dots stay on --canvas-dot.
 * It holds flat across a slightly wider middle before falling away over a long
 * ramp, so the grid dissolves into the grove ground — deep forest at night,
 * warm bone by day — instead of ending on a visible ring.
 */
const DOT_FIELD_MASK =
  "radial-gradient(ellipse 76% 68% at 50% 44%, #000 0%, #000 38%, transparent 100%)";

const dotFieldStyle = {
  backgroundImage:
    "radial-gradient(var(--canvas-dot) 0.75px, transparent 0.75px)",
  backgroundSize: "28px 28px",
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
