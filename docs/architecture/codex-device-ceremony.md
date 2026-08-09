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

The browser projection is closed by construction. It contains only an exact
server-owned URL from the nonempty Codex verification allowlist, a short validated user code
while pending, finite expiry and poll interval, a stable status, and—only after
authorization—an account type plus `present: true`. Provider session references,
tokens, raw output, paths, errors, commands, model choices, environment, and
credential handles never cross that boundary.

The current allowlist contains exactly
`https://auth.openai.com/codex/device`. Normalization is not treated as
authorization: explicit ports, alternate paths, trailing segments, encoded path
variants, user information, query redirects, fragments, sibling or suffix
hosts, and internationalized lookalikes are rejected. The device completion
accepts only an explicit `chatgpt` subscription presence result. Ambient API
keys and every other credential type fail closed.

## Durable-store contract

The production store must make each method atomic and durable across process
restarts:

- `reserve` applies expiry, enforces one active ceremony per connection,
  conceals cross-owner matches, and binds the ceremony to the begin request;
- `recordBegin` atomically activates the first result and retains every terminal
  or distinct race-loser session reference as durable cleanup work;
- `preparePoll` applies expiry and grants at most one revision per poll window;
- `completePoll` accepts a provider result only if that exact revision is still
  pending, fencing completion after cancellation or expiry; and
- `cancel` makes the transition terminal and appends any active provider session
  to cleanup work before returning;
- `claimCleanup` grants one retained reference without deleting it; and
- `completeCleanup` removes only the exact granted revision after an idempotent
  provider cancellation succeeds.

Every method validates owner, connection, request, and ceremony ID together.
An absent or mismatched scope is reported only as `not_found`. Store rejection,
timeout, and ambiguous settlement fail closed; retries recover from the durable
record instead of guessing whether a transition committed.

`reserve` persists a separate server-generated `providerBeginKey` before any
provider call. Provider `begin` must be atomically idempotent by ceremony ID plus
that key across processes and restarts. A retry after provider or store timeout
must recover the same provider session reference. The coordinator defensively
retains and cleans a distinct race-loser reference, but such a result proves the
adapter violated its primary serialization contract. Provider `cancel` must be
idempotent by the same key and reference. Provider polling must be safe to
repeat, and every implementation must honor the supplied abort signal and
deadline.

Caller abort ends only the browser wait. It atomically terminalizes the durable
ceremony while provider settlement continues under an independent bounded
server deadline. A late session reference is recorded before cleanup is tried.
Timeout, rejection, process loss, or ambiguous cleanup completion leaves the
reference durable so a later `cancel` call or worker using the same store
contract can resume it. No original request signal controls cleanup.

## Deferred integration gates

This contract intentionally leaves the following work gated:

1. PR #39's branded Codex-home authority and ownership rules;
2. a real Codex app-server adapter and verified device-login protocol, including
   proof of cross-process atomic idempotency/serialization, restart recovery by
   `providerBeginKey`, and distinct-reference loser cleanup before enablement;
3. an encrypted durable store for provider session state and final credentials;
4. persistent-host selection, key custody, backup, and deployment; and
5. human-authorized live account and recovery testing.

Claude authorization remains deferred. This slice establishes only the
Codex-first ceremony semantics needed by later transport and UI work.
