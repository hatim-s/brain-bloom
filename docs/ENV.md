# Environment variables

| Variable | Consumer | Required | Where to obtain it |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk's browser provider. | Not required in keyless development; production-only in P9. | Configure the production Clerk application in P9. |
| `CLERK_SECRET_KEY` | Clerk's server SDK and request proxy. | Not required in keyless development; production-only in P9. | Configure the production Clerk application in P9. |
| `NEXT_PUBLIC_ENABLE_OAUTH` | `app/(auth-pages)/oauth-buttons.tsx` renders the Google and GitHub buttons on `/sign-in` and `/sign-up` only when this is exactly `"true"`. | Optional; leave unset in keyless development. | Set to `true` once P9 claims the Clerk instance and enables the Google and GitHub social connections in the Clerk dashboard. |
| `CLERK_JWT_ISSUER_DOMAIN` | `convex/auth.config.ts` uses this issuer to validate Clerk JWTs when it is configured. | Optional in keyless/local runs; required in the Convex deployment environment after Clerk is claimed in P9. | Use the claimed Clerk instance's JWT issuer domain. |
| `CONVEX_DEPLOYMENT` | The Convex CLI uses this deployment identifier for schema generation and local backend commands. | Required for Convex development commands. | Created by the anonymous local Convex setup and stored in `.env.local`. Production deployment values arrive in P9. |
| `ANTHROPIC_OAUTH_TOKEN` | The `/api/chat` route and AI generation/editing server actions authenticate Anthropic with a Bearer token. | Required for AI features; dev-local only. | Print an access token from the user's Claude subscription tooling, for example `ant auth print-credentials --access-token`. |
| `SPRIG_AI_MODEL` | Selects the Anthropic model used by every Sprig AI path. | Optional; defaults to `claude-sonnet-5`. | Set an Anthropic model id only when overriding the default. |
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

With `CLERK_JWT_ISSUER_DOMAIN` unset, the Convex auth provider list is empty so
local and keyless schema pushes still work. Convex authentication is inactive in
that state, and every `requireUser` call rejects. Set the issuer in the Convex
deployment environment when the Clerk instance is claimed in P9.

Social sign-in is gated behind `NEXT_PUBLIC_ENABLE_OAUTH` for the same reason: a
keyless instance has no OAuth credentials, so the buttons stay out of the markup
entirely until the instance is claimed. The flag is read at module scope, so
changing it requires a dev-server restart.

`ANTHROPIC_OAUTH_TOKEN` is a dev-local credential sourced from the user's
Claude subscription tooling. Never expose it through a `NEXT_PUBLIC_*` variable
or commit it to the repository. The provider uses Bearer OAuth plus Anthropic's
OAuth beta header and does not send `x-api-key`.

The unprefixed Supabase variables are temporary, operator-only migration inputs
and are never exposed to the application bundle.

The P5 Convex provider tolerates a missing public URL during placeholder-env CI
builds. Keep all local Clerk and Convex values in the gitignored `.env.local`.
