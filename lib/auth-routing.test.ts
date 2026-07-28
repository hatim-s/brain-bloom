import { describe, expect, it } from "vitest";

import {
  acceptsJsonOverHtml,
  isPublicPath,
  sanitizeRedirectUrl,
} from "./auth-routing";

/** Verifies the pure routing rules shared by the auth pages and request proxy. */
describe("auth routing", () => {
  it.each([
    ["/sign-in", true],
    ["/sign-in/sso-callback", true],
    ["/sign-up", true],
    ["/sign-up/verify", true],
    ["/", false],
    ["/sign-invitation", false],
    ["/api/chat", false],
  ])("matches public path %s as %s", (pathname, expected) => {
    expect(isPublicPath(pathname)).toBe(expected);
  });

  it.each([
    ["/mindmaps/sprig?panel=chat", "/mindmaps/sprig?panel=chat"],
    [null, "/"],
    ["https://example.com", "/"],
    ["//example.com", "/"],
    ["/\\example.com", "/"],
    ["dashboard", "/"],
  ])("sanitizes redirect destination %s", (destination, expected) => {
    expect(sanitizeRedirectUrl(destination)).toBe(expected);
  });

  it("detects when JSON has a higher Accept quality than HTML", () => {
    expect(
      acceptsJsonOverHtml("text/html;q=0.5, application/problem+json;q=0.9")
    ).toBe(true);
    expect(acceptsJsonOverHtml("text/html, application/json;q=0.5")).toBe(
      false
    );
  });
});
