# Sprig

Sprig is an AI-generated mindmap tool. It turns a prompt into an interactive
mindmap, supports AI-assisted branch editing, and stores mindmaps in Convex.

## Getting started

### Prerequisites

- Node.js 24 or newer (Node.js 24 is selected by `.nvmrc`)
- pnpm
- A Convex deployment
- A Clerk `convex` JWT template for authenticated Convex reads; see
  [`docs/ENV.md`](docs/ENV.md). Keyless Clerk instances cannot create this
  template until they have been claimed.
- A dev-local Claude subscription OAuth token for AI generation and editing

### Setup

1. Copy `.env.example` to `.env.local`.
2. Set `ANTHROPIC_OAUTH_TOKEN`, `CONVEX_DEPLOYMENT`, and
   `NEXT_PUBLIC_CONVEX_URL`.
3. Install the existing dependencies with `pnpm install`.
4. Start the development server with `pnpm dev`.

The application is then available at
[http://localhost:3000](http://localhost:3000).

### Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Turbopack development server. |
| `pnpm build` | Create a production build with Turbopack. |
| `pnpm start` | Run the production server from a completed build. |
| `pnpm typecheck` | Check TypeScript types without emitting files. |
| `pnpm test` | Run the Vitest suite once. |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm test:coverage` | Run the Vitest suite and generate text and HTML coverage reports. |
| `pnpm lint` | Check JavaScript and TypeScript files with ESLint. |
| `pnpm lint:fix` | Fix ESLint issues that can be corrected automatically. |
| `pnpm format` | Format the repository with Prettier. |
| `pnpm format:check` | Check repository formatting without changing files. |
| `pnpm fix:all` | Apply ESLint fixes, then format the repository. |

## Environment

See [`docs/ENV.md`](docs/ENV.md) for the variables used by Sprig and their
deployment behavior.

## Runtime notes

The proxy runs on the Node.js runtime because Next.js 16 requires it. Session
refreshes therefore run in a single region rather than on the global Edge
network; the associated latency, cold-start, and billing implications are an
accepted consequence of the upgrade.

Authenticated `POST /api/chat` responses expose the active conversation id in
the `x-sprig-thread-id` response header. The client should retain that value and
send it as `threadId` on later turns; omitting it starts a new thread.
