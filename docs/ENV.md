# Environment variables

| Variable | Consumer | Required | Where to obtain it |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk's browser provider. | Not required in keyless development; production-only in P9. | Configure the production Clerk application in P9. |
| `CLERK_SECRET_KEY` | Clerk's server SDK and request proxy. | Not required in keyless development; production-only in P9. | Configure the production Clerk application in P9. |
| `CLERK_JWT_ISSUER_DOMAIN` | `convex/auth.config.ts` uses this issuer to validate Clerk JWTs. | Supplied by the orchestrator after keyless provisioning; production is configured in P9. | In keyless development, use the Clerk frontend API URL written to `.env.local`; it doubles as the issuer domain. |
| `CONVEX_DEPLOYMENT` | The Convex CLI uses this deployment identifier for schema generation and local backend commands. | Required for Convex development commands. | Created by the anonymous local Convex setup and stored in `.env.local`. Production deployment values arrive in P9. |
| `GROQ_API_KEY` | The AI generation and AI editing server actions in `actions/ai-gen.ts` and `actions/ai-edit.ts`. | Required when using AI generation or editing. | Create an API key in the Groq console. |
| `NEXT_PUBLIC_CONVEX_URL` | `providers/ConvexClientProvider.tsx` uses this deployment URL for browser queries and mutations. | Optional at build time; required at runtime once the frontend uses Convex data in P6. | Created by the anonymous local Convex setup and stored in `.env.local`. Production deployment values arrive in P9. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Reserved for future Convex HTTP actions; nothing consumes it until P8 adds HTTP actions. | Not user-configured. | The anonymous local Convex deployment writes `http://127.0.0.1:3214` (the local HTTP-actions port) to `.env.local`; cloud deployments use the deployment's `.convex.site` domain. |
| `NEXT_PUBLIC_SUPABASE_URL` | The transitional Supabase data client and client factories. | Required while Supabase data remains in use through P6. | Copy the project URL from the Supabase project settings. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The transitional Supabase data client and client factories. | Required while Supabase data remains in use through P6. | Copy the anonymous public key from the Supabase project API settings. |
| `VERCEL_URL` | `app/layout.tsx` uses it to build the metadata base URL. | Optional; Vercel sets it automatically. When self-hosting without it, the application falls back to `http://localhost:3000`. | Supplied by Vercel deployments. |

## Clerk authentication

Clerk keyless development requires no `CLERK_*` variables before the first
`next dev` run. Clerk self-provisions and writes local artifacts at that point.
Keep the generated `.clerk/` directory gitignored. The production publishable
and secret keys are intentionally deferred to P9.

The Groq and Supabase variables are slated for removal in a later overhaul phase. Until that phase lands, place local values in `.env.local` and configure the same values in the deployment environment.

The P5 Convex provider tolerates a missing public URL during placeholder-env CI
builds. Keep all local Clerk and Convex values in the gitignored `.env.local`.
