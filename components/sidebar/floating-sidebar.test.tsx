// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { MindmapDB } from "@/types/Mindmap";

import { FloatingSidebar } from "./floating-sidebar";

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

beforeAll(() => {
  // The panel's responsive hook reads matchMedia, which jsdom does not ship.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

/** Renders the panel open, which is where its list is actually visible. */
function renderSidebar(props: { loadFailed?: boolean; mindmaps: MindmapDB[] }) {
  return render(
    <SidebarProvider open>
      <FloatingSidebar {...props} />
    </SidebarProvider>
  );
}

/** Builds the minimum row shape the panel reads off a map. */
function createMindmap(name: string, publicId: string): MindmapDB {
  return { _id: publicId, name, publicId } as unknown as MindmapDB;
}

describe("FloatingSidebar", () => {
  it("lists the maps the user owns", () => {
    renderSidebar({ mindmaps: [createMindmap("Photosynthesis", "abc")] });

    expect(
      screen.getAllByRole("link", { name: "Photosynthesis" }).length
    ).toBeGreaterThan(0);
  });

  it("invites a first map only when the list really is empty", () => {
    renderSidebar({ mindmaps: [] });

    expect(
      screen.getAllByText(
        /No maps yet\. The first one you grow shows up here\./
      ).length
    ).toBeGreaterThan(0);
  });

  it("closes from inside itself, the way the Sprig panel does", () => {
    renderSidebar({ mindmaps: [] });

    expect(
      screen.getAllByRole("button", { name: "Close sidebar" }).length
    ).toBeGreaterThan(0);
  });

  it("says the list failed to load instead of claiming there are no maps", () => {
    renderSidebar({ loadFailed: true, mindmaps: [] });

    expect(
      screen.getAllByText(/Couldn’t load your maps — refresh to retry\./).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/No maps yet/)).toBeNull();
  });
});
