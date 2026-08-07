# ADR 0002: Introduce a subscription connection gateway

- Status: Proposed
- Date: 2026-08-08
- Decision owners: Sprig maintainers

## Context

Sprig currently selects one provider for the entire Next.js process through
`SPRIG_AI_PROVIDER`. The Claude path receives one
`CLAUDE_CODE_OAUTH_TOKEN`, while the Codex path uses the app server's saved
`codex login` state. Chat, mind-map generation, and node editing all route
through this process-wide choice.

That boundary is safe only for the documented trusted, single-operator
deployment. It cannot serve multiple Clerk owners: there is no request-scoped
owner or connection identity, every request sees the same provider choice, and
provider subprocesses inherit one operator credential source. Adding a provider
picker to the browser would not fix the confused-deputy risk. The server could
still execute one owner's request with another owner's or the operator's
subscription.

Claude Code and Codex subscription sessions are agent-runtime credentials, not
ordinary browser or public API credentials. Their runtimes spawn local
processes, Codex owns login state on disk, and operations can outlive an
ephemeral request. Sprig therefore needs a persistent server boundary that can
isolate credentials, activate exactly one connection for one authorized
operation, supervise the complete process tree, and survive restarts.

This ADR freezes that boundary before credentials, connection tables, or
production deployment are implemented. It does not select a hosting provider,
approve a Claude connection ceremony, select encryption-key custody, authorize
production database writes, import credentials, perform provider login, or
change any environment.

## Decision

### Persistent gateway boundary

Sprig will introduce a separately deployable, persistent Node 24 subscription
connection gateway. Next.js remains the public authorization and streaming
boundary. The gateway owns provider credential storage, provider-local runtime
state, SDK process execution, process supervision, and secret-redacted audit
events. Convex stores only owner-scoped display and lifecycle metadata plus an
opaque gateway credential handle.

The gateway must run on a persistent host with durable encrypted storage. It
must not be implemented as an ephemeral serverless function. The concrete host
and infrastructure provider remain an unresolved human gate.

### Request-scoped execution context

Every provider execution will use an application-defined, immutable context
containing at least:

- authenticated Clerk owner subject;
- opaque connection identifier;
- provider;
- allowed operation, such as chat, mind-map generation, or node editing;
- unique request identifier and cancellation signal;
- application-selected model and tool policy, when the operation permits them.

Next.js must authorize the owner and resource before resolving the connection.
The gateway must independently verify that the resolved connection belongs to
the asserted owner and provider and that the requested operation is allowed.
It must not accept caller-supplied commands, provider home paths, base URLs,
arbitrary environment variables, or arbitrary model endpoints.

Personal-beta access is default-deny. Next.js and every server-side connection
entry point must check the authenticated Clerk subject against a
server-controlled allowlist before creating connection metadata, issuing an
internal assertion, contacting the gateway, or allowing any connection begin,
poll, validate, select, revoke, delete, or execute operation. An absent,
unavailable, empty, or non-matching allowlist denies the request; browser input
and Convex client data cannot add or override allowed subjects.

Connection endpoints also enforce endpoint-specific request-rate limits that
are separate from execution concurrency and queue limits. Begin, poll,
validate, select, revoke, delete, and execute requests consume bounded
per-owner and global budgets, including rejected attempts where an owner is
known. Limits are defined in server-owned policy, return stable secret-free
errors, and fail closed when the rate-limit state is unavailable. Polling may
have a different finite budget from credential submission or execution, but no
connection endpoint is unlimited.

### Internal request authentication

Next.js will authenticate each gateway request with a versioned signed internal
assertion whose maximum lifetime is 60 seconds. The assertion includes issuer,
audience, subject, connection identifier, provider, operation, request
identifier, issued-at, expiry, and a unique nonce.

The gateway rejects missing or invalid signatures, wrong issuer or audience,
future or expired assertions, provider or operation mismatches, ownership
mismatches, and reused request identifiers or nonces. A bounded replay cache
must retain each nonce after its signature is verified, including attempts
rejected by later ownership or operation checks, for at least the assertion's
validity window. Signing-key rotation must support an explicit current/previous
verification overlap without extending assertion lifetime.

### Provider credential isolation

