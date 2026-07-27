# Package scripts

| Script | What it does | When to use it |
| --- | --- | --- |
| `dev` | Starts the Next.js development server with Turbopack. | Use during local application development. |
| `build` | Creates an optimized production build with Turbopack. | Use before deploying or verifying production compilation. |
| `start` | Starts the Next.js production server using an existing build. | Use to run the output of `pnpm build`. |
| `typecheck` | Runs TypeScript without emitting files and skips checking dependency declaration files. | Use after TypeScript changes and before review. |
| `test` | Runs all Vitest unit tests once. | Use for local and CI verification. |
| `test:watch` | Runs Vitest in watch mode. | Use while developing or updating unit tests. |
| `test:coverage` | Runs all Vitest tests and produces text and HTML V8 coverage reports. | Use when assessing unit-test coverage. |
| `lint` | Checks TypeScript, TSX, JavaScript, and JSX files with ESLint. | Use before review to find lint violations. |
| `lint:fix` | Runs ESLint and applies safe automatic fixes. | Use after editing code or when import ordering needs correction. |
| `format` | Formats supported repository files with Prettier. | Use when applying repository-wide formatting. |
| `format:check` | Checks Prettier formatting without changing files. | Use in verification and CI. |
| `fix:all` | Applies ESLint fixes and then formats the repository with Prettier. | Use when both lint fixes and formatting are needed. |
