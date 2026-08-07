# Environment variables

| Variable | Consumer | Required | Where to obtain it |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk's browser provider. | Not required in keyless development; production-only in P9. | Configure the production Clerk application in P9. |
| `CLERK_SECRET_KEY` | Clerk's server SDK and request proxy. | Not required in keyless development; production-only in P9. | Configure the production Clerk application in P9. |
| `NEXT_PUBLIC_ENABLE_OAUTH` | `app/(auth-pages)/oauth-buttons.tsx` renders the Google and GitHub buttons on `/sign-in` and `/sign-up` only when this is exactly `"true"`. | Optional; leave unset in keyless development. | Set to `true` once P9 claims the Clerk instance and enables the Google and GitHub social connections in the Clerk dashboard. |
| `CLERK_FRONTEND_API_URL` | `convex/auth.config.ts` uses this issuer to validate Clerk JWTs when it is configured. | Optional in keyless/local runs; required in the Convex deployment environment after Clerk is claimed in P9. | Use the claimed Clerk instance's full Frontend API URL, including `https://`. |
| `CONVEX_DEPLOYMENT` | The Convex CLI uses this deployment identifier for schema generation and local backend commands. | Required for Convex development commands. | Created by the anonymous local Convex setup and stored in `.env.local`. Production deployment values arrive in P9. |
| `SPRIG_AI_PROVIDER` | Routes every server-side AI path through the Claude Agent SDK or Codex SDK. | Optional; defaults to `claude`. | Set to exactly `claude` or `codex`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | The Claude Agent SDK authenticates `/api/chat` and the AI generation/editing server actions with the local operator's Claude subscription. | Required for subscription-backed AI features; dev-local and single-operator only. | Run `claude setup-token` and copy the generated token. |
| `SPRIG_AI_MODEL` | Selects the Anthropic model used by every Sprig AI path. | Optional; defaults to `claude-sonnet-5`. | Set an Anthropic model id only when overriding the default. |
| `SPRIG_CODEX_MODEL` | Selects the OpenAI model used when `SPRIG_AI_PROVIDER=codex`. | Optional; defaults to `gpt-5.6-sol`. | Set a Codex-supported model id only when overriding the default. |
| `CODEX_HOME` | The disposable provider spike sets this only in its Codex app-server child process, derived from the required `--codex-home` argument. Ambient `CODEX_HOME` is not read by the harness. | Not an application setting. The executing Codex spike requires a caller-created private child of the OS temp directory. | Create a fresh directory with `mktemp -d`; see `docs/PROVIDER_SPIKE.md`. |
| `NEXT_PUBLIC_CONVEX_URL` | `providers/ConvexClientProvider.tsx` uses this deployment URL for browser queries and mutations. | Optional at build time; required at runtime once the frontend uses Convex data in P6. | Created by the anonymous local Convex setup and stored in `.env.local`. Production deployment values arrive in P9. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Reserved for future Convex HTTP actions; nothing consumes it until P8 adds HTTP actions. | Not user-configured. | The anonymous local Convex deployment writes `http://127.0.0.1:3214` (the local HTTP-actions port) to `.env.local`; cloud deployments use the deployment's `.convex.site` domain. |
| `SUPABASE_URL` | The one-time `scripts/migrate-supabase-to-convex.ts` REST reader. | Required only while previewing or executing the legacy migration. | Copy the legacy project URL from its Supabase project settings. |
| `SUPABASE_API_KEY` | The one-time migration script's PostgREST `apikey` and bearer credential. | Required only while previewing or executing the legacy migration. | Use a legacy-project key that can read every row being migrated; keep it server-side. |
| `VERCEL_URL` | `app/layout.tsx` uses it to build the metadata base URL. | Optional; Vercel sets it automatically. When self-hosting without it, the application falls back to `http://localhost:3000`. | Supplied by Vercel deployments. |

## Clerk authentication

Clerk keyless development requires no `CLERK_*` variables before the first
`next dev` run. Clerk self-provisions and writes local artifacts at that point.
Keep the generated `.clerk/` directory gitignored. The production publishable
and secret keys are intentionally deferred to P9.

With `CLERK_FRONTEND_API_URL` unset, the Convex auth provider list is empty so
local and keyless schema pushes still work. Convex authentication is inactive in
that state, and every `requireUser` call rejects. Set the issuer in the Convex
deployment environment when the Clerk instance is claimed in P9.

Social sign-in is gated behind `NEXT_PUBLIC_ENABLE_OAUTH` for the same reason: a
keyless instance has no OAuth credentials, so the buttons stay out of the markup
entirely until the instance is claimed. The flag is read at module scope, so
changing it requires a dev-server restart.

`SPRIG_AI_PROVIDER` switches every AI entry point together: `claude` uses the
Claude Agent SDK and `codex` uses the OpenAI Codex SDK. Unsupported values are
rejected as configuration errors.

`CLAUDE_CODE_OAUTH_TOKEN` is a dev-local operator credential generated by
`claude setup-token`. Never expose it through a `NEXT_PUBLIC_*` variable, commit
it, or use it to offer Claude subscription access to other users. Sprig passes
it only to the server-side Claude Agent SDK subprocess.

The Codex provider uses the app server's saved `codex login` session. Sprig
removes API-key variables from the child environment so this path cannot
silently switch to API billing. It is likewise intended only for a trusted,
single-operator deployment.

The unprefixed Supabase variables are temporary, operator-only migration inputs
and are never exposed to the application bundle.

The P5 Convex provider tolerates a missing public URL during placeholder-env CI
builds. Keep all local Clerk and Convex values in the gitignored `.env.local`.
