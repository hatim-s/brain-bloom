import { createSecretKey } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  type CreateCredentialResult,
  type CredentialEncryptionKey,
  type CredentialIdentity,
  type CredentialMutation,
  type CredentialRandomSource,
  CredentialStoreError,
  type DeleteCredentialResult,
  EncryptedConnectionStore,
  type EncryptedCredentialPersistence,
  MAX_CREDENTIAL_BYTES,
  type ReplaceCredentialResult,
  type StoredCredentialEnvelope,
} from "./encrypted-connection-store.ts";

const OWNER_ID = "user_0123456789ABCDEF";
const OTHER_OWNER_ID = "user_FEDCBA9876543210";
const CREDENTIAL_ID = "gwcred_v1_00000000-0000-4000-8000-000000000001";
const OTHER_CREDENTIAL_ID = "gwcred_v1_00000000-0000-4000-8000-000000000002";
const OPERATION_ID = "mutation_v1_00000000-0000-4000-8000-000000000001";
const OTHER_OPERATION_ID = "mutation_v1_00000000-0000-4000-8000-000000000002";
const SECRET_CANARY = "sk-secret-never-reflect";

const IDENTITY: CredentialIdentity = Object.freeze({
  ownerId: OWNER_ID,
  provider: "codex",
  credentialId: CREDENTIAL_ID,
  credentialFormatVersion: 1,
});
const MUTATION: CredentialMutation = Object.freeze({
  ...IDENTITY,
  operationId: OPERATION_ID,
});

/** Creates a 256-bit secret KeyObject, then clears its construction buffer. */
function createEncryptionKey(
  keyVersion: string,
  fill: number
): CredentialEncryptionKey {
  const bytes = Buffer.alloc(32, fill);
  try {
    return Object.freeze({ keyVersion, key: createSecretKey(bytes) });
  } finally {
    bytes.fill(0);
  }
}

/** Produces unique valid nonces and revisions without ambient randomness. */
function createRandomSource(seed = 1): CredentialRandomSource {
  let sequence = seed;
  return Object.freeze({
    nonce: () => {
      const nonce = Buffer.alloc(12);
      nonce.writeUInt32BE(sequence, 8);
      sequence += 1;
      return nonce;
    },
    recordRevision: () => {
      const suffix = sequence.toString(16).padStart(12, "0");
      sequence += 1;
      return `revision_v1_00000000-0000-4000-8000-${suffix}`;
    },
  });
}

/** Atomic in-memory adapter used only to prove the injected persistence contract. */
class MemoryPersistence implements EncryptedCredentialPersistence {
  record: StoredCredentialEnvelope | null = null;
  beforeReplace?: () => void;
  beforeDelete?: () => void;

  async read(identity: CredentialIdentity) {
    return this.matches(identity) ? this.record : null;
  }

  async create(
    record: StoredCredentialEnvelope
  ): Promise<CreateCredentialResult> {
    if (this.record !== null) return { status: "exists", record: this.record };
    this.record = record;
    return { status: "created" };
  }

  async replace(
    record: StoredCredentialEnvelope,
    expectedRecordRevision: string
  ): Promise<ReplaceCredentialResult> {
    this.beforeReplace?.();
    this.beforeReplace = undefined;
    if (this.record === null) return { status: "missing" };
    if (this.record.recordRevision !== expectedRecordRevision) {
      return { status: "conflict", record: this.record };
    }
    this.record = record;
    return { status: "replaced" };
  }

  async delete(
    identity: CredentialIdentity,
    expectedRecordRevision: string
  ): Promise<DeleteCredentialResult> {
    this.beforeDelete?.();
    this.beforeDelete = undefined;
    if (!this.matches(identity)) return { status: "missing" };
    if (this.record?.recordRevision !== expectedRecordRevision) {
      return {
        status: "conflict",
        record: this.record as StoredCredentialEnvelope,
      };
    }
    this.record = null;
    return { status: "deleted" };
  }

  /** Simulates an atomic writer that wins between read and CAS. */
  replaceOutOfBand(record: StoredCredentialEnvelope): void {
    this.record = record;
  }

