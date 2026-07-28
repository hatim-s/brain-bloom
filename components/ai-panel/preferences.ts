/**
 * Browser-local persistence for the AI panel's open state and width.
 *
 * Every read and write is guarded twice: once for server rendering, where
 * `localStorage` does not exist, and once for browsers that expose the API but
 * throw on access (private modes, storage-partitioned iframes). A panel that
 * cannot remember its width is a smaller problem than a canvas that will not
 * render, so all failures degrade to the default.
 */

const AI_PANEL_OPEN_STORAGE_KEY = "sprig:ai-panel:open";
const AI_PANEL_WIDTH_STORAGE_KEY = "sprig:ai-panel:width-px";

type AiPanelPreferences = {
  /** `null` when the writer has never expressed a preference. */
  isOpen: boolean | null;
  /** `null` when the writer has never resized the panel. */
  widthPx: number | null;
};

/** Returns the storage object only where it is actually usable. */
function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Reads both panel preferences, treating any malformed value as absent. */
function readAiPanelPreferences(): AiPanelPreferences {
  const storage = getStorage();

  if (storage === null) {
    return { isOpen: null, widthPx: null };
  }

  try {
    const storedOpen = storage.getItem(AI_PANEL_OPEN_STORAGE_KEY);
    const storedWidth = Number(storage.getItem(AI_PANEL_WIDTH_STORAGE_KEY));

    return {
      isOpen:
        storedOpen === "true" ? true : storedOpen === "false" ? false : null,
      widthPx:
        Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : null,
    };
  } catch {
    return { isOpen: null, widthPx: null };
  }
}

/** Persists whether the panel is expanded. */
function writeAiPanelOpen(isOpen: boolean): void {
  try {
    getStorage()?.setItem(AI_PANEL_OPEN_STORAGE_KEY, String(isOpen));
  } catch {
    // A panel that forgets its state is not worth failing a render over.
  }
}

/** Persists the panel's width in pixels. */
function writeAiPanelWidth(widthPx: number): void {
  try {
    getStorage()?.setItem(
      AI_PANEL_WIDTH_STORAGE_KEY,
      String(Math.round(widthPx))
    );
  } catch {
    // See writeAiPanelOpen.
  }
}

export {
  AI_PANEL_OPEN_STORAGE_KEY,
  AI_PANEL_WIDTH_STORAGE_KEY,
  type AiPanelPreferences,
  readAiPanelPreferences,
  writeAiPanelOpen,
  writeAiPanelWidth,
};
