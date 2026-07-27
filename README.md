# Sprig

Sprig is an AI-generated mindmap tool. It turns a prompt into an interactive
mindmap, supports AI-assisted branch editing, and stores mindmaps in Supabase.

## Getting started

### Prerequisites

- Node.js 20.9 or newer (Node.js 24 is selected by `.nvmrc`)
- pnpm
- A Supabase project
- A Groq API key for AI generation and editing

### Setup

1. Copy `.env.example` to `.env.local`.
2. Set `GROQ_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
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
