import type { CSSProperties } from "react";

/**
 * The one geometry the app shell's floating panels are drawn to.
 *
 * The navigation panel (left) and the Sprig panel (right) are the same object
 * seen twice, so they may only ever be described once: one width, one edge
 * inset, one top inset. Every consumer — CSS or JS — reads these numbers from
 * here rather than restating them, which is what kept the two panels drifting
 * apart (different widths, different tops, different heights).
 *
 * The values are published to CSS as custom properties by `SidebarProvider`
 * (see `components/ui/sidebar.tsx`), so stylesheet consumers use
 * `var(--panel-width)` / `var(--panel-inset)` / `var(--panel-top-inset)` and
 * still resolve to these exact numbers.
 */

/** Width of a floating app-shell panel's visible card, in pixels. */
const APP_PANEL_WIDTH_PX = 340;

/** Gap between a floating panel and the viewport edges it hugs, in pixels. */
const APP_PANEL_INSET_PX = 16;

/**
 * Distance from the top of the viewport to the top of both panels, in pixels.
 *
 * Larger than the edge inset because the shell reserves a chrome band up there:
 * the map's floating header bar, the sidebar toggle and the theme switcher all
 * live in it. Both panels clear that band by exactly the same amount, which is
 * the rule that makes them read as one system rather than two.
 */
const APP_PANEL_TOP_INSET_PX = 64;

/**
 * Track width the navigation panel occupies: the card plus its two side insets.
 *
 * Chrome that has to step aside for the open panel (the map header, the list
 * pages' content column, the sidebar toggle) measures against this, so the
 * panel's right edge and the next thing along are always one inset apart.
 */
const APP_SIDEBAR_TRACK_WIDTH_PX = APP_PANEL_WIDTH_PX + APP_PANEL_INSET_PX * 2;

/**
 * The collapsed panel's edge notch: width, height and distance from the top.
 *
 * Both panels collapse to the same slim tab hugging their own viewport edge —
 * the navigation panel's is the Sprig panel's mirror image — so the tab is
 * described once here and mirrored with rounding and offset alone. The top
 * clears the chrome band and the canvas's right rail (share + save), which is
 * seated on `APP_PANEL_TOP_INSET_PX`.
 */
const APP_PANEL_NOTCH_WIDTH_PX = 32;
const APP_PANEL_NOTCH_HEIGHT_PX = 36;
const APP_PANEL_NOTCH_TOP_PX = 112;

/**
 * Height of the floating chrome clusters in the shell's top band.
 *
 * The map title pill and the account pill are two compact islands rather than
 * one full-width bar, so nothing enforces a shared height for them but this
 * number. It also drives their vertical placement: the clusters are centred in
 * the band the panels clear (`APP_PANEL_TOP_INSET_PX`).
 */
const APP_CHROME_CLUSTER_HEIGHT_PX = 44;

/** Top offset that centres a chrome cluster inside the shell's top band. */
const APP_CHROME_CLUSTER_TOP_PX =
  (APP_PANEL_TOP_INSET_PX - APP_CHROME_CLUSTER_HEIGHT_PX) / 2;

/**
 * The panel geometry as CSS custom properties.
 *
 * Spread onto the app-shell wrapper so every descendant — panels, header,
 * notches, canvas chrome — can position against the same numbers without
 * importing anything.
 */
const APP_PANEL_CSS_VARS = {
  "--chrome-cluster-height": `${APP_CHROME_CLUSTER_HEIGHT_PX}px`,
  "--chrome-cluster-top": `${APP_CHROME_CLUSTER_TOP_PX}px`,
  "--panel-inset": `${APP_PANEL_INSET_PX}px`,
  "--panel-notch-height": `${APP_PANEL_NOTCH_HEIGHT_PX}px`,
  "--panel-notch-top": `${APP_PANEL_NOTCH_TOP_PX}px`,
  "--panel-notch-width": `${APP_PANEL_NOTCH_WIDTH_PX}px`,
  "--panel-top-inset": `${APP_PANEL_TOP_INSET_PX}px`,
  "--panel-width": `${APP_PANEL_WIDTH_PX}px`,
} as CSSProperties;

export {
  APP_CHROME_CLUSTER_HEIGHT_PX,
  APP_CHROME_CLUSTER_TOP_PX,
  APP_PANEL_CSS_VARS,
  APP_PANEL_INSET_PX,
  APP_PANEL_NOTCH_HEIGHT_PX,
  APP_PANEL_NOTCH_TOP_PX,
  APP_PANEL_NOTCH_WIDTH_PX,
  APP_PANEL_TOP_INSET_PX,
  APP_PANEL_WIDTH_PX,
  APP_SIDEBAR_TRACK_WIDTH_PX,
};
