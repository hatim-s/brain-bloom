# Encrypted connection store contract

The agent gateway now has a pure, injected contract for storing opaque Codex
credential bundles. This is a cryptographic and persistence boundary, not a
deployment: it reads no environment variables, opens no database or network
connection, and does not acquire or use a real credential.

## Architecture

```text
provider-owned bytes
        |
        | transfer ownership
        v
 fresh random DEK -> AES-256-GCM payload -> ciphertext + tag
        |                    ^
        |                    +-- canonical payload AAD
        v
 current versioned KEK -> AES-256-GCM wrap -> wrapped DEK + tag
                                      ^
                                      +-- canonical wrap AAD
        |
        +-- clear payload, DEK, and random buffers before any await
        v
 encrypted v1 envelope -> atomic persistence
      create-if-absent / CAS replace / CAS delete

 read -> strict snapshot/validation -> current|previous KEK -> unwrap DEK
                                                              -> decrypt
                                                              -> callback
                                                              -> clear
```

`EncryptedConnectionStore` accepts three injected capabilities:

1. An atomic `EncryptedCredentialPersistence` implementation.
2. One current 256-bit Node secret key-encryption key (KEK) `KeyObject` and,
   during rotation, at most one previous KEK.
3. A DEK/nonce/revision source. The default uses Node's cryptographic
   randomness. The injected form exists to test fail-closed randomness paths;
   a production host must use the default and must not supply a deterministic
   implementation.

The KEK never encrypts credential bytes directly and the contract never exports
it. A fresh 256-bit data-encryption key (DEK) encrypts each credential; the KEK
wraps only that DEK. Passing a credential `Buffer` to `store` transfers
ownership immediately after the Buffer type check and before payload bounds or
hostile metadata are inspected. The caller must not retain or reuse it. One
outer clearing scope covers invalid metadata, empty/oversized input, randomness
failure, collision, encryption failure, adapter error, and success. Valid input
is therefore cleared synchronously after encryption and before persistence is
called. Buffers returned by the injected randomness source transfer ownership
under the same rule and are cleared on wrong size, rejection, or later failure.
Length checks and clearing use captured typed-array intrinsics, so hostile own
`byteLength`, `length`, or `fill` overrides cannot bypass or intercept cleanup.
Decryption is available only inside `use`'s callback lifetime and is cleared in
`finally`; a callback must not retain an alias and must clear any copy it creates.

## Versioned envelope and authenticated metadata

Envelope version 1 uses independent AES-256-GCM invocations with 96-bit nonces
and 128-bit tags for the payload and DEK wrap. It persists ciphertext, the
wrapped DEK, and closed scalar metadata. Both canonical AAD layers authenticate:

- envelope and algorithm version;
- exact owner id;
- provider (`codex` only in this phase);
- gateway credential id;
- provider-owned credential format version;
- KEK version;
- immutable creation operation id;
- rotation sequence and optional last rotation operation id; and
- record revision.

The wrap layer additionally authenticates the payload nonce, authentication
tag, and ciphertext digest. This prevents a wrapped DEK from being spliced onto
a different payload envelope.

Every object is exact-key validated. IDs, versions, nonce, tag, ciphertext, and
plaintext have fixed or explicit upper bounds. Equivalent padded or malformed
base64url encodings, custom prototypes, proxies, accessors, symbols, hidden or
omitted fields, and extension fields fail closed. Inputs, records, and adapter
outcomes are read once from data descriptors into fresh frozen plain snapshots;
untrusted objects are never spread or read again after validation.
Store-generated errors use a closed code/message set and do not include adapter
failures, ciphertext, plaintext, identifiers, or provider details.

## Randomness and invocation bounds

The production default uses Node's CSPRNG for every DEK and nonce. All-zero
material and a duplicate payload/wrap nonce within one envelope are rejected.
The store retains bounded in-memory fingerprints to reject a repeated DEK or a
repeated wrap nonce under its current KEK, and permits at most 65,536 KEK-wrap
encryptions per store instance. Failed attempts consume their material rather
than making it reusable. A payload-nonce repeat across records is harmless only
because every record has a unique DEK and therefore a separate nonce domain.

The in-memory ledger cannot prove uniqueness across independent processes or a
restart. A production host must allocate the fleet's invocation budget, prevent
simultaneous uncoordinated use of one KEK, and rotate before any instance or
fleet budget is exhausted. The final persistent topology and KEK policy are
human gates; until they enforce this invariant, this contract must not be used
with production credentials.

## Atomicity and idempotency

The persistence adapter owns the actual transaction mechanism. It must provide:

- atomic create-if-absent, returning the winning record on conflict;
- atomic replace only when `recordRevision` still matches; and
- atomic delete only when `recordRevision` still matches.

Create retries are idempotent only when the existing authenticated record has
the same immutable creation operation id and exact credential bytes. Payloads
are compared through short-lived SHA-256 digests using a constant-time compare;
both decrypted payloads and digests are cleared synchronously. A same-id,
different-payload collision is a stable conflict with no write. A different
creation operation cannot overwrite a credential. Delete is idempotent when the
record is absent, but refuses to delete a record that changed after the read.

A create response can be lost after the adapter commits. The store retains only
the prepared encrypted candidate across that await. On a rejected or malformed
create outcome, it performs one read using the immutable identity, snapshots
and authenticates the winning envelope, and compares its creation id and exact
payload with the encrypted candidate. An exact committed write returns
`already_created`; a different lineage or payload is a stable conflict. A
missing, malformed, or unavailable reconciliation returns
`persistence_unavailable` rather than guessing.

The adapter must therefore provide read-after-write consistency for a create
that committed before returning an ambiguous outcome. This is part of the
persistent-adapter human gate and must be verified against the selected store.

The transferred Buffer is zeroed regardless of that outcome. If the process
terminates or reconciliation is unavailable, a later process must reacquire a
fresh provider-owned credential Buffer for an idempotent retry; it must never
reuse the zeroed Buffer or retain a plaintext recovery copy. The immutable
creation id and payload binding make that fresh retry safe, including after key
rotation.

## Rotation

Normal reads accept the current key and the explicitly configured previous key.
No other key version is tried. Rotation follows this sequence:

```text
read previous-KEK record -> unwrap/decrypt -> fresh DEK + current KEK wrap
                          -> clear plaintext/DEK -> CAS old revision
```

A record preserves `creationOperationId` forever. Rotation has a separate
`lastRotationOperationId` and monotonic bounded sequence, so a delayed create
retry remains valid after re-encryption or restart. Reusing the creation id as a
rotation id is rejected. A current-KEK record is an
authenticated no-op. If a concurrent writer completed the same payload
transition, its current-KEK envelope is authenticated and accepted; a changed
payload or other CAS conflict fails closed. Current and previous labels cannot
refer to equal key material. The previous KEK can be removed only after every
retained envelope has been re-encrypted and independently verified.

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
