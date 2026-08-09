# Encrypted connection store contract

The agent gateway now has a pure, injected contract for storing opaque Codex
credential bundles. This is a cryptographic and persistence boundary, not a
deployment: it reads no environment variables, opens no database or network
connection, and does not acquire or use a real credential.

## Architecture

```text
provider-owned bytes
        |
        v
 bounded temporary copy -- clear --> AES-256-GCM
                                      |       ^
 canonical AAD -----------------------+       |
                                              |
 encrypted v1 envelope -> atomic persistence-+
      create-if-absent / CAS replace / CAS delete

 read -> strict envelope validation -> current|previous key -> decrypt
                                                          -> callback -> clear
```

`EncryptedConnectionStore` accepts three injected capabilities:

1. An atomic `EncryptedCredentialPersistence` implementation.
2. One current 256-bit Node secret `KeyObject` and, during rotation, at most one
   previous key.
3. A nonce/revision source. The default uses Node's cryptographic randomness;
   deterministic sources exist only for tests.

The contract never asks a key to export its bytes. Plaintext is copied into a
bounded temporary buffer for encryption and cleared in `finally`. Decryption is
available only inside `use`'s callback lifetime; that buffer is also cleared in
`finally`. A callback must not retain an alias and must clear any copy it makes.

## Versioned envelope and authenticated metadata

Envelope version 1 uses AES-256-GCM with a 96-bit nonce and 128-bit tag. It
persists ciphertext plus closed scalar metadata. Canonical AAD authenticates:

- envelope and algorithm version;
- exact owner id;
- provider (`codex` only in this phase);
- gateway credential id;
- provider-owned credential format version;
- encryption key version;
- mutation id; and
- record revision.

Every object is exact-key validated. IDs, versions, nonce, tag, ciphertext, and
plaintext have fixed or explicit upper bounds. Equivalent padded or malformed
base64url encodings, custom prototypes, symbols, omitted fields, and extension
fields fail closed. Store-generated errors use a closed code/message set and do
not include adapter failures, ciphertext, plaintext, identifiers, or provider
details.

## Atomicity and idempotency

The persistence adapter owns the actual transaction mechanism. It must provide:

- atomic create-if-absent, returning the winning record on conflict;
- atomic replace only when `recordRevision` still matches; and
- atomic delete only when `recordRevision` still matches.

Create retries are idempotent only when the existing authenticated record has
the same mutation id. A different mutation cannot overwrite a credential.
Delete is idempotent when the record is absent, but refuses to delete a record
that changed after the read. These rules prevent a stale operation from
overwriting or deleting a concurrent winner.

## Rotation

Normal reads accept the current key and the explicitly configured previous key.
No other key version is tried. Rotation follows this sequence:

```text
read previous-key record -> authenticate/decrypt -> encrypt with current key
                           -> CAS old revision -> clear plaintext
```

A current-key record is an authenticated no-op. If a concurrent writer already
completed the same transition, its current-key envelope is authenticated and
accepted as the idempotent outcome. Any other CAS conflict fails closed. The
previous key can be removed only after every retained envelope has been
re-encrypted and that fact has been independently verified.

## Human-gated production work

This change deliberately does not choose or configure:

- a KMS/HSM or production key generation, custody, recovery, and destruction
  policy;
- key-version allocation, rotation scheduling, or completion audit procedure;
- a persistent database, transaction schema, backup policy, or retention
  policy;
- a gateway host or deployment topology; or
- real Codex login, credential capture, migration, or provider execution.

Those choices require human approval. A production adapter must be reviewed for
the exact atomic semantics above before any environment, key, database,
credential, host, or deployment is changed.