Each Codex credential receives its own durable `CODEX_HOME`, with filesystem
permissions limited to the unprivileged gateway runtime identity. Two
credentials must never share, merge, or search one home. The gateway will use
the documented Codex device-code ceremony and provider-owned login lifecycle;
the browser receives only the verification URL, user code, expiry, safe status,
and redacted account metadata.

Claude has no currently documented, general third-party subscription OAuth
ceremony equivalent to Codex device code. The roadmap's possible v1 flow is
therefore accurately labeled **Connect with setup token**, in which the owner
runs the official setup command and submits the result once over HTTPS. It must
never be presented as **Sign in with Claude**. Implementing that flow remains
blocked until maintainers recheck the then-current Anthropic terms and official
Agent SDK authentication documentation and explicitly accept the personal,
allowlisted v1 ceremony. The gateway must not automate browser credentials,
cookies, private OAuth clients, or CLI screen scraping.

If the Claude ceremony is approved, its Next.js credential-intake endpoint
must reject an absent, malformed, cross-site, or oversized request before the
token is forwarded. It enforces a finite server-owned body-size limit plus both
CSRF-token and same-origin `Origin` validation, then forwards the setup token
once, in memory, directly to the gateway. The token is never reflected in a
response, sent to analytics, or persisted by Next.js or Convex, including when
validation fails.

There is no API-key fallback and no fallback to the app server operator's
Claude token or Codex login. A missing, expired, revoked, deleted, or invalid
owner connection fails closed. Any temporary operator-only local-development
path is a separate explicitly selected mode, not a gateway fallback and not a
production path.

### Encryption, key versions, and deletion

The gateway credential store will use authenticated envelope encryption. Each
credential payload receives a data-encryption key; the data key is wrapped by
a separately held key-encryption key. Authenticated additional data binds at
least the owner, provider, credential identifier, and credential-format
version. Records include encryption-key and credential-format versions from
the first release so rotation can read the previous version and rewrite with
the current version.

Plaintext credentials may exist only in bounded memory or a provider-required
isolated runtime for the active ceremony or operation. They must not enter
Next.js persistence, Convex, browser responses, logs, traces, exceptions, test
snapshots, analytics, crash metadata, or command arguments. Buffers and
ephemeral directories are destroyed as soon as practical.

Disconnect and owner deletion revoke the connection first, preventing new
execution, then remove encrypted credential state, provider-local homes, data
keys, and recoverable copies according to the approved backup policy. Cleanup
is idempotent, observable through stable secret-free states, and retried on
partial failure. The key-encryption-key custodian, rotation mechanism, recovery
procedure, and backup deletion guarantees remain an unresolved human gate.

### Runtime policy and supervision

The gateway and provider children run as an unprivileged operating-system
identity. Provider processes receive a default-deny environment with only the
credential and variables required for the selected request. API-key variables
and credentials for other providers or owners are always absent.

Tools, network, web search, filesystem reads, filesystem writes, working
directories, and approval behavior are also default-deny. An operation may
enable only Sprig-declared tools and the smallest filesystem or network access
recorded in its server-side policy. Provider output cannot expand these
permissions.

Client abort, timeout, gateway shutdown, provider failure, and connection
revocation cancel the entire child process tree and remove ephemeral working
state. Execution has bounded turn duration, bounded stdout/stderr capture,
per-owner concurrency of one initially, and a small bounded global queue.
Queue overflow and limit exhaustion fail with stable errors rather than
starting untracked work.

Audit records contain only stable event and error codes, request and connection
identifiers, owner-scoped correlation identifiers, provider, operation,
timestamps, duration, queue/cancellation outcome, and process exit category.
Known token patterns, raw provider state, prompts, response content,
environment values, filesystem paths containing credential identifiers, and
provider stdout/stderr are redacted or omitted by default.

### Convex metadata boundary

Convex schema changes are additive. An owner-scoped `aiConnections` record may
contain provider, label, status, opaque `gatewayCredentialId`, authentication
method, redacted provider account hint, display-only plan label, default flag,
timestamps, last validation time, and a stable last error code. Owner-only
queries return display metadata, never secret material. Mutations derive the
owner from Clerk authorization rather than accepting a client-supplied owner.

