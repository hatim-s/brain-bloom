# Gateway operation protocol v1

This protocol is the closed server-to-gateway seam for the three Codex operations
already authorized by internal assertions. It defines transport contracts only;
it does not enable a provider process, credentials, networking, database writes,
deployment, or application entrypoint routing.

## Authority model

- Chat and node editing require an owned mindmap intent. The server resolver
  replaces the requested id with its canonical owned id, and the gateway route
  validates that exact canonical authority before execution.
- First-map generation cannot claim ownership of a map that does not exist. It
  uses the fixed `owner-bootstrap/create-first-mindmap` capability. The resolver
  must authenticate the owner and default connected Codex connection atomically;
  neither an owner id nor a synthetic map id crosses in the payload.
- Provider, connection, owner, gateway origin, route, assertion, model, command,
  credential home, and environment remain construction-time server authority.

```text
validated server intent
        |
        v
atomic authority resolver -----> canonical owned map
        |                         or owner bootstrap capability
        v
short-lived signed operation assertion
        |
        v
fixed HTTPS operation route ---> v1 envelope validation
                                  | operation + resource exact match
                                  v
                         server-owned executor registry
                                  |
                     +------------+-------------+
                     |                          |
                bounded JSON              bounded stream
                action result             chat response
```

## Response lifecycle

Action responses use the existing strict JSON success/failure envelope and add
operation-specific result validation. Chat uses the fixed versioned content type
`application/vnd.sprig.chat-stream+octet-stream;version=1`. The dispatcher
validates each closed application event and serializes it as one versioned NDJSON
frame. The client incrementally decodes frames into application chat events and
returns a zero-buffer, demand-driven `ReadableStream`; it does not read the
gateway body before its consumer requests data.

The fixed request deadline remains active for the stream lifetime. Caller abort,
deadline, consumer cancellation, malformed chunks, length mismatch, or byte/chunk
overflow cancels and releases the upstream reader. Redirects, response URL drift,
unexpected status/content type, unbounded header values, and late response bodies
fail closed. Signed operations are sent once and never retried.

## Human-gated follow-ups

Production composition still requires separate review of the persistent gateway
host, key custody and rotation, durable replay/rate stores, encrypted credential
home adapter, Convex deployment, beta cohort, and real Codex login. Application
entrypoints must pass their validated operation inputs and use these action/chat
APIs in a later reviewed slice.
