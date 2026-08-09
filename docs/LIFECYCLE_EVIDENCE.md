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

- an opaque gateway credential identifier shaped as
  `gwcred_v1_<canonical UUID v4>`;
- an explicit `{ type: "chatgpt", present: true }` subscription projection;
- an optional display-only plan label from `ChatGPT`, `ChatGPT Plus`, `ChatGPT
  Pro`, `ChatGPT Business`, `ChatGPT Enterprise`, or `ChatGPT Edu`; and
- one stable error code from the closed protocol vocabulary.

Only `pending_to_connected` establishes a validated connection. It requires the
opaque credential id and ChatGPT presence, allows a plan enum, and forbids an
error. Every later transition forbids credential/account/plan metadata, so
evidence cannot introduce or replace a credential handle after establishment.
Error transitions require a non-expiry stable error; expiry transitions require
`credential_expired`; revoking, revoked, and deleted transitions require all
metadata fields to be explicit nulls. API-key account types fail closed.

The signer validates exact enumerable own data descriptors without invoking
getters. Fresh snapshots have null prototypes; symbols, hostile prototypes,
accessors, hidden properties, and the magic keys `__proto__`, `prototype`, and
`constructor` are rejected at the decision, metadata, and account boundaries.
Unexpected fields are rejected, so raw provider output, tokens, filesystem
paths, commands, environment values, serialized homes, and arbitrary error
messages cannot enter the envelope.

Issuer and audience are exact protocol constants. Clerk subjects have the
closed Clerk user-id grammar. Connection, request, evidence, nonce, and gateway
credential identifiers each have a distinct versioned canonical UUID-v4
grammar. Key ids have a small lifecycle-v1 hex grammar. The plan projection is
an enum rather than text. Token prefixes, paths, URLs, environment assignments,
control characters, percent-encoded paths, Unicode confusables, and alternate
encodings therefore fail before signing. The verifier bounds the complete
envelope before signature work and accepts only canonical unpadded base64url
plus fixed-order JSON. Authenticated whitespace, reordered keys, duplicate
keys, extension fields, and equivalent encodings are noncanonical and rejected.

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

The replay mutation has a finite server-owned deadline from an injected
monotonic clock and a derived, reason-free abort signal. The clock is checked
before invocation and immediately after synchronous or asynchronous settlement,
so a store that blocks the event loop past its deadline cannot be accepted even
if its fulfillment microtask beats the delayed timer. Timeout, caller abort,
clock ambiguity, unknown rejection, and any non-void or otherwise ambiguous
store result fail closed. Late fulfillment or rejection remains observed after
the verifier settles.

A production replay store must atomically reject a duplicate evidence id,
nonce, **or originating request id** across every gateway/server process and
retain all three decisions through evidence expiry. One request therefore has
exactly one terminal lifecycle evidence result; concurrent distinct envelopes
for the same request cannot both verify.

## Allowed transitions

Version 1 recognizes only the following explicit transition/metadata matrix:

| Transition | Credential | Account | Plan | Error |
| --- | --- | --- | --- | --- |
| `pending_to_connected` | required | required ChatGPT presence | enum or null | null |
| `pending_to_error` | null | null | null | required non-expiry code |
| `pending_to_expired` | null | null | null | `credential_expired` |
| `pending_to_revoking` | null | null | null | null |
| `connected_to_error` | null | null | null | required non-expiry code |
| `connected_to_expired` | null | null | null | `credential_expired` |
| `connected_to_revoking` | null | null | null | null |
| `error_to_revoking` | null | null | null | null |
| `expired_to_revoking` | null | null | null | null |
| `revoking_to_revoked` | null | null | null | null |
| `revoked_to_deleted` | null | null | null | null |

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
