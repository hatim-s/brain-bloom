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
signature-invalid assertions are not attributed to an owner. Once the internal
signature has authenticated and a server-resolved owner is known, the endpoint
budget is consumed even if replay, request context, media type, size, JSON, or
operation input later rejects the attempt. Authentication failures remain
`unauthorized` even if charging also fails, so budget state cannot become an
authentication oracle.

The rate-budget interface receives both the per-owner and global limits in one
server-owned policy object. A live implementation must consume both dimensions
atomically. Exhaustion maps to `rate_limited`; unavailable or unknown store
failures map to `rate_limit_unavailable`. No store message is returned.

Only an exact `{ "input": ... }` body reaches the selected operation parser.
Provider, operation, model, command, environment, path, and tool policy cannot
be overridden at the envelope level. Each operation parser remains responsible
for a strict operation-specific input schema. The handler receives the verified
claims and a derived abort signal, never raw headers or route policy.

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
