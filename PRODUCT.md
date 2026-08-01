# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: students and learners breaking down topics to study or understand them — turning a subject, chapter, or question into a navigable structure they can explore and extend. Other audiences (knowledge workers, general brainstormers) are secondary and unconfirmed.

## Product Purpose

Sprig turns a prompt into an interactive AI-generated mindmap. Users generate a map from a single idea, explore it on an infinite canvas, and grow or revise branches through AI-assisted editing. Maps persist per-user in Convex and can be shared publicly. Success is a learner going from "vague topic" to "structured, explorable understanding" in one sitting.

## Positioning

Three confirmed pillars, all binding:

1. **Agent-powered depth** — generation and editing run on real coding-agent SDKs (Claude Agent SDK / Codex SDK), not one-shot LLM calls, so branches carry deeper multi-step reasoning.
2. **Conversational editing** — users iterate on the map through dialogue (threaded chat per map); branches evolve rather than whole-map regeneration.
3. **Speed and simplicity** — prompt to usable map in seconds, zero learning curve.

## Operating Context

- Web app: Next.js 16 (App Router, Turbopack), React 19, xyflow canvas with dagre layout, Convex for data, Clerk for auth.
- Core flow: sign in → `/new` (prompt) → generated map → explore/edit on canvas via AI panel chat → maps list at `/maps` → optional public share at `/share/[publicId]`.
- Conversation state: `POST /api/chat` returns `x-sprig-thread-id`; the client sends it back as `threadId` to continue a thread.

## Capabilities and Constraints

- **BYO AI subscription (durable product fact):** the operator brings a Claude Code OAuth token or a Codex login (`SPRIG_AI_PROVIDER=claude|codex`). No hosted AI keys; do not design around per-user API billing.
- **Public share links (durable):** anyone with a `/share/[publicId]` URL can view that map; this is the sharing model.
- Monetization: none exists. Do not invent pricing, plans, or billing.
- Proxy/session refresh runs on the Node.js runtime, single region (Next.js 16 requirement); latency implications accepted.

## Brand Commitments

- **Binding feel (user-stated):** the app should feel **rich and luxurious, yet calm and peaceful**. This outranks the name metaphor.
- The name "Sprig", wordmark, leaf-dot, and growth metaphor exist but are explicitly **secondary** — usable, not sacred; future work may de-emphasize them in favor of the feel above.
- **Standing direction preference (user-chosen, 2026-07-29):** the category standard played straight — polished modern canvas-tool canon at the craft level of **Things 3 / Craft / Notion / FigJam**. Conventions embraced at full fidelity; no themed visual worlds. Applies to future visual-direction decisions unless the user changes it.
- **Pinned palette (user-chosen, 2026-07-30):** the **organic green-clay colorway** — living greens on deep forest grounds (dark-first) with fired-clay warmth as the AI-presence accent. The purple/iris colorway is explicitly rejected. Canvas layout philosophy is **free-flowing and nature-inspired**, not columnar.

## Evidence on Hand

- Working product: generation, canvas editing, persistence, sharing all implemented in-repo.
- No testimonials, case studies, press, user counts, or benchmarks exist. Do not fabricate any.

## Product Principles

1. **Depth over decoration** — the agent-generated structure is the value; surface it, never bury it under chrome.
2. **Conversation grows the map** — editing is dialogue-first; avoid heavy manual-editing UI that competes with chat.
3. **Instant first map** — protect the prompt-to-map path; every added step before a usable map is a regression.
4. **Calm luxury** — richness through restraint: the experience should feel premium and peaceful, never busy or gamified.
5. **Truthful by default** — no invented social proof, pricing, or claims; the product speaks through the map itself.
