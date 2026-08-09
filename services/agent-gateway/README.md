# Agent gateway service boundary

This directory starts the separately deployable Node 24 gateway defined by
[ADR 0002](../../docs/adr/0002-subscription-connection-gateway.md). Its current
dependency-free contracts include:

- Ed25519-signed, versioned, Codex-only assertions with a maximum 60-second
  lifetime;
- exact issuer, audience, owner, connection, provider, and operation matching;
- explicit current/previous verification-key overlap; and
- bounded, fail-closed replay defense that consumes signed requests before
  expected-context validation;
- a strict AES-256-GCM credential envelope whose complete identity and version
  metadata is authenticated as AAD; and
- injected atomic create/CAS-replace/CAS-delete persistence for idempotent
  credential creation, re-encryption, and deletion.

```text
Next.js issuer -> signed v1 assertion -> signature + time -> replay consume
                                                         -> context match
                                                         -> later gateway work

Codex bundle -> bounded plaintext copy -> AES-256-GCM + canonical AAD
                                      -> encrypted envelope -> atomic adapter
```

There is no HTTP listener, concrete credential database, provider execution,
environment configuration, or deployment in this slice. See
[the encrypted-store contract](../../docs/ENCRYPTED_CONNECTION_STORE.md) for
the storage and rotation invariants. The persistent host and adapter,
production key custody/rotation mechanism, durable replay-state topology,
backup policy, and deployment remain explicit human gates. `BoundedReplayCache` is a
deterministic test/local primitive only. Any real deployment must inject an
atomic `ReplayDefense` whose lifecycle prevents reuse across process restarts;
a multi-process deployment also requires shared replay state. Verification
awaits the injected replay contract before evaluating expected request context.
