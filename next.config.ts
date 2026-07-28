import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  // The Agent SDK bundles a platform-specific Claude Code runtime. Keep it in
  // Node.js instead of asking Turbopack to crawl every optional native build.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
