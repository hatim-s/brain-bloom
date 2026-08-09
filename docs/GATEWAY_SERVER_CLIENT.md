# Next.js gateway server client

`lib/gateway/server-client.ts` is the server-only, Codex-first request boundary
between authenticated Next.js code and the private agent gateway. This slice is
deployment-neutral: it does not read environment variables, open a network
connection, access credentials, or provide a public route.

## Architecture

```text
server request intent
  { mindmap, connection, operation, request }
                    |
                    v
 atomic server authorization + resolution
 (derive Clerk owner; verify resource + connection;
  canonicalize ids; allow operation/default/Codex)
                    |
                    v
       fixed-context assertion signer
 (issuer + audience + exact request binding)
                    |
                    v
 https://allowlisted-origin/internal/v1/operations/<allowlisted operation>
                    |
                    v
 injected fetch transport (POST, redirect=error, derived abort signal)
                    |
                    v
 bounded JSON stream -> exact status/schema map -> secret-free result/error
```

The invocation API deliberately has no gateway URL, base path, issuer,
audience, provider, command, model, environment, credential, token, or generic
request body or owner authority. It accepts only a narrow resource intent, one
connection id, one compile-time gateway operation, one request id, and an
optional abort signal. Browser-supplied owner or context fields are rejected.
The operation-to-path table and base path are fixed in the module. The HTTPS
origin must be an exact member of a nonempty construction-time allowlist.
Allowlist entries reject userinfo, trailing dots, localhost/local names, IP and
private/link-local literals, Unicode/punycode confusables, and noncanonical
default ports. A non-default port is permitted only as an exact explicit
allowlist entry. Validation performs no DNS lookup.

## Fail-closed contract

- One injected server dependency derives the current Clerk subject internally,
  atomically verifies resource and connection ownership, verifies Codex,
  connected/default status and the allowed operation, and returns canonical
  resource/connection ids. Its result type is not part of the execute API.
  Missing, malformed, cross-owner, mismatched, unavailable, and timed-out
  results all produce the same secret-free `authorization_unavailable`/404
  outcome before signing, preventing a resource/connection existence oracle.
- The signer receives the fixed issuer/audience and only the resolved owner,
  canonical connection, provider, operation, and request id. Signer output is
  opaque, bounded, and rejected if it can inject headers.
- Authorization, signer, transport, and response reads are bounded by server-owned
  deadlines. Derived reason-free abort signals are sent to dependencies. Late
  fulfillment and rejection remain observed after timeout or caller abort.
- Transport always uses `POST`, `application/json`, `redirect: "error"`, the
  fixed operation URL, and a request body containing only the server-derived
  resource reference. Redirected, cross-origin, cross-path, missing-body, and
  non-JSON responses fail closed.
- Response bytes and chunks are bounded while streaming. Only exact gateway
  success/error schemas and exact error-status pairs are accepted. Dependency
  messages, response bodies, assertion bytes, and abort reasons never appear
  in public errors.
- A response body is disposed behind a finite cleanup bound whenever transport
  fulfillment arrives after timeout/abort or metadata, routing, status,
  content-type, JSON, or schema validation rejects it. Cleanup failures and
  late settlement are always observed and never replace the stable outcome.
- There is no API-key, operator-login, alternate-provider, or credential-store
  fallback.

`createFetchGatewayTransport` adapts an explicitly supplied fetch-compatible
function. The module never captures global `fetch`; tests use injected fakes.

## Human gates before live wiring

This slice does not authorize deployment or real credential use. Live wiring
still requires human approval of:

1. the persistent gateway host and exact HTTPS origin;
2. the internal assertion issuer, audience, signing-key custody, rotation, and
   backup procedure;
3. the Next.js server authority resolver backed by owner-scoped metadata;
4. private routing, certificate, redirect, timeout, and response-size policy;
5. the real Codex account ceremony and credential-isolation validation; and
6. deployment and any database write or migration.

Claude remains deferred. Adding another provider requires a separate reviewed
operation/claim contract; it must not broaden this Codex-only client or create
fallback behavior.
