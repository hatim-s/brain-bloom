// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";

import { SidebarNotch } from "./sidebar-notch";

beforeAll(() => {
  // The provider's responsive hook reads matchMedia, which jsdom does not ship.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

describe("SidebarNotch", () => {
  it("offers a named way in while the panel is closed", async () => {
    const user = userEvent.setup();
    const handleOpenChange = vi.fn();

    render(
      <SidebarProvider open={false} onOpenChange={handleOpenChange}>
        <SidebarNotch />
      </SidebarProvider>
    );

    await user.click(screen.getByRole("button", { name: "Open sidebar" }));

    expect(handleOpenChange).toHaveBeenCalledWith(true);
  });

  it("stays mounted but unreachable once the panel is open", () => {
    render(
      <SidebarProvider open>
        <SidebarNotch />
      </SidebarProvider>
    );

    // The tab cross-fades out rather than unmounting, so it must not remain in
    // the accessibility tree or the tab order beside the panel it stands in for.
    expect(screen.queryByRole("button", { name: "Open sidebar" })).toBeNull();

    const notch = screen.getByLabelText("Open sidebar", { selector: "button" });

    expect(notch.getAttribute("aria-hidden")).toBe("true");
    expect(notch.getAttribute("tabindex")).toBe("-1");
  });
});
