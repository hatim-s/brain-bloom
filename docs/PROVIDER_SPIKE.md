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

The executing form starts `codex app-server` with the official
`cli_auth_credentials_store="file"` session flag. After `initialize`, it calls
`config/read` and fails closed unless the effective value is `file` and its
reported origin is the harness's session flag. Only then does it call
`account/read` and start `account/login/start` with exactly
`{"type":"chatgptDeviceCode"}`. It displays the verification URL and one-time
user code, waits for `account/login/completed`, observes `account/updated`, and
captures an allowlisted account summary. Email values, tokens, raw provider
errors, stderr, and protocol messages are never included in output.

To prove logout survives an app-server restart in that same isolated home:

```sh
pnpm provider:spike -- codex-logout-restart --codex-home "$CODEX_SPIKE_HOME"
pnpm provider:spike -- codex-logout-restart --codex-home "$CODEX_SPIKE_HOME" --execute
```

This intentionally logs out the temporary file store. It never targets the
default Codex home or an OS keyring. Codex probes currently fail closed on
Windows because POSIX mode bits cannot validate Windows ACL privacy.

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
asks for one minimal response. It returns only authentication, timing, and turn
metadata; model output and the complete `modelUsage` object are discarded. The
throwaway home is removed afterward.

Both provider environments are built from a small non-credential allowlist.
Ambient OpenAI, Anthropic, and cloud-provider API-key variables are therefore
not inherited as fallback authentication. Output and pending protocol frames
are bounded, provider errors are replaced with stable summaries, and
cancellation terminates the complete provider process tree (POSIX process group
or Windows `taskkill /T`).