Owner-facing mutations may create a server-derived `pending` record, choose a
default connection, request validation, or request revocation/deletion. They
cannot supply or directly write provider-validated lifecycle status,
`gatewayCredentialId`, provider account or plan hints, validation timestamps,
or provider-derived error fields. Transitions from `pending` to `connected`,
`error`, or `expired`, later provider-driven status changes, and final
revocation/deletion outcomes occur only through a server-only reconciliation
path after gateway-authenticated evidence. That evidence must bind the owner,
connection, provider, request, and allowed transition; stale, duplicated, or
mismatched evidence is rejected. A client request may start a lifecycle action,
but it is never evidence that provider validation or cleanup succeeded.

Convex must never store plaintext provider tokens, serialized provider homes,
wrapped or unwrapped data keys, gateway encryption keys, internal assertion
signing keys, or raw provider error output. The opaque credential identifier is
not authority by itself; both Next.js and the gateway enforce ownership.

## Security invariants

The gateway implementation and every later connection feature must preserve
these invariants:

1. One Clerk owner cannot list, select, execute, validate, revoke, delete, or
   infer the credential state of another owner.
2. One request activates exactly one explicitly authorized connection,
   provider, and operation.
3. A provider process receives no credential source other than the selected
   connection and cannot silently switch to API billing.
4. Codex homes and all provider runtime state are isolated by credential and
   remain isolated across restarts, logout, cancellation, and failures.
5. Internal assertions are short-lived, audience-bound, operation-bound, and
   single-use within the replay-defense window.
6. Plaintext secrets never cross into browser-visible data, Convex, default
   observability, or another process or owner's runtime state.
7. Deletion and revocation fail closed immediately even when physical cleanup
   must be retried.
8. Provider children cannot gain environment, tool, network, filesystem, or
   approval capability that the server-side operation policy did not grant.
9. Every started provider process is registered with the supervisor and its
   complete process tree can be cancelled deterministically.
10. Neither missing connection state nor gateway failure triggers an API-key or
    operator-login fallback.
11. Personal-beta connection creation and every lifecycle or execution path
    require a server-controlled Clerk-subject allowlist match and otherwise
    deny before metadata, assertion, or gateway side effects.
12. Every connection endpoint has finite per-owner and global request-rate
    budgets, enforced independently of provider concurrency and queue bounds;
    unavailable enforcement state fails closed.
13. Provider-validated connection status, credential handles, account hints,
    validation times, and provider errors change only through server-only
    reconciliation backed by gateway-authenticated evidence, never client
    mutation fields or claimed success.
14. Credential-intake requests are size-bounded and pass both CSRF and
    same-origin `Origin` validation before plaintext is forwarded in memory;
    plaintext is never reflected, analyzed, or persisted.

## Consequences

- Multiple allowlisted Clerk accounts can eventually use independent
  subscription connections without sharing the application operator's state.
- Provider selection becomes an authorized request property instead of a
  process-wide environment choice.
- The system gains another persistent service, encrypted storage, signing-key
  rotation, process supervision, backup, deletion, and operational monitoring
  responsibilities.
- Persistent isolated homes consume more storage than one shared login, and
  per-owner concurrency of one favors isolation and predictable personal-scale
  operation over throughput.
- Connection and chat requests can fail when the gateway is unavailable; they
  must not bypass it through a less secure credential path.
- Claude connection UX remains less seamless than Codex unless Anthropic
  publishes and permits an embeddable subscription-login contract.
- Existing local single-operator configuration may remain useful during an
  explicitly gated migration, but it is not the multi-owner architecture and
  cannot serve as its fallback.

## Validation and enforcement

Before the gateway is allowed to handle real credentials, focused tests and a
disposable harness must prove:

1. Forged, expired, future, replayed, wrong-audience, wrong-provider,
   wrong-operation, and ownership-mismatched assertions fail.
2. Two isolated Codex homes cannot see each other's account or sessions;
   logout and deletion affect only the selected home; a restart reuses only the
   intended persisted login.
3. Credential canaries never appear in browser responses, Convex rows, logs,
   traces, exceptions, snapshots, process listings, or captured output.
4. Provider children inherit the explicit environment allowlist and cannot use
   API keys, another connection, arbitrary tools, network, web search, or
   filesystem access.
5. Client cancellation, timeout, shutdown, provider failure, and revocation
   terminate the entire process tree and remove ephemeral work directories.
6. Per-owner and global concurrency bounds, queue limits, output caps, and turn
   deadlines hold under adversarial load.
