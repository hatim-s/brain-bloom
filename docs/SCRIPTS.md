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
| `migrate:supabase` | Previews the Supabase-to-Convex mindmap migration without writing by default. Pass `--execute --owner <Clerk subject>` after `--` to perform the import for one owner. | Run `pnpm migrate:supabase` for a dry-run report. After human approval, run `pnpm migrate:supabase -- --execute --owner <Clerk subject>` to write to Convex. |
| `provider:spike` | Runs the disposable Phase 0 Codex/Claude provider-seam harness through Node's strip-only TypeScript runner. It prints help or a dry-run plan unless `--execute` is supplied. | Use only for human-invoked credential ceremony proofs described in `docs/PROVIDER_SPIKE.md`; ordinary tests use injected fakes. |
| `benchmark:embeddings` | Validates pinned model, verified adapter artifact/manifest, runtime/preprocessing identities, and committed quality/integrity fixtures; the default reports cache-entry metadata only and never opens cache contents, adapter bytes, models, or outputs. | Use the default dry run during review. A real benchmark requires `--run --adapter-module <path relative to .cache/local-embedding-adapters>` and runs each candidate in a fresh child process; add `--allow-downloads` only with explicit human approval when a model cache is absent. `--output-dir` accepts only a relative subdirectory beneath the dedicated results root. |

Vercel does not invoke the `dev` or `build` package scripts. `vercel.json` pins
`"devCommand": "next"` and `"buildCommand": "next build"`, so changes to those
scripts affect local and CI usage only unless the Vercel commands are updated
separately.

## Convex scripts

- `pnpm convex:dev` — run the Convex development deployment (anonymous local by
  default; see `docs/ENV.md`).
- `pnpm convex:codegen` — regenerate `convex/_generated/` from the current
  schema and function modules. Run after any change under `convex/` and commit
  the result (CI typechecks against the committed output).
- `pnpm test:convex` — run only the `convex/**/*.test.ts` suites.

`pnpm test` also includes the Convex Vitest suites.

## Supabase migration

`pnpm migrate:supabase` is always a dry run unless `--execute` is present. An
executing run also requires an explicit Clerk subject:

```sh
pnpm migrate:supabase -- --execute --owner user_123
```

The command reports each mindmap independently. Validation rejections include
the offending node IDs and do not prevent later maps from being reported.
