// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AI_PANEL_OPEN_STORAGE_KEY,
  AI_PANEL_WIDTH_STORAGE_KEY,
  readAiPanelPreferences,
  writeAiPanelOpen,
  writeAiPanelWidth,
} from "./preferences";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("AI panel preferences", () => {
  it("reports no preference before the writer has expressed one", () => {
    expect(readAiPanelPreferences()).toEqual({ isOpen: null, widthPx: null });
  });

  it("round-trips the open state and a whole-pixel width", () => {
    writeAiPanelOpen(false);
    writeAiPanelWidth(412.6);

    expect(readAiPanelPreferences()).toEqual({ isOpen: false, widthPx: 413 });
    expect(window.localStorage.getItem(AI_PANEL_OPEN_STORAGE_KEY)).toBe(
      "false"
    );
    expect(window.localStorage.getItem(AI_PANEL_WIDTH_STORAGE_KEY)).toBe("413");
  });

  it("treats malformed stored values as absent rather than throwing", () => {
    window.localStorage.setItem(AI_PANEL_OPEN_STORAGE_KEY, "yes");
    window.localStorage.setItem(AI_PANEL_WIDTH_STORAGE_KEY, "wide");

    expect(readAiPanelPreferences()).toEqual({ isOpen: null, widthPx: null });
  });

  it("degrades to the default when storage access throws", () => {
    // jsdom proxies the storage instance, so the prototype is the only seam.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Access denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Access denied");
    });

    expect(() => writeAiPanelOpen(true)).not.toThrow();
    expect(readAiPanelPreferences()).toEqual({ isOpen: null, widthPx: null });
  });
});
