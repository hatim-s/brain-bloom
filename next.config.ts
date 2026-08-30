import type { NextConfig } from "next";
import { homedir } from "node:os";

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  turbopack: {
    root: homedir(),
  },
  // Both subscription SDKs bundle platform-specific runtimes. Keep them in
  // Node.js instead of asking Turbopack to crawl every optional native build.
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@openai/codex-sdk",
  ],
};

export default nextConfig;
