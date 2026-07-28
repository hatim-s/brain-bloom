# Production cutover runbook

Everything below is **human-in-the-loop**: no agent or script performs these
steps. Each stage lists its unlock and its verification. Local development
can run the UI with keyless Clerk and anonymous Convex, but Convex auth is
deliberately fail-closed until a Clerk issuer is configured. Authenticated data
flows therefore need steps 1 and 2; without them, the UI shell runs while map
data remains inert. Sprig also remains unavailable without its dev-local
Claude-subscription OAuth token.

## 0. Current state (end of P9)

- Convex: anonymous local deployment (`CONVEX_DEPLOYMENT=anonymous:…`,
  backend on 127.0.0.1:3211). Schema, functions, and codegen are committed.
- Clerk: keyless dev instance. Claim URL is printed on every `pnpm dev`
  start. Custom sign-in/up flows work; OAuth buttons are flag-gated off;
  the Convex JWT bridge is written but deliberately rejects data access until
  an issuer is configured.
- AI: `ANTHROPIC_OAUTH_TOKEN` (personal Claude-subscription token) — dev
  only. No API-key path exists in `lib/anthropic.ts` yet.
- Data: legacy Supabase project still holds pre-overhaul mindmaps;
  `pnpm migrate:supabase` (dry-run default) is ready.

## 1. Claim the Clerk instance

1. Open the claim URL from the dev log (`Claim your keys` link) and attach
   the instance to a Clerk account.
2. In the Clerk dashboard: create the JWT template named **`convex`**
   (Convex template preset). Note the issuer domain
   (`https://<slug>.clerk.accounts.dev` or your custom domain).
3. Enable Google + GitHub OAuth providers (this unlocks
   `NEXT_PUBLIC_ENABLE_OAUTH=true`; the buttons and `sso()` flow shipped in
   P5). Configure authorized redirect origins for the production domain.
4. Record `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.

Verify: sign in locally with real keys in `.env.local`; confirm
`auth().getToken({ template: "convex" })` returns a JWT (the canvas loads
data once step 2's issuer is configured in Convex — step 2 below).

## 2. Promote Convex to cloud

1. `pnpm exec convex login`, then `pnpm exec convex deploy` from the repo —
   this creates the cloud deployment from the committed schema/functions.
2. In the Convex dashboard, set the environment variable
   `CLERK_JWT_ISSUER_DOMAIN=<issuer from step 1.2>` — `convex/auth.config.ts`
   activates the provider only when it is present.
3. Record `CONVEX_DEPLOYMENT` (prod) and the deployment URL for
   `NEXT_PUBLIC_CONVEX_URL` (`https://<slug>.convex.cloud`) and
   `NEXT_PUBLIC_CONVEX_SITE_URL` (`https://<slug>.convex.site`).

Verify: `pnpm exec convex run mindmaps:listMine` fails with
"Unauthenticated" (auth enforced), not with a config error.

## 3. AI in production — decision required

`lib/anthropic.ts` authenticates ONLY via `ANTHROPIC_OAUTH_TOKEN` (personal
subscription OAuth; short-lived). That is not a production credential.
Options, pick one before launch:

- **A (recommended)**: add an `ANTHROPIC_API_KEY` fallback to
  `lib/anthropic.ts` (few lines — prefer API key when set, keep the OAuth
  path for dev) and provision a real Anthropic API key with billing.
- **B**: ship without server AI (`/api/chat` returns its 503 "AI is not
  configured" path; the panel shows the configuration notice).

## 4. Migrate legacy data

1. Ensure `.env.local` (or the shell) has the legacy
   `SUPABASE_URL` / `SUPABASE_API_KEY` (operator-only inputs read explicitly
   by the migration script).
2. Dry run against prod Convex: `CONVEX_DEPLOYMENT=<prod> pnpm
   migrate:supabase` — review the per-map diff report (adds/changes/
   removes, rejected maps with reasons).
3. Execute: append `--execute --owner <your Clerk subject>` (find the
   subject in Clerk dashboard → your user → User ID, `user_…`).
4. Re-run the dry run: it must report every map as unchanged (idempotency
   check).
5. Retire the Supabase project only after step 6's verification.

## 5. Vercel environment

Set for Production (and Preview if desired):

| var | value |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | step 2.3 |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | step 2.3 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | step 1.4 |
| `CLERK_SECRET_KEY` | step 1.4 |
| `NEXT_PUBLIC_ENABLE_OAUTH` | `true` once step 1.3 is done |
| `ANTHROPIC_API_KEY` | step 3 option A only; omit when shipping option B |
| `SPRIG_AI_MODEL` | optional override (default `claude-sonnet-5`) |

The build itself needs no env vars (verified in CI every merge).

## 6. Launch verification checklist

- [ ] `/` renders static shell fast (PPR); CTA resolves per auth state.
- [ ] Sign-up with email code end-to-end; password reset flow; OAuth both
      providers.
- [ ] `/maps` lists migrated maps; open one; edit; autosave pill cycles
      dirty → saving → saved; reload shows the edit.
- [ ] AI panel: create nodes via chat; bloom flash; "Undo to here"
      reverses the turn; canvas updates live without reload.
- [ ] Share: set a map shared (UI from P9b), open `/share/<publicId>` in a
      private window; read-only enforced; revoke → the owner UI reflects the
      private server state via live reseed and the link 404s content-wise.
- [ ] `robots.txt`, `sitemap.xml` public; deep link → sign-in → returns to
      the deep link.

## Known deferred work (post-v1)

- Node deletion has no canvas UI (backend delete op exists; AI can delete).
- `.sprig-ai-active` (per-node in-flight state) is unwired — no per-node
  signal exists mid-stream.
- Multi-writer collaboration: `mindmaps.get` invalidates wholesale per
  write; per-node subscriptions needed before real-time co-editing.
- Thread history pagination (`listMessages` unbounded per thread).
- `operations` log grows monotonically; no compaction.
