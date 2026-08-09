# Codex credential homes

This Phase 1 slice defines a fail-closed contract for future
subscription-backed Codex credential homes. It does not log in to Codex, accept
or store credentials, start a provider process, create a production home, write
application data, or deploy the gateway.

## No production authority yet

Portable Node filesystem operations cannot prove the isolation required by
[ADR 0002](./adr/0002-subscription-connection-gateway.md). Same-UID `0700`
directories do not stop a future provider child from reading sibling homes,
path validation cannot close recursive-deletion time-of-check/time-of-use
races, and a pin stored inside the managed root disappears with that root.

Structural TypeScript interfaces and returned booleans are not security
attestations. The production `CodexCredentialHomeManager` therefore accepts only
an opaque capability registered in a module-private runtime root of trust. A
cast, object spread, wrapper, proxy, or exported test helper cannot register an
object in that root of trust. Returned production runtime authority is protected
by a separate module-private runtime brand and can be checked before a future
launcher uses it.

There is intentionally no exported or portable production provisioner in this
change. Until maintainers select a host and implement its reviewed adapter
inside the trusted module boundary, every attempt to initialize the production
manager fails before touching the configured root.

The future trusted authority must encapsulate all three capabilities below in
one isolation domain:

```text
                        external durable root-pin registry
                                      |
                                      v
authorized owner + connection -> lifecycle coordinator -> host isolation layer
       |                              |                       |
       v                              v                       v
 SHA-256 home ID            provisionable/active/      bound home/root handles
                              revoking/revoked                   |
                                      |                          |
                                      +------------+-------------+
                                                   v
                              branded production runtime authority
```

1. The host adapter must reject nonexistent or substituted roots, isolate each
   provider child from sibling homes, and perform descriptor/identity-bound (or
   equivalently non-path-racy) deletion.
2. The external root registry must atomically compare-and-set an opaque root
   device, inode, and generation outside the managed root and retain it across
   gateway restart.
3. The lifecycle coordinator must serialize each home across processes and
   durably preserve terminal `revoking` and `revoked` states.

## Revocation state machine

Only explicit `provisionable` and `active` states may ensure a home. `revoking`,
`revoked`, absent, malformed, invented, or unavailable state fails closed.

```text
provisionable ----ensure----> active
      |                         |
      +---------teardown--------+
                    |
                    v
                revoking  -- successful cleanup -->  revoked
                    ^                                  |
                    |------- idempotent retry ---------+
```

Teardown acquires the cross-process lease and durably commits `revoking` before
calling external provider revocation or host deletion. Callback, deletion, or
final-tombstone failure leaves the lifecycle terminal at `revoking`. A queued or
fresh-manager ensure cannot reactivate it. Cleanup retries may repeat the
idempotent provider revoke/delete operations and may only advance
`revoking -> revoked`; they cannot transition back to an executable state.

## Identity and runtime policy

The manager hashes an already-authorized Clerk owner subject and opaque
connection ID using a length-prefixed, domain-separated SHA-256 tuple. Raw
identifiers never become path segments, and there is no list, search, fallback,
merge, or shared-home API.

A future branded production result contains only `CODEX_HOME` plus the Codex
session flag `cli_auth_credentials_store="file"`. It never merges ambient API
keys or other-provider credentials. This change cannot mint that result.

## Test boundary

All local path adapters, in-memory coordinators/root pins, test managers, and
unbranded runtime-environment factories live inside
`codex-credential-homes.test.ts`. None is exported from importable production
source. A runtime export audit fixes the production module surface to the
production manager, error, file-store flag, and runtime brand validator. A
TypeScript-AST repository guard parses non-test `.js`, `.jsx`, `.ts`, `.tsx`,
`.cjs`, `.cts`, `.mjs`, and `.mts` files under `services`, `app`, and `lib`. It
rejects test/spec files and directories referenced by static imports/exports,
dynamic `import()`, import-equals/`require`, `require()`, or `require.resolve`,
plus `module.require` and their computed CommonJS forms. Dynamic/CommonJS loads
with nonliteral targets fail closed. Test/spec tokens followed by dot, path
boundary, hyphen, underscore, or end are rejected after case and separator
normalization; ordinary words such as `contest-support` and `specialist` remain
valid. Comments and inert string data are not treated as module loads.

The test-local harness preserves lifecycle race and filesystem attack coverage,
but it cannot be imported as application authority or produce a value accepted
by the production runtime brand check. It does **not** satisfy ADR 0002.

## Human gates before real credentials

Before production authority can be minted, maintainers must:

1. Select the persistent gateway host and durable volume.
2. Implement and independently review the host adapter inside the module's
   trusted authority boundary.
3. Prove provider-child sibling isolation and descriptor/identity-bound cleanup
   with same-host escape and race tests.
4. Provision durable external root pins and a cross-process coordinator with
   atomic leases and terminal tombstones.
5. Approve encryption-key custody, rotation, backup, restore, and deletion from
   backups before storing any real credential material.
6. Approve the Codex ceremony and allowlisted owner, then validate durability,
   restore, and incident-revocation procedures.

Claude connection work remains deferred. No production database mutation,
credential ceremony, provider execution, persistent home creation, or
deployment is authorized by this slice.
