import type { MetadataRoute } from "next";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

/** Publishes crawl rules for public discovery and private application routes. */
function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/share/"],
      disallow: ["/maps", "/new"],
    },
    sitemap: `${defaultUrl}/sitemap.xml`,
  };
}

export { robots as default };