  private matches(identity: CredentialIdentity): boolean {
    return (
      this.record !== null &&
      this.record.ownerId === identity.ownerId &&
      this.record.provider === identity.provider &&
      this.record.credentialId === identity.credentialId &&
      this.record.credentialFormatVersion === identity.credentialFormatVersion
    );
  }
}

const CURRENT_KEY = createEncryptionKey("encryption-v1-00000002", 2);
const PREVIOUS_KEY = createEncryptionKey("encryption-v1-00000001", 1);

/** Creates an isolated store fixture with deterministic randomness. */
function createFixture(
  options: Readonly<{
    persistence?: MemoryPersistence;
    current?: CredentialEncryptionKey;
    previous?: CredentialEncryptionKey;
    seed?: number;
  }> = {}
) {
  const persistence = options.persistence ?? new MemoryPersistence();
  const store = new EncryptedConnectionStore(
    persistence,
    {
      current: options.current ?? CURRENT_KEY,
      ...(options.previous ? { previous: options.previous } : {}),
    },
    createRandomSource(options.seed)
  );
  return { persistence, store };
}

/** Reads plaintext inside the store's bounded callback lifetime. */
async function readBytes(
  store: EncryptedConnectionStore,
  identity: CredentialIdentity = IDENTITY
): Promise<Uint8Array> {
  return store.use(identity, (payload) => Uint8Array.from(payload));
}

