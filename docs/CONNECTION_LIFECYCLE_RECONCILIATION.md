# Connection lifecycle reconciliation

The Phase 1 reconciliation mutation is an internal-only Convex boundary. It
accepts a closed, versioned `GatewayLifecycleSnapshot` only after a future
gateway-evidence verifier has authenticated the snapshot. There is deliberately
no public route, signature-verification shortcut, credential flow, or deploy in
this slice.

```text
Gateway cleanup or validation
           |
           | signed lifecycle evidence (future prerequisite)
           v
  signature + audience + replay verifier
           |
           | authenticated GatewayLifecycleSnapshot
           v
  internal Convex reconciliation mutation
           |
           +-- exact owner + connection + Codex binding
           +-- revision and evidence/request replay checks
           +-- monotonic transition policy
           +-- provider-safe metadata projection
           v
  aiConnections + durable receipt ledger (one transaction)
```

## Contract and safety boundary

- Version 1 snapshots bind owner, connection, provider, evidence id, request
  id, revision, and a status-specific state object.
- Evidence and request ids are globally single-use. An exact duplicate is an
  idempotent no-op; reuse with any changed binding or payload is rejected.
- Revisions begin at one and advance by exactly one. Stale, skipped,
  cross-owner, cross-connection, and non-Codex evidence fails with stable,
  secret-free errors.
- Teardown has one fail-closed graph: every nonterminal state must enter
  `revoking`, only gateway cleanup evidence may advance `revoking` to
  `revoked`, and only `revoked` may advance to the final `deleted` tombstone.
  No terminal state can repeat with fresh evidence or return to an executable
  state.
- Entering `revoking` immediately clears public account, plan, validation, and
  error metadata, while retaining only the internal opaque credential handle
  required for cleanup. `revoked` and `deleted` clear that handle.
- The opaque handle and closed ChatGPT subscription metadata are established
  exactly once by `pending` to `connected`. Later validation, failure,
  expiration, recovery, and teardown snapshots cannot echo, replace, inject,
  or clear the handle; reconciliation derives it from the stored record until
  `revoking` to `revoked` clears it.
- Gateway credential handles, reconciliation revisions, evidence ids, request
  ids, and owners are absent from public connection projections. Free-form
  account hints and plan labels are neither stored nor projected. Public
  metadata uses only the fixed `chatgpt_subscription` account type, a small
  plan enum, and closed stable provider error codes.
- Server-only cleanup does not consult the personal-beta allowlist, so
  de-allowlisting cannot strand a credential in `revoking`. It cannot create,
  select, validate, or reactivate a connection.

## Receipt capacity gate

The receipt ledger is intentionally not pruned in this slice because snapshots
do not yet carry a verifier-authenticated expiry or replay-retention horizon.
Deleting receipts now would weaken the globally single-use evidence/request
contract. The meaningless `pending` to `pending` transition is rejected to
avoid a no-op growth path. Before deployment, the signed-evidence verifier and
capacity design must define a bounded retention interval that is at least as
long as the accepted evidence lifetime; only then may a server-only cleanup job
delete expired receipts without reopening replay.

## Human deployment gate

This change only updates source and generated local types. Replacing the former
free-form account/plan fields with closed enums requires a human-reviewed check
that no deployed row uses the removed fields, or an explicit data migration.
Do not run a Convex deployment or migration without explicit human approval.
Before wiring any caller, implement and review the signed lifecycle-evidence
verifier described in ADR 0002: signature, issuer, audience, expiry, owner,
connection, provider, operation, request, and replay checks must complete before
the internal mutation is invoked. Production credentials, environment changes,
database writes, and gateway deployment remain out of scope.
