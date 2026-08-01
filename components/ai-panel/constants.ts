/**
 * Shared geometry and storage identity for the Sprig AI panel.
 *
 * Sizes are expressed in pixels because the panel holds prose and a chat
 * input, whose comfortable measure does not scale with the viewport. The
 * layout converts them to the percentages react-resizable-panels works in.
 */

import {
  APP_PANEL_INSET_PX,
  APP_PANEL_WIDTH_PX,
} from "@/components/app-shell/panel-geometry";

/**
 * Space the resizable column spends on gutters rather than on the card.
 *
 * The column is what react-resizable-panels sizes; the card inside it is
 * inset by the shared edge inset on the right and a hairline gutter on the
 * left, where the drag seam lives. Every pixel constraint below is therefore
 * a card width plus this, so a "340px panel" really measures 340px on screen.
 */
const AI_PANEL_GUTTER_PX = APP_PANEL_INSET_PX + 4;

/**
 * Resting width of the panel the first time a writer opens a canvas: the one
 * shared app-shell panel width, matching the navigation panel opposite it.
 */
const AI_PANEL_DEFAULT_WIDTH_PX = APP_PANEL_WIDTH_PX + AI_PANEL_GUTTER_PX;

/** Below this the chat input stops holding a readable line of prose. */
const AI_PANEL_MIN_WIDTH_PX = 300 + AI_PANEL_GUTTER_PX;

/** Above this the panel starts competing with the canvas for attention. */
const AI_PANEL_MAX_WIDTH_PX = 560 + AI_PANEL_GUTTER_PX;

/**
 * Percentage constraints used for the single frame before the panel group has
 * been measured, and in environments without a layout engine at all.
 */
const AI_PANEL_FALLBACK_CONSTRAINTS = {
  defaultSize: 25,
  minSize: 22,
  maxSize: 40,
} as const;

/** Response header the chat route uses to publish the persisted thread id. */
const THREAD_ID_HEADER = "x-sprig-thread-id";

/**
 * How long a node keeps the bloom pulse after the model touches it.
 *
 * Slightly longer than the 1600ms animation in `flow.css` so the class is
 * removed after the pulse has settled rather than mid-flight.
 */
const AI_TOUCH_DURATION_MS = 1_800;

export {
  AI_PANEL_DEFAULT_WIDTH_PX,
  AI_PANEL_FALLBACK_CONSTRAINTS,
  AI_PANEL_GUTTER_PX,
  AI_PANEL_MAX_WIDTH_PX,
  AI_PANEL_MIN_WIDTH_PX,
  AI_TOUCH_DURATION_MS,
  THREAD_ID_HEADER,
};
