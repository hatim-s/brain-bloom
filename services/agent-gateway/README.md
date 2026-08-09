# Agent gateway service boundary

This directory starts the separately deployable Node 24 gateway defined by
[ADR 0002](../../docs/adr/0002-subscription-connection-gateway.md). The first
slice is intentionally limited to dependency-free internal request
authentication primitives:

- Ed25519-signed, versioned, Codex-only assertions with a maximum 60-second
  lifetime;
- exact issuer, audience, owner, connection, provider, and operation matching;
- explicit current/previous verification-key overlap; and
- bounded, fail-closed replay defense that consumes signed requests before
  expected-context validation.

```text
Next.js issuer -> signed v1 assertion -> signature + time -> replay consume
                                                         -> context match
                                                         -> later gateway work
```

There is no HTTP listener, credential storage, provider execution, environment
configuration, or deployment in this slice. The persistent host, production
key custody/rotation mechanism, durable replay-state topology, backup policy,
and deployment remain explicit human gates. `BoundedReplayCache` is a
deterministic test/local primitive only. Any real deployment must inject an
atomic `ReplayDefense` whose lifecycle prevents reuse across process restarts;
a multi-process deployment also requires shared replay state.
