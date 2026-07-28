// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AiPanelLayout, getPanelConstraints } from "./AiPanelLayout";
import {
  AI_PANEL_DEFAULT_WIDTH_PX,
  AI_PANEL_FALLBACK_CONSTRAINTS,
  AI_PANEL_MAX_WIDTH_PX,
  AI_PANEL_MIN_WIDTH_PX,
} from "./constants";
import { AI_PANEL_OPEN_STORAGE_KEY } from "./preferences";

// The panel's own contents need Convex and the AI SDK; the shell does not.
vi.mock("./AiPanel", () => ({
  AiPanel: ({ onCollapse }: { onCollapse: () => void }) => (
    <div data-testid="ai-panel">
      <button onClick={onCollapse} type="button">
        Collapse Sprig panel
      </button>
    </div>
  ),
}));

const CONTAINER_WIDTH = 1_440;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // jsdom has no layout engine, so the group would otherwise measure zero and
  // the pixel constraints would never leave their fallback.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: CONTAINER_WIDTH,
    height: 900,
    top: 0,
    left: 0,
    right: CONTAINER_WIDTH,
    bottom: 900,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("getPanelConstraints", () => {
  it("falls back to percentages before the group has been measured", () => {
    expect(getPanelConstraints(0, null)).toEqual({
      ...AI_PANEL_FALLBACK_CONSTRAINTS,
    });
  });

  it("expresses the pixel geometry as percentages of the measured group", () => {
    const constraints = getPanelConstraints(CONTAINER_WIDTH, null);

    expect((constraints.minSize / 100) * CONTAINER_WIDTH).toBeCloseTo(
      AI_PANEL_MIN_WIDTH_PX
    );
    expect((constraints.maxSize / 100) * CONTAINER_WIDTH).toBeCloseTo(
      AI_PANEL_MAX_WIDTH_PX
    );
    expect((constraints.defaultSize / 100) * CONTAINER_WIDTH).toBeCloseTo(
      AI_PANEL_DEFAULT_WIDTH_PX
    );
  });

  it("prefers a restored width, still bounded by the pixel geometry", () => {
    expect(
      (getPanelConstraints(CONTAINER_WIDTH, 500).defaultSize / 100) *
        CONTAINER_WIDTH
    ).toBeCloseTo(500);
    expect(
      (getPanelConstraints(CONTAINER_WIDTH, 5_000).defaultSize / 100) *
        CONTAINER_WIDTH
    ).toBeCloseTo(AI_PANEL_MAX_WIDTH_PX);
  });

  it("keeps min at or below max on a viewport too narrow for both", () => {
    const constraints = getPanelConstraints(400, null);

    expect(constraints.minSize).toBeLessThanOrEqual(constraints.maxSize);
    expect(constraints.defaultSize).toBeGreaterThanOrEqual(constraints.minSize);
    expect(constraints.defaultSize).toBeLessThanOrEqual(constraints.maxSize);
  });
});

describe("AiPanelLayout", () => {
  it("opens beside the canvas by default", () => {
    render(
      <AiPanelLayout>
        <div data-testid="canvas" />
      </AiPanelLayout>
    );

    expect(screen.getByTestId("canvas")).toBeDefined();
    expect(screen.getByTestId("ai-panel")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Open Sprig panel" })
    ).toBeNull();
  });

  it("collapses to a rail toggle and remembers the choice", async () => {
    const user = userEvent.setup();
    render(
      <AiPanelLayout>
        <div data-testid="canvas" />
      </AiPanelLayout>
    );

    await user.click(
      screen.getByRole("button", { name: "Collapse Sprig panel" })
    );

    expect(screen.queryByTestId("ai-panel")).toBeNull();
    expect(screen.getByTestId("canvas")).toBeDefined();
    expect(window.localStorage.getItem(AI_PANEL_OPEN_STORAGE_KEY)).toBe(
      "false"
    );

    await user.click(screen.getByRole("button", { name: "Open Sprig panel" }));

    expect(screen.getByTestId("ai-panel")).toBeDefined();
    expect(window.localStorage.getItem(AI_PANEL_OPEN_STORAGE_KEY)).toBe("true");
  });

  it("restores a stored collapsed state on mount", async () => {
    window.localStorage.setItem(AI_PANEL_OPEN_STORAGE_KEY, "false");

    render(
      <AiPanelLayout>
        <div data-testid="canvas" />
      </AiPanelLayout>
    );

    expect(
      await screen.findByRole("button", { name: "Open Sprig panel" })
    ).toBeDefined();
    expect(screen.queryByTestId("ai-panel")).toBeNull();
  });

  it("exposes a labelled separator so the seam is keyboard-resizable", () => {
    render(
      <AiPanelLayout>
        <div data-testid="canvas" />
      </AiPanelLayout>
    );

    expect(
      screen.getByRole("separator", { name: "Resize Sprig panel" })
    ).toBeDefined();
  });
});
