# Gateway request dispatch boundary

This slice defines deployment-neutral request-dispatch primitives for the
Codex-first subscription gateway. It does not open a socket, start a provider
process, read credentials, choose a host, or write deployment or database
state.

## Architecture

The embedding HTTP adapter is responsible only for turning its request into the
bounded byte-stream envelope. It must construct the route and expected context
from server-owned routing and authorization state; neither value comes from the
JSON body.

```text
trusted Next.js assertion       server-owned request context
             |                              |
             +---------------+--------------+
                             v
HTTP adapter (future) -> exact route/method -> assertion + replay verification
                                                   |
                         signed mismatch ----------+----> charge known owner
                                                   |
                                                   v
                              atomic endpoint owner/global rate budget
                                                   |
                                                   v
                              content type -> bounded bytes -> strict JSON
                                                   |
                                                   v
                                  immutable Codex operation registry
                                                   |
                                                   v
                                  abort/timeout-aware async handoff
```

Authentication occurs before body parsing. Missing, malformed, or
signature-invalid assertions are not attributed to an owner. Signature
authentication is a narrow first stage that trusts no unparsed assertion claim.
Once a configured key authenticates the raw bytes and a server-resolved owner is
known, the endpoint budget is awaited before canonical encoding, claim, replay,
request context, media type, size, JSON, or operation validation. The remaining
assertion validation still runs when the budget rejects, preserving replay
consumption for structurally valid signed attempts. An invalid signed assertion
remains `unauthorized`, so budget state does not become an authentication oracle.

The rate-budget interface receives both the per-owner and global limits in one
server-owned policy object. A live implementation must consume both dimensions
atomically. Exhaustion maps to `rate_limited`; unavailable or unknown store
failures and deadline expiry map to `rate_limit_unavailable`. Replay-store
failure or deadline expiry maps to `replay_defense_unavailable`. Each store call
has a finite server-owned deadline and receives a reason-free cancellation
signal plus the absolute deadline for cooperative cancellation. Before signature
authentication, caller abort returns immediately without attributing work. After
signature authentication, caller disconnect is recorded separately and cannot
cancel rate or replay accounting. The dispatcher returns `request_aborted` only
after both bounded accounting fences succeed. No store message, abort reason, or
deadline detail is returned.

A deadline is an ambiguous control-plane outcome: the store may have committed
before its response was lost. The dispatcher therefore fails closed, continues
replay verification under a separate server-owned deadline after a rate-budget
timeout, and never proceeds to body ingestion or execution. Caller abort during
that fence does not cancel it. If replay commits, a retry with the same valid
assertion is rejected. Durable budget and replay implementations must use the
request/nonce identifiers atomically and idempotently; they must never interpret
timeout as proof that no write occurred. Late promise resolution or rejection is
observed, while request listeners and timers are removed through one settlement
path. Store methods are trusted adapters and must return without synchronously
blocking the event loop; only their asynchronous result is deadline-preemptible.

If replay enforcement itself is unavailable or reaches its deadline, the
dispatcher returns `replay_defense_unavailable`, taking precedence over a prior
rate failure or caller abort. It cannot truthfully guarantee non-retryability
without a durable atomic replay store: the first request did not execute, and a
later retry may be accepted once if no deny record committed. Production
enablement therefore requires durable replay persistence whose write can finish
independently of the caller connection and whose recovery path detects a late
commit. When replay succeeds, error precedence is signed-assertion/replay denial,
then rate failure, then recorded caller abort.

Only an exact `{ "input": ... }` body reaches the selected operation parser.
Provider, operation, model, command, environment, path, and tool policy cannot
be overridden at the envelope level. Each operation parser remains responsible
for a strict operation-specific input schema. The handler receives the verified
claims and a derived abort signal, never raw headers or route policy.

Streaming input is bounded independently by total bytes, non-empty chunk count,
and one wall-clock read deadline. Zero-byte chunks are invalid, exact-limit
one-byte chunks are accepted, and the next chunk fails closed. Abort and deadline
can interrupt a stalled iterator read; rejection requests iterator cleanup with
a finite cleanup grace period, so a hostile `return()` hook cannot hang the
response. Execution uses a separate timeout and an idempotent terminal-state
guard: an abort or timeout that wins before the queued handoff prevents the
operation callback from starting.

The future transport adapter is a trusted boundary and must provide an
`AsyncIterable` whose iterator construction and `next()` implementation do not
perform synchronous blocking work. JavaScript can race an asynchronous
`next()` result against abort and deadline, but it cannot preempt code that
blocks the event loop synchronously. Raw socket parsing remains the HTTP
adapter's responsibility.

## Stable outcomes

The dispatcher returns fixed JSON error codes and status values. Exception
messages, assertion details, rate-store errors, abort reasons, and operation
errors are never reflected. A future HTTP adapter may add correlation headers,
but it must not add raw provider, credential, body, or exception data.

## Human gates and deferred work

The following remain deliberately outside this slice:

- persistent gateway host and HTTP framework;
- TLS, network ingress, and service identity deployment;
- internal signing-key custody and rotation deployment;
- durable replay and atomic rate-budget stores;
- concrete rate limits and window tuning;
- Codex credential homes, login ceremony, process supervision, and tool policy;
- provider model selection and operation-specific production schemas;
- any environment, secret, Convex, migration, or production database change;
- Claude connection support, which remains deferred until separately approved.

Those decisions require the corresponding human and security gates before a
listener or provider runtime can be enabled.
