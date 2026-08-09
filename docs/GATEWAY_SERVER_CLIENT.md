# Next.js gateway server client

`lib/gateway/server-client.ts` is the server-only, Codex-first request boundary
between authenticated Next.js code and the private agent gateway. This slice is
deployment-neutral: it does not read environment variables, open a network
connection, access credentials, or provide a public route.

## Architecture

```text
authenticated server context
  { owner, mindmap, connection, operation, request }
                    |
                    v
        owner-scoped connection resolver
     (Codex + connected + selected default)
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
request body. It accepts only authenticated server-derived owner/resource
context, one connection id, one compile-time gateway operation, one request id,
and an optional abort signal. The operation-to-path table and base path are
fixed in the module. The HTTPS origin and trust dependencies are injected once
when the server client is constructed and are validated before any request.

## Fail-closed contract

- The resolver receives the asserted owner, requested connection, fixed Codex
  provider, and `requireDefault: true`. Missing, cross-owner, mismatched,
  pending, expired, revoked, errored, and non-default results all fail before
  assertion signing.
- The signer receives the fixed issuer/audience and the exact owner,
  connection, provider, operation, and request id. Signer output is opaque,
  bounded, and rejected if it can inject headers.
- Resolver, signer, transport, and response reads are bounded by server-owned
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
3. the Next.js server resolver backed by owner-scoped connection metadata;
4. private routing, certificate, redirect, timeout, and response-size policy;
5. the real Codex account ceremony and credential-isolation validation; and
6. deployment and any database write or migration.

Claude remains deferred. Adding another provider requires a separate reviewed
operation/claim contract; it must not broaden this Codex-only client or create
fallback behavior.
