// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Verifies the environment flag removes or exposes every OAuth control. */
describe("OAuthButtons", () => {
  it("renders no OAuth controls when the flag is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_OAUTH", "false");
    const { OAuthButtons } = await import("./oauth-buttons");
    const view = render(<OAuthButtons disabled={false} onSelect={vi.fn()} />);

    expect(view.container.childElementCount).toBe(0);
  });

  it("renders both providers when the flag is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_OAUTH", "true");
    const { OAuthButtons } = await import("./oauth-buttons");
    const view = render(<OAuthButtons disabled={false} onSelect={vi.fn()} />);

    expect(
      view.getByRole("button", { name: "Continue with Google" })
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Continue with GitHub" })
    ).toBeTruthy();
  });
});
