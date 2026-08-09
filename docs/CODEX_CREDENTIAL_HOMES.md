# Codex credential homes

This Phase 1 slice defines the fail-closed host boundary for future
subscription-backed Codex connections. It does not log in to Codex, accept or
store credentials, start a provider process, write application data, or deploy
the gateway.

## Production boundary

Portable Node filesystem operations cannot prove the isolation required by
[ADR 0002](./adr/0002-subscription-connection-gateway.md). In particular,
same-UID `0700` directories do not stop a future provider child from reading a
sibling home, path validation cannot close deletion time-of-check/time-of-use
races, and a pin stored inside a managed root disappears with that root.

`CodexCredentialHomeManager` therefore has no filesystem default. Production
initialization fails closed unless the deployment injects all three capabilities
in one attested isolation domain:

```text
                        external durable root-pin registry
                                      |
                                      v
authorized owner + connection -> lifecycle coordinator -> host isolation layer
       |                              |                       |
       v                              v                       v
 SHA-256 home ID             active/revoked tombstone  bound home/root handles
                                      |                       |
                                      +----------+------------+
                                                 v
                           CODEX_HOME + file credential-store flag
```

1. **Host isolation capability.** It must attest that a provider child cannot
   access sibling homes and that recursive deletion is bound to verified root
   and leaf identities (descriptor-bound or an equivalent non-path-racy host
   primitive). It creates/opens homes and performs deletion; the manager does
   not implement recursive deletion with portable path calls.
2. **External root-pin registry.** It atomically pins or verifies the opaque
   root device, inode, and generation under a non-path root key. The pin is
   stored outside the managed root and survives gateway restart. A replacement
   at the configured path is a mismatch, never a new root to adopt.
3. **Durable lifecycle coordinator.** It serializes each derived home across
   processes/managers and persists `active` or `revoked` state. Revocation is
   committed before local deletion. Queued or restarted `ensure` calls cannot
   recreate a revoked home, and cleanup can be retried under its tombstone.

The manager requires matching isolation-domain identifiers across these
capabilities. Each capability supplies a positive production attestation for
its guarantees; names and TypeScript shapes alone are not treated as proof.
Missing, unavailable, inconsistent, or negative capabilities produce stable
secret-free failures.

## Identity and runtime policy

The manager hashes an already-authorized Clerk owner subject and opaque
connection ID using a length-prefixed, domain-separated SHA-256 tuple. The
result is one flat `codex-<64 lowercase hex characters>` name. Raw owner and
connection identifiers never become path segments. There is no list, search,
fallback, merge, or shared-home API.

The process environment returned for a future Codex child contains only
`CODEX_HOME`; it never merges the ambient environment. The accompanying Codex
session flag pins `cli_auth_credentials_store="file"`. The future launcher must
consume this exact contract and must not add API-key or other-provider
credentials.

Disconnect and owner deletion acquire the durable lifecycle lease, revoke the
provider connection once, persist the revoked tombstone, and then ask the host
capability to delete the exact identity-bound home. Failed provider revocation
preserves both lifecycle and local state. Failed local cleanup retains the
tombstone so later cleanup is safe while execution remains closed.

## Test-only adapter

`codex-credential-homes.test-support.ts` is an explicitly non-production,
single-process behavior emulator. It uses local path operations and in-memory
maps so adversarial tests can reproduce root/leaf swaps, manager races, and
restart behavior. Its attestation is labeled `test-only`; initialization rejects
it unless the caller sets the explicit test-only-capabilities switch. Its host, root-pin, and
coordinator attestations truthfully report the production guarantees they do
not provide. It does **not** satisfy ADR 0002, does not establish same-UID
sibling isolation, and must never be wired into a deployed gateway.

## Human gates before real credentials

No production host implementation is selected or included. Before real
credentials, maintainers must:

1. Select the persistent gateway host and durable volume, then implement and
   independently review its descriptor/identity-bound home operations.
2. Prove provider children run under an OS/sandbox identity that cannot access
   sibling homes, including escape and same-host adversarial tests.
3. Provision an external durable root-pin registry and cross-process lifecycle
   coordinator with atomic compare-and-set, locking, and tombstone durability.
4. Approve encryption-key custody, rotation, backup, restore, and deletion from
   backups before storing any real credential material.
5. Approve the Codex login ceremony and allowlisted test owner, then validate
   host durability, restore, and incident-revocation procedures.

Claude connection work remains deferred. No production database mutation,
credential ceremony, provider execution, persistent home creation, or
deployment is authorized by this slice.
