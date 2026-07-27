# Shared Claude Code instructions

## Orchestration

Your job is only to orchestrate the development process. Once a goal is created, you should
be working towards breaking it down into smaller implementable units and delagating work off
to Codex or smaller model (Opus 4.8) for implementation and review.

- Delegate UI related work to subagents with Fable only if the task at hand is large, else always
  use Opus 4.8 for UI related tasks.
- For logic, brute implemetation, use Codex with GPT 5.6 Luna or Terra and explictly instruct it
  with API contracts, and how the code should be written, what design patterns to use, etc.
- Spawn other Codex agents to review the logic and other aspects of the implementation. And always spawn
  a Opus subagent to critique code quality and smells.

### Codex use
Delegate brute implementation (pure logic, no UI/API-contract design) to Codex:
`timeout <millis> codex exec --sandbox workspace-write -m <model> -c 'model_reasoning_effort="medium"' "<task>" > .logs/<step>.log 2>&1`
— `gpt-5.6-sol` for larger tasks, `gpt-5.6-terra` for smaller ones and `gpt-5.6-luna`
for straight forward implementations and fixes. Prefer Codex for implementation;
review its output yourself.

Observability rules (non-negotiable):
1. Always redirect to a `.logs/<step>.log` file — never pipe codex through
   `tail`/`grep` (pipes buffer output until exit; the run looks stuck even
   when healthy). Check progress anytime with `tail -f .logs/<step>.log`.
2. Always wrap in `timeout 1800` (raise for big tasks upto 3600 or 7200) — a hung run
   self-terminates instead of stalling the session. Codex is stateless per
   invocation: completed file writes survive, so kill + restart is cheap.
3. Liveness = artifacts, not process existence: if the log line count and
   `git diff --stat` are both unchanged for ~5 min, kill and restart.

## Development Philosophy

### Writing code
- ALWAYS add docstring comments for major functions, classes and methods, and inline comments
explaning non trivial logic and code
- Always use single export statement and use named exports for everything - functions, hooks, components, classes etc.
- Whenever a `package.json` script is added, removed, renamed, or its command changes, update `docs/SCRIPTS.md` in the same change.
- Never write code inside index.js/index.ts - only use these as exports

### Incremental development
Small increments; every commit compiles (`pnpm typecheck`) and passes owned
tests. Conventional commits. No massive dumps.

### Commands
Dev commands are present in the `package.json`. Whenever creating new scripts, always
put them in `package.json`.

### Database and Migrations
- Never push to actual database without approval from human - strictly HITL
- Always highlight breaking changes, or changes that might require migration to the human

### Environment
- Whenever adding, removing, or renaming an environment variable, secret, or Cloudflare binding,
update `docs/ENV.md` in the same change.
