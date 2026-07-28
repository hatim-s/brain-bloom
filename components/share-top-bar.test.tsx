// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ShareTopBar } from "./share-top-bar";

afterEach(() => {
  cleanup();
});

/** Verifies the public chrome that frames a read-only shared canvas. */
describe("ShareTopBar", () => {
  it("names the product, the map, and the read-only state", () => {
    render(<ShareTopBar mindmapName="Photosynthesis" />);

    const home = screen.getByRole("link", { name: "Sprig home" });
    expect(home).toHaveProperty("href", expect.stringMatching(/\/$/));
    expect(home.textContent).toContain("Sprig");

    expect(
      screen.getByRole("heading", { level: 1, name: "Photosynthesis" })
    ).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
  });
});
