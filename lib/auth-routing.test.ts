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
    ["/", true],
    ["/share", true],
    ["/share/public-map", true],
    ["/robots.txt", true],
    ["/sitemap.xml", true],
    ["/favicon.ico", true],
    ["/opengraph-image", true],
    ["/opengraph-image-abc123", true],
    ["/maps", false],
    ["/maps/private-map", false],
    ["/new", false],
    ["/sign-invitation", false],
    ["/shared", false],
    ["/robots.txt/private", false],
    ["/sitemap.xml/private", false],
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
    // control characters: browsers strip tab/newline/CR before resolution,
    // so these would otherwise smuggle a protocol-relative URL past the checks
    ["/\n/evil.com", "/"],
    ["/\t\\evil.com", "/"],
    ["/a\rb", "/"],
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
