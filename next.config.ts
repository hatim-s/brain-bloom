import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  // Both subscription SDKs bundle platform-specific runtimes. Keep them in
  // Node.js instead of asking Turbopack to crawl every optional native build.
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@openai/codex-sdk",
  ],
};

export default nextConfig;
