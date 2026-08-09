# Codex credential homes

This Phase 1 slice implements the filesystem boundary for future
subscription-backed Codex connections. It does not log in to Codex, accept or
store credentials, start a provider process, write application data, or deploy
the gateway.

## Boundary

The gateway injects one canonical durable root into
`CodexCredentialHomeManager`. The manager hashes an already-authorized Clerk
owner subject and opaque connection ID into one flat, deterministic home name:

```text
authorized owner + opaque connection ID
                 |
                 v
  length-prefixed SHA-256 namespace
                 |
                 v
durable root/codex-<64 lowercase hex characters> (0700)
                 |
                 v
{ CODEX_HOME }, -c cli_auth_credentials_store="file"
```

Raw owner and connection identifiers never become path segments. There is no
list, search, fallback, merge, or shared-home API. A new manager instance
derives the same path after restart, while a different owner or connection
derives a different path.

The process environment returned for a future Codex child contains only
`CODEX_HOME`. API keys, Claude credentials, ambient `CODEX_HOME`, and the rest
of the parent environment are not copied. The runtime contract also pins the
official file-backed credential-store setting. The eventual process launcher
must use this returned environment and session flag without merging ambient
provider variables.

## Filesystem policy

- The configured root must be a canonical absolute path below an existing,
  non-symlink parent. Filesystem root and traversal spellings fail closed.
- The durable root and every credential home must be a real directory owned by
  the current POSIX service user with exact `0700` permissions.
- Symlink roots, ancestors, and home leaves; files; permissive directories; and
  a root whose device/inode changes after initialization fail closed.
- Homes are flat children with collision-resistant server-derived names. The
  manager never accepts a caller-supplied home path.
- Teardown calls the injected provider revocation operation first. Failed
  revocation preserves local state. Successful teardown removes only the exact
  derived home, is safe when that home is already absent, and preserves the
  durable root and sibling homes.
- Public failures expose stable codes and generic messages, not filesystem
  paths, raw identifiers, provider output, or underlying OS errors.

Node does not expose a portable `openat`-style recursive deletion API. The
manager therefore combines flat names, a private root, no-follow inspections,
real-path/inode checks, same-home serialization, and checks immediately around
removal. The gateway host must ensure only its service account can mutate the
durable root.

## Human gates before real credentials

This module is credential-free infrastructure. It does not resolve or authorize
the roadmap's remaining human decisions:

1. Select and provision the persistent gateway host and durable volume.
2. Approve encryption-key custody, rotation, backup, restore, and deletion from
   backups before storing any real credential material.
3. Approve the Codex login ceremony and allowlisted test owner before any live
   provider account is connected.
4. Validate host filesystem ownership, volume durability, backup behavior, and
   incident-revocation procedures in the chosen deployment environment.

Claude connection work remains deferred. No production database mutation,
credential ceremony, provider execution, or deployment is authorized by this
slice.
