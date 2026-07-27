# Shared project instructions

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

## Computer and Browser Use
- Use the browser use tool and/or Computer use tool to validate your work, or debug issues when the user requests.
- Always try to reproduce the issue, with your best efforts, and then try to fix it. If it cannot be reproduced because of tool failures, report as such and abort. If the issue could not be reproduced, then do not jump to a fix, report that it could not be reproduced and suggest possible fixes to the user.
