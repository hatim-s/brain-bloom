# Provider seam Phase 0 spike

This disposable operator harness probes subscription-auth seams outside every
production request path. It does not change Sprig's provider router, database,
or deployment. Every command is a dry run unless a human adds `--execute`.

The Codex request names and payloads follow the
[official App Server protocol](https://developers.openai.com/codex/app-server).

## Codex device-code ceremony

Create a new private temporary directory for each proof. The harness rejects
the ordinary `~/.codex` home, non-temporary paths, and directories accessible
to group or other users.

```sh
CODEX_SPIKE_HOME="$(mktemp -d)"
pnpm provider:spike -- codex-device --codex-home "$CODEX_SPIKE_HOME"
pnpm provider:spike -- codex-device --codex-home "$CODEX_SPIKE_HOME" --execute
```

The executing form starts `codex app-server`, performs `initialize`, calls
`account/read`, and starts `account/login/start` with exactly
`{"type":"chatgptDeviceCode"}`. It displays the verification URL and one-time
user code, waits for `account/login/completed`, observes `account/updated`, and
captures an allowlisted account summary. Email values, tokens, and raw protocol
messages are never included in output.

To prove logout survives an app-server restart in that same isolated home:

```sh
pnpm provider:spike -- codex-logout-restart --codex-home "$CODEX_SPIKE_HOME"
pnpm provider:spike -- codex-logout-restart --codex-home "$CODEX_SPIKE_HOME" --execute
```

This intentionally logs out the temporary home. It never targets the default
Codex home.

## Claude setup-token validation

Generate or retrieve the setup token separately. The probe accepts it only on
stdin; it has no token argument and does not read a token from the parent
environment.

```sh
pnpm provider:spike -- claude-token
pnpm provider:spike -- claude-token --execute < /path/to/private-token-file
```

The executing form creates a throwaway home, passes the token only to the
isolated Claude child environment, disables tools and session persistence, and
asks for one minimal response. It returns only authentication, timing, turn,
and model-name metadata. The throwaway home is removed afterward.

Both provider environments are built from a small non-credential allowlist.
Ambient OpenAI, Anthropic, and cloud-provider API-key variables are therefore
not inherited as fallback authentication. Output is bounded, error text is
redacted, and cancellation terminates the provider process group.
