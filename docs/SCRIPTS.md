# Package scripts

| Script | What it does | When to use it |
| --- | --- | --- |
| `dev` | Starts the Next.js development server. The explicit `--turbopack` flag documents the Next.js 16 default. | Use during local application development. |
| `build` | Creates an optimized production build. The explicit `--turbopack` flag documents the Next.js 16 default. | Use before deploying or verifying production compilation. |
| `start` | Starts the Next.js production server using an existing build. | Use to run the output of `pnpm build`. |
| `typegen` | Generates Next's route validators into `.next/types` without a full build. | Run before `typecheck` on a clean checkout — the validators only exist once generated, and `typecheck` silently skips page, layout, and route-handler prop validation without them. CI runs this ahead of `typecheck` for that reason. |
| `typecheck` | Runs TypeScript without emitting files and skips checking dependency declaration files. | Use after TypeScript changes and before review. Pair with `typegen` on a clean checkout. |
| `test` | Runs all Vitest unit tests once. | Use for local and CI verification. |
| `test:watch` | Runs Vitest in watch mode. | Use while developing or updating unit tests. |
| `test:coverage` | Runs all Vitest tests and produces text and HTML V8 coverage reports. | Use when assessing unit-test coverage. |
| `lint` | Checks TypeScript, TSX, JavaScript, and JSX files with ESLint. | Use before review to find lint violations. |
| `lint:fix` | Runs ESLint and applies safe automatic fixes. | Use after editing code or when import ordering needs correction. |
| `format` | Formats supported repository files with Prettier. | Use when applying repository-wide formatting. |
| `format:check` | Checks Prettier formatting without changing files. | Use in verification and CI. |
| `fix:all` | Applies ESLint fixes and then formats the repository with Prettier. | Use when both lint fixes and formatting are needed. |

Vercel does not invoke the `dev` or `build` package scripts. `vercel.json` pins
`"devCommand": "next"` and `"buildCommand": "next build"`, so changes to those
scripts affect local and CI usage only unless the Vercel commands are updated
separately.
