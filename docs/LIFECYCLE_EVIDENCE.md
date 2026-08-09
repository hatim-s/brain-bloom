# Gateway lifecycle evidence protocol

Status: Phase 1 Codex-first protocol primitive; not wired to HTTP, Convex, a
credential store, environment configuration, or deployment.

## Boundary and flow

`services/agent-gateway/lifecycle-evidence.ts` defines a dependency-free,
versioned Ed25519 envelope for a gateway to prove one exact connection
lifecycle result to a trusted server reconciliation path.

```text
authenticated gateway operation
  + server-derived owner / connection / request / transition / revision
  + safe Codex account projection
                           |
                           v
             Ed25519 lifecycle signer
       (fixed v1 schema, <= 60 second expiry)
                           |
                           v
          opaque three-segment evidence bytes
                           |
                           v
 trusted server: authenticate current/previous key
                           |
                           v
 canonical schema + time -> durable replay consume
                           |
                           v
 exact expected owner / connection / request /
 provider / transition / credential revision
                           |
                           v
          atomic metadata reconciliation
                 (future integration)
```

This module does not accept a provider selector. The provider is always
`codex`. Claude remains deferred. The protected header fixes the algorithm,
type, version, and key identifier. Claims bind issuer, audience, Clerk owner
subject, connection, originating request, independent evidence and nonce
identifiers, issue/expiry seconds, one allowed lifecycle transition, and a
positive credential revision.

## Safe metadata contract

Evidence can contain only:

- an opaque gateway credential identifier;
- an explicit `{ type: "chatgpt", present: true }` subscription projection;
- an optional display-only plan label; and
- one stable error code from the closed protocol vocabulary.

Connected transitions require the opaque credential id and ChatGPT presence,
and forbid an error. Error transitions require a stable error. Expired
transitions require `credential_expired`. Revoked transitions carry no
credential, account, plan, or error metadata. API-key account types fail closed.

The signer validates exact own data properties without invoking getters.
Unexpected fields are rejected, so raw provider output, tokens, filesystem
paths, commands, environment values, serialized homes, and arbitrary error
messages cannot enter the envelope. All identifiers and display labels are
bounded before signing. The verifier bounds the complete envelope before
signature work and accepts only canonical unpadded base64url plus fixed-order
JSON. Authenticated whitespace, reordered keys, duplicate keys, extension
fields, and equivalent encodings are noncanonical and rejected.

## Replay and rotation contract

The verifier authenticates against only an explicit current Ed25519 public key
and optional previous key. Both the header and claims key id must name a key
that authenticated the exact bytes. This gives a bounded current/previous
rotation window without accepting caller-selected algorithms or arbitrary
keys.

After authentic signature, canonical schema, and temporal validation, the
verifier consumes `evidenceId`, `nonce`, and `requestId` in the injected replay
defense. Consumption occurs before comparing issuer, audience, owner,
connection, provider, request, transition, or credential revision. Therefore a
valid signed envelope presented in the wrong context is burned and cannot be
retried against the intended context.

The replay mutation has a finite server-owned deadline and a derived,
reason-free abort signal. Timeout, caller abort, unknown rejection, and any
non-void or otherwise ambiguous store result fail closed. Late fulfillment or
rejection remains observed after the verifier settles. A production replay
store must atomically reject a duplicate evidence id or nonce across every
gateway/server process and retain that decision through evidence expiry.

## Allowed transitions

Version 1 recognizes only these exact transitions:

- `pending_to_connected`, `pending_to_error`, `pending_to_expired`;
- `connected_to_error`, `connected_to_expired`, `connected_to_revoked`;
- `error_to_connected`, `error_to_revoked`; and
- `expired_to_connected`, `expired_to_revoked`.

The signer accepts a closed `ServerLifecycleDecision`, not generic status
strings or caller-defined metadata. Integration code must construct that
decision only after an authenticated gateway operation reaches a server-owned
terminal transition. A browser request may initiate work but is never a
trusted lifecycle decision.

## Human gates before integration

This protocol does not authorize live wiring. The following still require
explicit human decisions and approval:

1. signing-key custody, generation, current/previous rotation, backup, and
   incident-recovery procedure;
2. issuer, audience, key identifier, and finite timeout configuration;
3. a durable, cross-process replay store with atomic consume semantics;
4. the trusted server reconciliation transaction and credential-revision
   compare-and-set policy;
5. the persistent gateway host, private transport, deployment, and monitoring;
6. any Convex schema write, migration, or production database operation; and
7. live Codex account, revocation, rotation, restart, and recovery validation.

Until those gates are approved, this file and its tests are protocol evidence
only. They do not create keys, read credentials, access provider accounts, open
network connections, mutate a database, or deploy infrastructure.
