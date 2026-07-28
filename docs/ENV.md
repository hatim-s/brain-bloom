# Environment variables

| Variable | Consumer | Required | Where to obtain it |
| --- | --- | --- | --- |
| `CONVEX_DEPLOYMENT` | The Convex CLI uses this deployment identifier for schema generation and local backend commands. | Required for Convex development commands. | Created by the anonymous local Convex setup and stored in `.env.local`. Production deployment values arrive in P9. |
| `GROQ_API_KEY` | The AI generation and AI editing server actions in `actions/ai-gen.ts` and `actions/ai-edit.ts`. | Required when using AI generation or editing. | Create an API key in the Groq console. |
| `NEXT_PUBLIC_CONVEX_URL` | The future browser Convex client uses this deployment URL for queries and mutations. The frontend remains on Supabase until P6. | Required once Convex frontend wiring lands. | Created by the anonymous local Convex setup and stored in `.env.local`. Production deployment values arrive in P9. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Future Convex HTTP actions use this public site URL. | Required once a frontend or integration calls Convex HTTP actions. | Created by the anonymous local Convex setup and stored in `.env.local`. Production deployment values arrive in P9. |
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase browser client, server client, and session proxy. | Required to run the application with Supabase. | Copy the project URL from the Supabase project settings. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The Supabase browser client, server client, and session proxy. | Required to run the application with Supabase. | Copy the anonymous public key from the Supabase project API settings. |
| `VERCEL_URL` | `app/layout.tsx` uses it to build the metadata base URL. | Optional; Vercel sets it automatically. When self-hosting without it, the application falls back to `http://localhost:3000`. | Supplied by Vercel deployments. |

The Groq and Supabase variables are slated for removal in a later overhaul phase. Until that phase lands, place local values in `.env.local` and configure the same values in the deployment environment.

Convex is backend-only in P4a: the anonymous local values support backend
development and tests, but the application does not consume the public Convex
variables yet. Keep all local deployment values in the gitignored `.env.local`.