describe("EncryptedConnectionStore", () => {
  it("encrypts an opaque Codex bundle and never persists plaintext", async () => {
    const { persistence, store } = createFixture();
    const payload = Buffer.from(`{"access_token":"${SECRET_CANARY}"}`);

    const result = await store.store(MUTATION, payload);

    expect(result.status).toBe("created");
    expect(persistence.record?.algorithm).toBe("aes-256-gcm");
    expect(persistence.record?.envelopeVersion).toBe(1);
    expect(JSON.stringify(persistence.record)).not.toContain(SECRET_CANARY);
    expect(Buffer.from(await readBytes(store)).toString("utf8")).toBe(
      payload.toString("utf8")
    );
    // The store copies caller-owned bytes and therefore never mutates its input.
    expect(payload.toString("utf8")).toContain(SECRET_CANARY);
    payload.fill(0);
  });

  it("supports arbitrary non-text provider-owned bytes", async () => {
    const { store } = createFixture();
    const payload = Uint8Array.from([0, 255, 1, 128, 2]);
    await store.store(MUTATION, payload);
    expect(await readBytes(store)).toEqual(payload);
  });

  it("clears callback-scoped plaintext after success and rejection", async () => {
    const { store } = createFixture();
    await store.store(MUTATION, Buffer.from(SECRET_CANARY));
    let successfulAlias: Uint8Array | undefined;
    await store.use(IDENTITY, (payload) => {
      successfulAlias = payload;
    });
    expect(Array.from(successfulAlias ?? [])).toEqual(
      Array(SECRET_CANARY.length).fill(0)
    );

    let rejectedAlias: Uint8Array | undefined;
    await expect(
      store.use(IDENTITY, (payload) => {
        rejectedAlias = payload;
        throw new Error(SECRET_CANARY);
      })
    ).rejects.toThrow(SECRET_CANARY);
    expect(Array.from(rejectedAlias ?? [])).toEqual(
      Array(SECRET_CANARY.length).fill(0)
    );
  });

  it("binds identity, format, key version, operation, and revision as AAD", async () => {
    const tamperCases: ReadonlyArray<
      Readonly<{
        patch: Partial<StoredCredentialEnvelope>;
        identity?: CredentialIdentity;
        expectedCode: string;
      }>
    > = [
      {
        patch: { ownerId: OTHER_OWNER_ID },
        identity: { ...IDENTITY, ownerId: OTHER_OWNER_ID },
        expectedCode: "decryption_failed",
      },
      {
        patch: { credentialId: OTHER_CREDENTIAL_ID },
        identity: { ...IDENTITY, credentialId: OTHER_CREDENTIAL_ID },
        expectedCode: "decryption_failed",
      },
      {
        patch: { credentialFormatVersion: 2 },
        identity: { ...IDENTITY, credentialFormatVersion: 2 },
        expectedCode: "decryption_failed",
      },
      {
        patch: { keyVersion: PREVIOUS_KEY.keyVersion },
        expectedCode: "key_unavailable",
      },
      {
        patch: { operationId: OTHER_OPERATION_ID },
        expectedCode: "decryption_failed",
      },
      {
        patch: {
          recordRevision: "revision_v1_00000000-0000-4000-8000-000000000099",
        },
        expectedCode: "decryption_failed",
      },
    ];

    for (const testCase of tamperCases) {
      const { persistence, store } = createFixture();
      await store.store(MUTATION, Buffer.from(SECRET_CANARY));
      persistence.record = Object.freeze({
        ...(persistence.record as StoredCredentialEnvelope),
        ...testCase.patch,
      });
      await expect(
        store.use(testCase.identity ?? IDENTITY, () => undefined)
      ).rejects.toMatchObject({ code: testCase.expectedCode });
    }
  });

  it("rejects tampered ciphertext, tag, and nonce with one stable error", async () => {
    for (const field of ["ciphertext", "authTag", "nonce"] as const) {
      const { persistence, store } = createFixture();
      await store.store(MUTATION, Buffer.from(SECRET_CANARY));
      const record = persistence.record as StoredCredentialEnvelope;
      const value = record[field];
      persistence.record = Object.freeze({
        ...record,
        [field]: `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`,
      });
      await expect(store.use(IDENTITY, () => undefined)).rejects.toMatchObject({
        code: "decryption_failed",
        message: "Credential record could not be decrypted",
      });
    }
  });

  it("accepts only a current and optional distinct previous 256-bit key", () => {
    const persistence = new MemoryPersistence();
    expect(
      () =>
        new EncryptedConnectionStore(persistence, {
          current: CURRENT_KEY,
          previous: CURRENT_KEY,
        })
    ).toThrowError(
      expect.objectContaining({ code: "internal_configuration_invalid" })
    );

    const shortBytes = Buffer.alloc(16, 7);
    const shortKey = createSecretKey(shortBytes);
    shortBytes.fill(0);
    expect(
      () =>
        new EncryptedConnectionStore(persistence, {
          current: { keyVersion: "encryption-v1-00000003", key: shortKey },
        })
    ).toThrowError(
      expect.objectContaining({ code: "internal_configuration_invalid" })
    );
  });

  it("reads current and previous keys but rejects versions outside the overlap", async () => {
    const persistence = new MemoryPersistence();
    const oldStore = createFixture({
      persistence,
      current: PREVIOUS_KEY,
      seed: 10,
    }).store;
    await oldStore.store(MUTATION, Buffer.from(SECRET_CANARY));

    const overlapping = createFixture({
      persistence,
      current: CURRENT_KEY,
      previous: PREVIOUS_KEY,
      seed: 20,
    }).store;
    expect(Buffer.from(await readBytes(overlapping)).toString()).toBe(
      SECRET_CANARY
    );

    const withoutPrevious = createFixture({ persistence }).store;
    await expect(
      withoutPrevious.use(IDENTITY, () => undefined)
    ).rejects.toMatchObject({ code: "key_unavailable" });
  });

  it("re-encrypts previous-key records and makes current-key retries no-ops", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({
      persistence,
      current: PREVIOUS_KEY,
      seed: 30,
    }).store.store(MUTATION, Buffer.from(SECRET_CANARY));
    const originalCiphertext = persistence.record?.ciphertext;
    const rotating = createFixture({
      persistence,
      current: CURRENT_KEY,
      previous: PREVIOUS_KEY,
      seed: 40,
    }).store;

    const rotated = await rotating.rotate({
      ...MUTATION,
      operationId: OTHER_OPERATION_ID,
    });
    expect(rotated.status).toBe("rotated");
    expect(persistence.record?.keyVersion).toBe(CURRENT_KEY.keyVersion);
    expect(persistence.record?.ciphertext).not.toBe(originalCiphertext);
    expect(Buffer.from(await readBytes(rotating)).toString()).toBe(
      SECRET_CANARY
    );
    await expect(rotating.rotate(MUTATION)).resolves.toMatchObject({
      status: "already_current",
      keyVersion: CURRENT_KEY.keyVersion,
    });
  });

  it("makes same-operation creates idempotent and rejects a different operation", async () => {
    const { persistence, store } = createFixture();
    const first = await store.store(MUTATION, Buffer.from("first"));
    const firstRecord = persistence.record;
    const retry = await store.store(
      MUTATION,
      Buffer.from("ignored retry bytes")
    );

    expect(first.status).toBe("created");
    expect(retry).toMatchObject({
      status: "already_created",
      recordRevision: first.recordRevision,
    });
    expect(persistence.record).toBe(firstRecord);
    await expect(
      store.store(
        { ...MUTATION, operationId: OTHER_OPERATION_ID },
        Buffer.from("replacement")
      )
    ).rejects.toMatchObject({ code: "credential_already_exists" });
  });

  it("atomically resolves concurrent same-operation creates to one record", async () => {
    const persistence = new MemoryPersistence();
    const first = createFixture({ persistence, seed: 50 }).store;
    const second = createFixture({ persistence, seed: 60 }).store;

    const results = await Promise.all([
      first.store(MUTATION, Buffer.from("one")),
      second.store(MUTATION, Buffer.from("two")),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "already_created",
      "created",
    ]);
    expect(results[0].recordRevision).toBe(results[1].recordRevision);
  });

  it("treats a concurrent successful rotation as an idempotent outcome", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({
      persistence,
      current: PREVIOUS_KEY,
      seed: 70,
    }).store.store(MUTATION, Buffer.from(SECRET_CANARY));
    const winner = createFixture({
      persistence: new MemoryPersistence(),
      current: CURRENT_KEY,
      seed: 80,
    });
    await winner.store.store(MUTATION, Buffer.from(SECRET_CANARY));
    const winnerRecord = winner.persistence.record as StoredCredentialEnvelope;
    persistence.beforeReplace = () =>
      persistence.replaceOutOfBand(winnerRecord);
    const rotating = createFixture({
      persistence,
      current: CURRENT_KEY,
      previous: PREVIOUS_KEY,
      seed: 90,
    }).store;

    await expect(rotating.rotate(MUTATION)).resolves.toMatchObject({
      status: "already_current",
      recordRevision: winnerRecord.recordRevision,
    });
  });

  it("rejects a concurrent non-rotation replacement", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({
      persistence,
      current: PREVIOUS_KEY,
      seed: 100,
    }).store.store(MUTATION, Buffer.from(SECRET_CANARY));
    const competingRecord = Object.freeze({
      ...(persistence.record as StoredCredentialEnvelope),
      recordRevision: "revision_v1_00000000-0000-4000-8000-000000000088",
    });
    persistence.beforeReplace = () =>
      persistence.replaceOutOfBand(competingRecord);
    const rotating = createFixture({
      persistence,
      current: CURRENT_KEY,
      previous: PREVIOUS_KEY,
      seed: 110,
    }).store;

    await expect(rotating.rotate(MUTATION)).rejects.toMatchObject({
      code: "concurrent_modification",
    });
  });

  it("deletes idempotently and never deletes a concurrently replaced record", async () => {
    const { persistence, store } = createFixture();
    await store.store(MUTATION, Buffer.from(SECRET_CANARY));
    await expect(store.delete(IDENTITY)).resolves.toEqual({
      status: "deleted",
    });
    await expect(store.delete(IDENTITY)).resolves.toEqual({
      status: "already_deleted",
    });

    await store.store(
      { ...MUTATION, operationId: OTHER_OPERATION_ID },
      Buffer.from(SECRET_CANARY)
    );
    const replacement = Object.freeze({
      ...(persistence.record as StoredCredentialEnvelope),
      recordRevision: "revision_v1_00000000-0000-4000-8000-000000000077",
    });
    persistence.beforeDelete = () => persistence.replaceOutOfBand(replacement);
    await expect(store.delete(IDENTITY)).rejects.toMatchObject({
      code: "concurrent_modification",
    });
    expect(persistence.record).toBe(replacement);
  });

  it("strictly rejects oversized, empty, extended, and malformed inputs", async () => {
    const { store } = createFixture();
    await expect(store.store(MUTATION, new Uint8Array())).rejects.toMatchObject(
      {
        code: "invalid_input",
      }
    );
    await expect(
      store.store(MUTATION, new Uint8Array(MAX_CREDENTIAL_BYTES + 1))
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      store.store(
        { ...MUTATION, token: SECRET_CANARY } as CredentialMutation,
        Buffer.from("x")
      )
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      store.store({ ...MUTATION, ownerId: "user_short" }, Buffer.from("x"))
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects malformed and extended persistence records before decryption", async () => {
    for (const patch of [
      { ciphertext: "not+padded=" },
      { nonce: "A" },
      { authTag: "A" },
      { envelopeVersion: 2 },
      { extra: SECRET_CANARY },
    ]) {
      const { persistence, store } = createFixture();
      await store.store(MUTATION, Buffer.from(SECRET_CANARY));
      persistence.record = {
        ...persistence.record,
        ...patch,
      } as unknown as StoredCredentialEnvelope;
      await expect(store.use(IDENTITY, () => undefined)).rejects.toMatchObject({
        code: "invalid_record",
        message: "Credential record is invalid",
      });
    }
  });

  it("normalizes persistence failures without reflecting secret data", async () => {
    const persistence: EncryptedCredentialPersistence = {
      read: async () => {
        throw new Error(SECRET_CANARY);
      },
      create: async () => {
        throw new Error(SECRET_CANARY);
      },
      replace: async () => {
        throw new Error(SECRET_CANARY);
      },
      delete: async () => {
        throw new Error(SECRET_CANARY);
      },
    };
    const store = new EncryptedConnectionStore(
      persistence,
      { current: CURRENT_KEY },
      createRandomSource()
    );

    for (const operation of [
      () => store.store(MUTATION, Buffer.from(SECRET_CANARY)),
      () => store.use(IDENTITY, () => undefined),
      () => store.rotate(MUTATION),
      () => store.delete(IDENTITY),
    ]) {
      const error = await operation().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(CredentialStoreError);
      expect(error).toMatchObject({
        code: "persistence_unavailable",
        message: "Credential persistence is unavailable",
      });
      expect(String(error)).not.toContain(SECRET_CANARY);
    }
  });

  it("normalizes invalid or failing randomness without reflecting details", async () => {
    for (const randomSource of [
      {
        nonce: () => {
          throw new Error(SECRET_CANARY);
        },
        recordRevision: () =>
          "revision_v1_00000000-0000-4000-8000-000000000001",
      },
      {
        nonce: () => new Uint8Array(11),
        recordRevision: () => SECRET_CANARY,
      },
    ]) {
      const store = new EncryptedConnectionStore(
        new MemoryPersistence(),
        { current: CURRENT_KEY },
        randomSource
      );
      const error = await store
        .store(MUTATION, Buffer.from(SECRET_CANARY))
        .catch((reason: unknown) => reason);
      expect(error).toMatchObject({
        code: "internal_configuration_invalid",
        message: "Credential store configuration is invalid",
      });
      expect(String(error)).not.toContain(SECRET_CANARY);
    }
  });

  it("fails closed on malformed adapter results", async () => {
    const { persistence, store } = createFixture();
    persistence.create = async () =>
      ({
        status: "created",
        extension: true,
      }) as unknown as CreateCredentialResult;
    await expect(
      store.store(MUTATION, Buffer.from(SECRET_CANARY))
    ).rejects.toMatchObject({ code: "persistence_unavailable" });
  });
});
