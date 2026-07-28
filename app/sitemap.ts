import type { MetadataRoute } from "next";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

/** Lists intentionally discoverable static pages. */
function sitemap(): MetadataRoute.Sitemap {
  // Shared maps are capability links and remain unlisted by design.
  return [{ url: defaultUrl }];
}

export { sitemap as default };
