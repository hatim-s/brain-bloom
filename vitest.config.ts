import react from "@vitejs/plugin-react";
import reactCompiler from "babel-plugin-react-compiler";
import { configDefaults, defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import path from "node:path";

const nodeRequire = createRequire(import.meta.url);
const { transformAsync } = nodeRequire("next/dist/compiled/babel/core") as {
  transformAsync: (
    code: string,
    options: Record<string, unknown>
  ) => Promise<{
    code?: string | null;
    map?: {
      file?: string;
      mappings: string;
      names: string[];
      sourceRoot?: string;
      sources: string[];
      sourcesContent?: Array<string | null>;
      version: number;
    } | null;
  } | null>;
};

export default defineConfig({
  plugins: [
    {
      name: "react-compiler",
      enforce: "pre",
      async transform(code, id) {
        if (!/\.[jt]sx?$/.test(id)) return null;

        const result = await transformAsync(code, {
          babelrc: false,
          configFile: false,
          filename: id,
          parserOpts: { plugins: ["typescript", "jsx"] },
          plugins: [[reactCompiler, {}]],
          sourceMaps: true,
        });

        return result?.code
          ? { code: result.code, map: result.map ?? null }
          : null;
      },
    },
    react(),
  ],
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "**/.next/**", "**/dist/**"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
