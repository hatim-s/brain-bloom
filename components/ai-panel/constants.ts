/**
 * Shared geometry and storage identity for the Sprig AI panel.
 *
 * Sizes are expressed in pixels because the panel holds prose and a chat
 * input, whose comfortable measure does not scale with the viewport. The
 * layout converts them to the percentages react-resizable-panels works in.
 */

/** Resting width of the panel the first time a writer opens a canvas. */
const AI_PANEL_DEFAULT_WIDTH_PX = 380;

/** Below this the chat input stops holding a readable line of prose. */
const AI_PANEL_MIN_WIDTH_PX = 320;

/** Above this the panel starts competing with the canvas for attention. */
const AI_PANEL_MAX_WIDTH_PX = 560;

/**
 * Percentage constraints used for the single frame before the panel group has
 * been measured, and in environments without a layout engine at all.
 */
const AI_PANEL_FALLBACK_CONSTRAINTS = {
  defaultSize: 26,
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
  AI_PANEL_MAX_WIDTH_PX,
  AI_PANEL_MIN_WIDTH_PX,
  AI_TOUCH_DURATION_MS,
  THREAD_ID_HEADER,
};
