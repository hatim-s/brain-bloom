# Codex device authorization ceremony

Status: Phase 1 contract only; not a deployable provider integration.

## Boundary

`services/agent-gateway/codex-device-flow.ts` defines a pure coordinator between
an injected `CodexDeviceClient` and an injected durable
`CodexDeviceCeremonyStore`. It does not start Codex, log in, read or write a
home directory, persist credentials, open a listener, call a network service,
or deploy infrastructure.

```text
signed gateway request
        |
        v
 begin / poll / cancel
        |
        +---- atomic durable transition ---- ceremony record
        |                                      (server only)
        v
 idempotent CodexDeviceClient call
        |
        +---- fenced atomic completion ----> safe browser projection
```

The browser projection is closed by construction. It contains only a
server-configured official HTTPS verification URL, a short validated user code
while pending, finite expiry and poll interval, a stable status, and—only after
authorization—an account type plus `present: true`. Provider session references,
tokens, raw output, paths, errors, commands, model choices, environment, and
credential handles never cross that boundary.

## Durable-store contract

The production store must make each method atomic and durable across process
restarts:

- `reserve` applies expiry, enforces one active ceremony per connection,
  conceals cross-owner matches, and binds the ceremony to the begin request;
- `activate` moves only the matching starting record to pending;
- `preparePoll` applies expiry and grants at most one revision per poll window;
- `completePoll` accepts a provider result only if that exact revision is still
  pending, fencing completion after cancellation or expiry; and
- `cancel` makes the transition terminal and idempotent before provider cleanup.

Every method validates owner, connection, request, and ceremony ID together.
An absent or mismatched scope is reported only as `not_found`. Store rejection,
timeout, and ambiguous settlement fail closed; retries recover from the durable
record instead of guessing whether a transition committed.

The provider `begin` and `cancel` methods must be idempotent by the
server-generated ceremony ID. This is required because a dependency can commit
and settle after the caller's deadline. Provider polling must be safe to repeat,
and every implementation must honor the supplied abort signal and deadline.

## Deferred integration gates

This contract intentionally leaves the following work gated:

1. PR #39's branded Codex-home authority and ownership rules;
2. a real Codex app-server adapter and verified device-login protocol;
3. an encrypted durable store for provider session state and final credentials;
4. persistent-host selection, key custody, backup, and deployment; and
5. human-authorized live account and recovery testing.

Claude authorization remains deferred. This slice establishes only the
Codex-first ceremony semantics needed by later transport and UI work.
