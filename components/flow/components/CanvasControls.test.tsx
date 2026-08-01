// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";

import { CanvasControls } from "./CanvasControls";

// The sheet only reads the camera; jsdom has no flow instance to give it.
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomTo: vi.fn(),
  }),
  useViewport: () => ({ zoom: 1 }),
}));

beforeAll(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

/** The sheet itself, reached through one of the keys it holds. */
function getSheet(): HTMLElement {
  const sheet = screen.getByRole("button", { name: "Zoom out" }).parentElement;

  if (sheet === null) {
    throw new Error("The camera sheet was not rendered");
  }

  return sheet;
}

describe("CanvasControls", () => {
  it("keeps the viewport inset where there is no navigation panel", () => {
    // The public share route renders the canvas outside the app shell, so the
    // sheet must not require a provider to exist.
    render(<CanvasControls />);

    expect(getSheet().className).toContain("left-[var(--panel-inset,1rem)]");
    expect(getSheet().className).not.toContain(
      "md:left-[var(--sidebar-width)]"
    );
  });

  it("steps clear of the navigation panel's track while it is open", () => {
    render(
      <SidebarProvider open>
        <CanvasControls />
      </SidebarProvider>
    );

    expect(getSheet().className).toContain("md:left-[var(--sidebar-width)]");
  });

  it("returns to the viewport inset when the panel closes", () => {
    render(
      <SidebarProvider open={false}>
        <CanvasControls />
      </SidebarProvider>
    );

    expect(getSheet().className).not.toContain(
      "md:left-[var(--sidebar-width)]"
    );
  });
});
