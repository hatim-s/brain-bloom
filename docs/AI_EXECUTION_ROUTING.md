# Request-scoped AI execution routing

Phase 1 introduces one migration boundary shared by chat, first-map generation,
and node editing. It does not configure or deploy the production gateway.

```text
chat -----------------+
first-map generation -+--> SPRIG_CONNECTIONS_V2
node editing ---------+          |
                                 +-- false/unset --> existing operator-only router
                                 |
                                 +-- true --> server resolver
                                                |
                                                +-- owner
                                                +-- default connected Codex id
                                                +-- operation + resource
                                                +-- AbortSignal
                                                       |
                                                       v
                                                GatewayServerClient
```

The v2 caller supplies only the compile-time operation and an abort channel.
The injected server resolver derives the authenticated owner, opaque connection
handle, Codex provider, connected/default state, and resource. The execution
router validates that complete snapshot, creates the request id on the server,
and invokes the existing server-only gateway client. Caller-supplied provider,
connection, owner, provider home, command, model, gateway origin, or environment
fields are rejected before resolution.

The current production composition deliberately has no resolver, assertion
signer, or gateway transport. Exact `SPRIG_CONNECTIONS_V2=true` therefore
reports the established `AI is not configured` boundary and never falls back
to local Claude, local Codex, API keys, or an operator login. Unset or exact
`false` preserves the existing explicitly documented single-operator behavior
during migration. Any other flag value fails closed.

Enabling v2 remains blocked on human approval of the persistent host, signing
key custody and rotation, durable replay/rate stores, production Codex-home
adapter, Convex deployment and personal-beta cohort. This slice performs no
network request, provider login, credential access, database deployment,
environment write, or host configuration.