7. Encryption round trips bind authenticated metadata; corrupted ciphertext or
   additional data fails; current/previous key rotation works; deleted data
   cannot be activated.
8. Additive Convex queries and mutations enforce owner scope and expose only
   the approved metadata contract.
9. The selected persistent host can spawn both provider runtimes, stream for at
   least five minutes, cancel process trees, retain encrypted state across a
   restart, and meet the measured resource budget.
10. A Clerk subject absent from the personal-beta allowlist cannot begin,
    create, poll, validate, select, revoke, delete, or execute a connection;
    rejection occurs before Convex writes, internal assertions, or gateway
    contact.
11. Endpoint-specific rate tests exhaust per-owner and global budgets for
    begin, poll, validate, select, revoke, delete, and execute paths, prove one
    owner's budget cannot bypass the global bound, and prove unavailable
    limiter state fails closed. Separate load tests prove per-owner execution,
    global concurrency, and queue bounds still hold.
12. Owner-facing mutations cannot set provider-validated status,
    `gatewayCredentialId`, provider account or plan hints, validation time, or
    provider-derived errors; invalid, stale, replayed, or mismatched gateway
    evidence cannot advance lifecycle state, while valid evidence can perform
    only its allowed transition.
13. Oversized Claude setup-token requests and requests with missing or invalid
    CSRF tokens or `Origin` fail before gateway forwarding. Accepted and
    rejected tokens remain absent from responses, analytics, persistence,
    logs, and traces.

Reviews must reject implementation that introduces plaintext connection data,
client-selected provider runtime configuration, shared provider homes,
unbounded execution, credential-bearing logs, or any fallback prohibited by
this ADR. Production database writes, credential ceremonies, host deployment,
environment or binding changes, key initialization, and migrations remain
human-approved operations under repository policy.

## Rollout and rollback

Roll out additively and behind a server-authoritative connections feature flag:

1. Approve the unresolved human gates below and record their outcomes.
2. Prove internal assertions, encryption, provider isolation, cancellation,
   and restart behavior without production credentials or database writes.
3. Deploy additive Convex metadata with connection execution disabled.
4. Deploy gateway health and internal authentication with no real credentials.
5. Enable one allowlisted owner and connect fresh credentials; never scrape or
   automatically import the operator's existing local provider stores.
6. Verify chat, mind-map generation, and node editing use the same
   request-scoped connection contract before enabling more owners.
7. Expand only after cross-owner, deletion, revocation, restart, and audit
   canary tests pass in the production-like environment.

Rollback disables new connection execution and revokes gateway assertions. It
does not restore plaintext credentials, weaken ownership checks, merge provider
homes, or enable API-key/operator-login fallback. Additive metadata may remain
inert while encrypted gateway state is retained or deleted according to the
human-approved rollback and backup policy. A separately configured
single-operator local-development mode may be selected manually where it was
already intended, but rollback must never select it on behalf of a web user.

## Unresolved human gates

This Proposed ADR does not approve any of the following. Implementation that
depends on one must stop until maintainers record an explicit decision:

1. **Concrete host/provider:** select the persistent Node 24 host and
   infrastructure provider, verify its encrypted durable volume, ingress,
   process supervision, backup, restore, and resource characteristics, and
   accept the resulting operational ownership.
2. **Claude v1 ceremony:** immediately before implementation, recheck current
   Anthropic terms and official Claude Code/Agent SDK authentication
   documentation, then explicitly accept or reject the accurately labeled
   personal **Connect with setup token** ceremony for allowlisted owners.
3. **Encryption-key custody and backup policy:** name the key custodian and
   approved secret system, define generation, rotation, recovery, access,
   encrypted-volume backup, restore testing, credential deletion from backups,
   and loss/compromise response.

Until all three are resolved, this record defines a review boundary only; it
does not authorize production credential handling.

## Updating or superseding this decision

This ADR is Proposed. It may be updated while the three gates are being
evaluated, provided changes remain explicit in review. Mark it Accepted only
after all three human decisions are recorded and the validation plan is judged
implementable.

A change to the persistent gateway boundary, request-scoped ownership,
assertion lifetime or replay defense, credential isolation, encryption or
deletion model, default-deny runtime policy, Convex secret boundary, or
fallback prohibition requires a new ADR. The new record must link here and
this record must be marked `Superseded by ADR NNNN`; do not reuse or renumber
ADR 0002.
