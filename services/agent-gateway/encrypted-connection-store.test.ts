import { createSecretKey } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  type CreateCredentialResult,
  type CredentialCreateMutation,
  type CredentialIdentity,
  type CredentialKeyEncryptionKey,
  type CredentialRandomSource,
  type CredentialRotationMutation,
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
const CREATE_OPERATION_ID = "mutation_v1_00000000-0000-4000-8000-000000000001";
const OTHER_CREATE_OPERATION_ID =
  "mutation_v1_00000000-0000-4000-8000-000000000002";
const ROTATION_OPERATION_ID =
  "mutation_v1_00000000-0000-4000-8000-000000000003";
const SECRET_CANARY = "sk-secret-never-reflect";

const IDENTITY: CredentialIdentity = Object.freeze({
  ownerId: OWNER_ID,
  provider: "codex",
  credentialId: CREDENTIAL_ID,
  credentialFormatVersion: 1,
});
const CREATE_MUTATION: CredentialCreateMutation = Object.freeze({
  ...IDENTITY,
  creationOperationId: CREATE_OPERATION_ID,
});
const ROTATION_MUTATION: CredentialRotationMutation = Object.freeze({
  ...IDENTITY,
  rotationOperationId: ROTATION_OPERATION_ID,
});

/** Creates a 256-bit secret KeyObject, then clears its construction buffer. */
function createKek(
  keyVersion: string,
  fill: number
): CredentialKeyEncryptionKey {
  const bytes = Buffer.alloc(32, fill);
  try {
    return Object.freeze({ keyVersion, key: createSecretKey(bytes) });
  } finally {
    bytes.fill(0);
  }
}

const CURRENT_KEK = createKek("encryption-v1-00000002", 2);
const PREVIOUS_KEK = createKek("encryption-v1-00000001", 1);

/** Controllable CSPRNG-shaped source whose transferred buffers remain observable. */
class TestRandomSource implements CredentialRandomSource {
  readonly transferred: Buffer[] = [];
  duplicateDataKey = false;
  duplicateWrapNonce = false;
  duplicateLayerNonces = false;
  zeroDataKey = false;
  zeroPayloadNonce = false;
  zeroWrapNonce = false;
  private sequence: number;
  private firstDataKey?: Buffer;
  private firstWrapNonce?: Buffer;

  constructor(seed = 1) {
    this.sequence = seed;
  }

  dataKey(): Buffer {
    let value: Buffer;
    if (this.zeroDataKey) {
      value = Buffer.alloc(32);
    } else if (this.duplicateDataKey && this.firstDataKey !== undefined) {
      value = Buffer.from(this.firstDataKey);
    } else {
      value = Buffer.alloc(32, this.nextByte());
      this.firstDataKey = Buffer.from(value);
    }
    this.transferred.push(value);
    return value;
  }

  payloadNonce(): Buffer {
    const value = this.zeroPayloadNonce
      ? Buffer.alloc(12)
      : Buffer.alloc(12, this.nextByte());
    this.transferred.push(value);
    return value;
  }

  wrapNonce(): Buffer {
    let value: Buffer;
    if (this.zeroWrapNonce) {
      value = Buffer.alloc(12);
    } else if (this.duplicateLayerNonces) {
      const payloadNonce = this.transferred.at(-1);
      value = Buffer.from(payloadNonce ?? Buffer.alloc(12));
    } else if (this.duplicateWrapNonce && this.firstWrapNonce !== undefined) {
      value = Buffer.from(this.firstWrapNonce);
    } else {
      value = Buffer.alloc(12, this.nextByte());
      this.firstWrapNonce = Buffer.from(value);
    }
    this.transferred.push(value);
    return value;
  }

  recordRevision(): string {
    const suffix = this.sequence.toString(16).padStart(12, "0");
    this.sequence += 1;
    return `revision_v1_00000000-0000-4000-8000-${suffix}`;
  }

  /** Returns a nonzero deterministic byte for test-only cryptographic input. */
  private nextByte(): number {
    const value = (this.sequence % 254) + 1;
    this.sequence += 1;
    return value;
  }
}

/** Exposes a class-backed test source through the production plain-data shape. */
function randomSourceContract(
  randomSource: TestRandomSource
): CredentialRandomSource {
  return Object.freeze({
    dataKey: randomSource.dataKey.bind(randomSource),
    payloadNonce: randomSource.payloadNonce.bind(randomSource),
    wrapNonce: randomSource.wrapNonce.bind(randomSource),
    recordRevision: randomSource.recordRevision.bind(randomSource),
  });
}

/** One-shot promise controller used to hold an adapter await open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Atomic in-memory adapter used only to exercise the injected contract. */
class MemoryPersistence implements EncryptedCredentialPersistence {
  record: StoredCredentialEnvelope | null = null;
  readFailure?: Error;
  beforeReplace?: () => void;
  beforeDelete?: () => void;
  createImplementation?: (
    record: StoredCredentialEnvelope
  ) => Promise<CreateCredentialResult>;
  replaceImplementation?: (
    record: StoredCredentialEnvelope,
    expectedRecordRevision: string
  ) => Promise<ReplaceCredentialResult>;

  async read(identity: CredentialIdentity) {
    if (this.readFailure) throw this.readFailure;
    return this.matches(identity) ? this.record : null;
  }

  async create(
    record: StoredCredentialEnvelope
  ): Promise<CreateCredentialResult> {
    if (this.createImplementation) return this.createImplementation(record);
    if (this.record !== null) return { status: "exists", record: this.record };
    this.record = record;
    return { status: "created" };
  }

  async replace(
    record: StoredCredentialEnvelope,
    expectedRecordRevision: string
  ): Promise<ReplaceCredentialResult> {
    if (this.replaceImplementation) {
      return this.replaceImplementation(record, expectedRecordRevision);
    }
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

/** Creates an isolated envelope-store fixture. */
function createFixture(
  options: Readonly<{
    persistence?: MemoryPersistence;
    current?: CredentialKeyEncryptionKey;
    previous?: CredentialKeyEncryptionKey;
    randomSource?: TestRandomSource;
    seed?: number;
    maxKekEncryptions?: number;
  }> = {}
) {
  const persistence = options.persistence ?? new MemoryPersistence();
  const randomSource =
    options.randomSource ?? new TestRandomSource(options.seed ?? 1);
  const store = new EncryptedConnectionStore(
    persistence,
    {
      current: options.current ?? CURRENT_KEK,
      ...(options.previous ? { previous: options.previous } : {}),
    },
    randomSourceContract(randomSource),
    options.maxKekEncryptions
  );
  return { persistence, randomSource, store };
}

/** Reads a copy during the bounded callback lifetime. */
async function readBytes(
  store: EncryptedConnectionStore,
  identity: CredentialIdentity = IDENTITY
): Promise<Uint8Array> {
  return store.use(identity, (payload) => Uint8Array.from(payload));
}

/** Stores one fresh Buffer whose ownership transfers to the store. */
async function storeText(
  store: EncryptedConnectionStore,
  text = SECRET_CANARY,
  mutation: CredentialCreateMutation = CREATE_MUTATION
) {
  return store.store(mutation, Buffer.from(text));
}

/** Returns a structurally valid replacement with controlled scalar changes. */
function patchRecord(
  record: StoredCredentialEnvelope,
  patch: Partial<StoredCredentialEnvelope>
): StoredCredentialEnvelope {
  return Object.freeze({ ...record, ...patch });
}

/** Adds hostile own overrides while retaining a native view for zero checks. */
function overrideBufferSurface(buffer: Buffer) {
  const nativeView = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  let overrideCalls = 0;
  for (const property of ["byteLength", "length"] as const) {
    Object.defineProperty(buffer, property, {
      configurable: true,
      get: () => {
        overrideCalls += 1;
        throw new Error(`${property} override must not run`);
      },
    });
  }
  Object.defineProperty(buffer, "fill", {
    configurable: true,
    value: () => {
      overrideCalls += 1;
      throw new Error("fill override must not run");
    },
  });
  return {
    nativeView,
    overrideCalls: () => overrideCalls,
  };
}

describe("EncryptedConnectionStore envelope encryption", () => {
  it("encrypts every credential with a fresh DEK and wraps only that DEK", async () => {
    const first = createFixture({ seed: 10 });
    const second = createFixture({ seed: 20 });
    await storeText(first.store);
    await storeText(second.store);
    const firstRecord = first.persistence.record as StoredCredentialEnvelope;
    const secondRecord = second.persistence.record as StoredCredentialEnvelope;

    expect(firstRecord.payloadAlgorithm).toBe("aes-256-gcm");
    expect(firstRecord.keyWrapAlgorithm).toBe("aes-256-gcm");
    expect(Buffer.from(firstRecord.wrappedDataKey, "base64url")).toHaveLength(
      32
    );
    expect(firstRecord.wrappedDataKey).not.toBe(secondRecord.wrappedDataKey);
    expect(firstRecord.ciphertext).not.toBe(secondRecord.ciphertext);
    expect(JSON.stringify(firstRecord)).not.toContain(SECRET_CANARY);
    expect(Buffer.from(await readBytes(first.store)).toString()).toBe(
      SECRET_CANARY
    );
  });

  it("clears transferred plaintext, DEK, and nonces before create awaits", async () => {
    const gate = deferred<CreateCredentialResult>();
    const persistence = new MemoryPersistence();
    let persisted: StoredCredentialEnvelope | undefined;
    persistence.createImplementation = async (record) => {
      persisted = record;
      return gate.promise;
    };
    const { randomSource, store } = createFixture({ persistence, seed: 30 });
    const transferredPlaintext = Buffer.from(SECRET_CANARY);

    const pending = store.store(CREATE_MUTATION, transferredPlaintext);
    await vi.waitFor(() => expect(persisted).toBeDefined());

    expect(Array.from(transferredPlaintext)).toEqual(
      Array(SECRET_CANARY.length).fill(0)
    );
    expect(randomSource.transferred).toHaveLength(3);
    for (const transferred of randomSource.transferred) {
      expect(Array.from(transferred)).toEqual(
        Array(transferred.length).fill(0)
      );
    }
    expect(JSON.stringify(persisted)).not.toContain(SECRET_CANARY);
    gate.resolve({ status: "created" });
    await expect(pending).resolves.toMatchObject({ status: "created" });
  });

  it("clears rotation material before CAS persistence awaits", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({
      persistence,
      current: PREVIOUS_KEK,
      seed: 40,
    }).store.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY));
    const gate = deferred<ReplaceCredentialResult>();
    let replacement: StoredCredentialEnvelope | undefined;
    persistence.replaceImplementation = async (record) => {
      replacement = record;
      return gate.promise;
    };
    const { randomSource, store } = createFixture({
      persistence,
      current: CURRENT_KEK,
      previous: PREVIOUS_KEK,
      seed: 50,
    });

    const pending = store.rotate(ROTATION_MUTATION);
    await vi.waitFor(() => expect(replacement).toBeDefined());
    for (const transferred of randomSource.transferred) {
      expect(Array.from(transferred)).toEqual(
        Array(transferred.length).fill(0)
      );
    }
    expect(JSON.stringify(replacement)).not.toContain(SECRET_CANARY);
    gate.resolve({ status: "replaced" });
    await expect(pending).resolves.toMatchObject({ status: "rotated" });
  });

  it("clears callback-scoped plaintext after success and rejection", async () => {
    const { store } = createFixture();
    await storeText(store);
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

  it("binds identity, lineage, versions, and revisions to authenticated layers", async () => {
    const cases: ReadonlyArray<
      Readonly<{
        patch: Partial<StoredCredentialEnvelope>;
        identity?: CredentialIdentity;
        previous?: CredentialKeyEncryptionKey;
      }>
    > = [
      {
        patch: { ownerId: OTHER_OWNER_ID },
        identity: { ...IDENTITY, ownerId: OTHER_OWNER_ID },
      },
      {
        patch: { credentialId: OTHER_CREDENTIAL_ID },
        identity: { ...IDENTITY, credentialId: OTHER_CREDENTIAL_ID },
      },
      {
        patch: { credentialFormatVersion: 2 },
        identity: { ...IDENTITY, credentialFormatVersion: 2 },
      },
      {
        patch: { keyVersion: PREVIOUS_KEK.keyVersion },
        previous: PREVIOUS_KEK,
      },
      { patch: { creationOperationId: OTHER_CREATE_OPERATION_ID } },
      {
        patch: {
          recordRevision: "revision_v1_00000000-0000-4000-8000-000000000099",
        },
      },
    ];

    for (const testCase of cases) {
      const fixture = createFixture({
        previous: testCase.previous,
        seed: 60,
      });
      await storeText(fixture.store);
      fixture.persistence.record = patchRecord(
        fixture.persistence.record as StoredCredentialEnvelope,
        testCase.patch
      );
      await expect(
        fixture.store.use(testCase.identity ?? IDENTITY, () => undefined)
      ).rejects.toMatchObject({ code: "decryption_failed" });
    }
  });

  it("fails closed when payload or wrapped-DEK fields are tampered", async () => {
    for (const field of [
      "payloadNonce",
      "ciphertext",
      "payloadAuthTag",
      "wrappedDataKey",
      "wrapNonce",
      "wrapAuthTag",
    ] as const) {
      const { persistence, store } = createFixture({ seed: 70 });
      await storeText(store);
      const record = persistence.record as StoredCredentialEnvelope;
      const value = record[field];
      persistence.record = patchRecord(record, {
        [field]: `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`,
      });
      await expect(store.use(IDENTITY, () => undefined)).rejects.toMatchObject({
        code: "decryption_failed",
        message: "Credential record could not be decrypted",
      });
    }
  });
});

describe("EncryptedConnectionStore key and nonce safety", () => {
  it("rejects current and previous KEK labels backed by identical material", () => {
    const sameMaterial = createKek("encryption-v1-00000003", 2);
    expect(
      () =>
        new EncryptedConnectionStore(new MemoryPersistence(), {
          current: CURRENT_KEK,
          previous: sameMaterial,
        })
    ).toThrowError(
      expect.objectContaining({ code: "internal_configuration_invalid" })
    );
  });

  it("accepts only distinct 256-bit KEKs with distinct versions", () => {
    const shortBytes = Buffer.alloc(16, 7);
    const shortKey = createSecretKey(shortBytes);
    shortBytes.fill(0);
    expect(
      () =>
        new EncryptedConnectionStore(new MemoryPersistence(), {
          current: {
            keyVersion: "encryption-v1-00000003",
            key: shortKey,
          },
        })
    ).toThrowError(
      expect.objectContaining({ code: "internal_configuration_invalid" })
    );
  });

  it("fails closed when a record's KEK version is outside the overlap", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({
      persistence,
      current: PREVIOUS_KEK,
      seed: 75,
    }).store.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY));
    const withoutPrevious = createFixture({ persistence, seed: 76 }).store;
    await expect(
      withoutPrevious.use(IDENTITY, () => undefined)
    ).rejects.toMatchObject({ code: "key_unavailable" });
  });

  it("rejects all-zero DEKs and nonces plus duplicate layer nonces", async () => {
    for (const configure of [
      (source: TestRandomSource) => (source.zeroDataKey = true),
      (source: TestRandomSource) => (source.zeroPayloadNonce = true),
      (source: TestRandomSource) => (source.zeroWrapNonce = true),
      (source: TestRandomSource) => (source.duplicateLayerNonces = true),
    ]) {
      const randomSource = new TestRandomSource(80);
      configure(randomSource);
      const { store } = createFixture({ randomSource });
      await expect(storeText(store)).rejects.toMatchObject({
        code: "internal_configuration_invalid",
      });
      for (const transferred of randomSource.transferred) {
        expect(Array.from(transferred)).toEqual(
          Array(transferred.length).fill(0)
        );
      }
    }
  });

  it("rejects repeated DEKs and wrap nonces within one bounded instance", async () => {
    for (const duplicateField of [
      "duplicateDataKey",
      "duplicateWrapNonce",
    ] as const) {
      const persistence = new MemoryPersistence();
      const randomSource = new TestRandomSource(90);
      const { store } = createFixture({ persistence, randomSource });
      await storeText(store);
      persistence.record = null;
      randomSource[duplicateField] = true;
      await expect(
        store.store(
          {
            ...CREATE_MUTATION,
            creationOperationId: OTHER_CREATE_OPERATION_ID,
          },
          Buffer.from(SECRET_CANARY)
        )
      ).rejects.toMatchObject({ code: "internal_configuration_invalid" });
    }
  });

  it("caps KEK encryption invocations per store instance", async () => {
    const { persistence, store } = createFixture({ maxKekEncryptions: 1 });
    await storeText(store);
    persistence.record = null;
    const secondPayload = Buffer.from(SECRET_CANARY);
    await expect(
      store.store(
        {
          ...CREATE_MUTATION,
          creationOperationId: OTHER_CREATE_OPERATION_ID,
        },
        secondPayload
      )
    ).rejects.toMatchObject({ code: "internal_configuration_invalid" });
    expect(Array.from(secondPayload)).toEqual(
      Array(SECRET_CANARY.length).fill(0)
    );
  });
});

describe("EncryptedConnectionStore idempotency, lineage, and concurrency", () => {
  it("requires same-operation create retries to contain identical bytes", async () => {
    const { persistence, store } = createFixture({ seed: 100 });
    const first = await storeText(store, "first");
    const firstRecord = persistence.record;
    const retry = await storeText(store, "first");
    expect(retry).toMatchObject({
      status: "already_created",
      recordRevision: first.recordRevision,
    });
    expect(persistence.record).toBe(firstRecord);

    await expect(storeText(store, "different")).rejects.toMatchObject({
      code: "credential_already_exists",
      message: "Credential record already exists",
    });
  });

  it("reconciles commit-then-throw and malformed-after-commit outcomes", async () => {
    for (const outcome of ["throw", "malformed"] as const) {
      const persistence = new MemoryPersistence();
      persistence.createImplementation = async (record) => {
        persistence.record = record;
        if (outcome === "throw") throw new Error(SECRET_CANARY);
        return {
          status: "created",
          extension: SECRET_CANARY,
        } as unknown as CreateCredentialResult;
      };
      const { store } = createFixture({ persistence, seed: 105 });
      const transferred = Buffer.from(SECRET_CANARY);

      await expect(
        store.store(CREATE_MUTATION, transferred)
      ).resolves.toMatchObject({
        status: "already_created",
        recordRevision: persistence.record?.recordRevision,
      });
      expect(Array.from(transferred)).toEqual(
        Array(SECRET_CANARY.length).fill(0)
      );
    }
  });

  it("denies ambiguous-create collisions against a different payload", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({ persistence, seed: 106 }).store.store(
      CREATE_MUTATION,
      Buffer.from("existing")
    );
    persistence.createImplementation = async () => {
      throw new Error(SECRET_CANARY);
    };
    const retrying = createFixture({ persistence, seed: 107 }).store;
    const transferred = Buffer.from("different");

    await expect(
      retrying.store(CREATE_MUTATION, transferred)
    ).rejects.toMatchObject({ code: "credential_already_exists" });
    expect(Array.from(transferred)).toEqual(Array("different".length).fill(0));
  });

  it("fails honestly when reconciliation is unavailable, then accepts a fresh restarted retry", async () => {
    const persistence = new MemoryPersistence();
    persistence.createImplementation = async (record) => {
      persistence.record = record;
      throw new Error(SECRET_CANARY);
    };
    persistence.readFailure = new Error(SECRET_CANARY);
    const firstProcess = createFixture({ persistence, seed: 108 }).store;
    const transferred = Buffer.from(SECRET_CANARY);

    await expect(
      firstProcess.store(CREATE_MUTATION, transferred)
    ).rejects.toMatchObject({
      code: "persistence_unavailable",
      message: "Credential persistence is unavailable",
    });
    expect(Array.from(transferred)).toEqual(
      Array(SECRET_CANARY.length).fill(0)
    );

    // A restarted process must obtain fresh provider bytes; it never reuses the
    // transferred and zeroed Buffer from the ambiguous attempt.
    persistence.readFailure = undefined;
    persistence.createImplementation = undefined;
    const restarted = createFixture({ persistence, seed: 109 }).store;
    await expect(
      restarted.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY))
    ).resolves.toMatchObject({ status: "already_created" });
    await expect(
      restarted.store(CREATE_MUTATION, Buffer.from("collision"))
    ).rejects.toMatchObject({ code: "credential_already_exists" });
  });

  it("resolves concurrent same-operation creates only when payloads match", async () => {
    const persistence = new MemoryPersistence();
    const first = createFixture({ persistence, seed: 110 }).store;
    const second = createFixture({ persistence, seed: 120 }).store;
    const sameResults = await Promise.all([
      storeText(first, "same"),
      storeText(second, "same"),
    ]);
    expect(sameResults.map((result) => result.status).sort()).toEqual([
      "already_created",
      "created",
    ]);

    const collisionPersistence = new MemoryPersistence();
    const winner = createFixture({
      persistence: collisionPersistence,
      seed: 130,
    }).store;
    const loser = createFixture({
      persistence: collisionPersistence,
      seed: 140,
    }).store;
    const collisions = await Promise.allSettled([
      storeText(winner, "one"),
      storeText(loser, "two"),
    ]);
    expect(
      collisions.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      collisions.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    expect(
      (
        collisions.find(
          (result) => result.status === "rejected"
        ) as PromiseRejectedResult
      ).reason
    ).toMatchObject({ code: "credential_already_exists" });
  });

  it("preserves immutable create lineage through rotation and restarts", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({
      persistence,
      current: PREVIOUS_KEK,
      seed: 150,
    }).store.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY));
    const rotating = createFixture({
      persistence,
      current: CURRENT_KEK,
      previous: PREVIOUS_KEK,
      seed: 160,
    }).store;
    await expect(rotating.rotate(ROTATION_MUTATION)).resolves.toMatchObject({
      status: "rotated",
    });
    expect(persistence.record).toMatchObject({
      creationOperationId: CREATE_OPERATION_ID,
      lastRotationOperationId: ROTATION_OPERATION_ID,
      rotationSequence: 1,
      keyVersion: CURRENT_KEK.keyVersion,
    });

    const restarted = createFixture({
      persistence,
      current: CURRENT_KEK,
      previous: PREVIOUS_KEK,
      seed: 170,
    }).store;
    await expect(
      restarted.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY))
    ).resolves.toMatchObject({ status: "already_created" });
    await expect(
      restarted.store(CREATE_MUTATION, Buffer.from("different"))
    ).rejects.toMatchObject({ code: "credential_already_exists" });
  });

  it("reads previous-KEK records and authenticates direct current rotations", async () => {
    const persistence = new MemoryPersistence();
    const previousStore = createFixture({
      persistence,
      current: PREVIOUS_KEK,
      seed: 172,
    }).store;
    await previousStore.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY));
    const overlapStore = createFixture({
      persistence,
      current: CURRENT_KEK,
      previous: PREVIOUS_KEK,
      seed: 173,
    }).store;
    expect(Buffer.from(await readBytes(overlapStore)).toString()).toBe(
      SECRET_CANARY
    );

    const currentStore = createFixture({ seed: 174 }).store;
    await currentStore.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY));
    await expect(currentStore.rotate(ROTATION_MUTATION)).resolves.toMatchObject(
      {
        status: "already_current",
        keyVersion: CURRENT_KEK.keyVersion,
      }
    );
  });

  it("rejects reuse of the creation identity as a rotation identity", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({
      persistence,
      current: PREVIOUS_KEK,
      seed: 175,
    }).store.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY));
    const rotating = createFixture({
      persistence,
      current: CURRENT_KEK,
      previous: PREVIOUS_KEK,
      seed: 176,
    }).store;

    await expect(
      rotating.rotate({
        ...IDENTITY,
        rotationOperationId: CREATE_OPERATION_ID,
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("treats a concurrent equivalent rotation as idempotent", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({
      persistence,
      current: PREVIOUS_KEK,
      seed: 180,
    }).store.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY));
    const winnerPersistence = new MemoryPersistence();
    await createFixture({
      persistence: winnerPersistence,
      seed: 190,
    }).store.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY));
    const winner = winnerPersistence.record as StoredCredentialEnvelope;
    persistence.beforeReplace = () => persistence.replaceOutOfBand(winner);
    const rotating = createFixture({
      persistence,
      current: CURRENT_KEK,
      previous: PREVIOUS_KEK,
      seed: 200,
    }).store;

    await expect(rotating.rotate(ROTATION_MUTATION)).resolves.toMatchObject({
      status: "already_current",
      recordRevision: winner.recordRevision,
    });
  });

  it("rejects a concurrent current-key record with different payload", async () => {
    const persistence = new MemoryPersistence();
    await createFixture({
      persistence,
      current: PREVIOUS_KEK,
      seed: 210,
    }).store.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY));
    const competingPersistence = new MemoryPersistence();
    await createFixture({
      persistence: competingPersistence,
      seed: 220,
    }).store.store(CREATE_MUTATION, Buffer.from("different"));
    persistence.beforeReplace = () =>
      persistence.replaceOutOfBand(
        competingPersistence.record as StoredCredentialEnvelope
      );
    const rotating = createFixture({
      persistence,
      current: CURRENT_KEK,
      previous: PREVIOUS_KEK,
      seed: 230,
    }).store;

    await expect(rotating.rotate(ROTATION_MUTATION)).rejects.toMatchObject({
      code: "concurrent_modification",
    });
  });

  it("deletes idempotently and never deletes a concurrent replacement", async () => {
    const { persistence, store } = createFixture({ seed: 240 });
    await storeText(store);
    await expect(store.delete(IDENTITY)).resolves.toEqual({
      status: "deleted",
    });
    await expect(store.delete(IDENTITY)).resolves.toEqual({
      status: "already_deleted",
    });

    await store.store(
      {
        ...CREATE_MUTATION,
        creationOperationId: OTHER_CREATE_OPERATION_ID,
      },
      Buffer.from(SECRET_CANARY)
    );
    const replacement = patchRecord(
      persistence.record as StoredCredentialEnvelope,
      {
        recordRevision: "revision_v1_00000000-0000-4000-8000-000000000077",
      }
    );
    persistence.beforeDelete = () => persistence.replaceOutOfBand(replacement);
    await expect(store.delete(IDENTITY)).rejects.toMatchObject({
      code: "concurrent_modification",
    });
    expect(persistence.record).toBe(replacement);
  });
});

describe("EncryptedConnectionStore closed snapshots and errors", () => {
  it("uses native Buffer length and clearing despite hostile own overrides", async () => {
    const invalidMetadataPayload = Buffer.from(SECRET_CANARY);
    const invalidMetadataObservation = overrideBufferSurface(
      invalidMetadataPayload
    );
    const invalidStore = createFixture({ seed: 241 }).store;
    await expect(
      invalidStore.store(
        {
          ...CREATE_MUTATION,
          token: SECRET_CANARY,
        } as CredentialCreateMutation,
        invalidMetadataPayload
      )
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(Array.from(invalidMetadataObservation.nativeView)).toEqual(
      Array(SECRET_CANARY.length).fill(0)
    );
    expect(invalidMetadataObservation.overrideCalls()).toBe(0);

    const validPayload = Buffer.from(SECRET_CANARY);
    const validObservation = overrideBufferSurface(validPayload);
    const validStore = createFixture({ seed: 242 }).store;
    await expect(
      validStore.store(CREATE_MUTATION, validPayload)
    ).resolves.toMatchObject({ status: "created" });
    expect(Array.from(validObservation.nativeView)).toEqual(
      Array(SECRET_CANARY.length).fill(0)
    );
    expect(validObservation.overrideCalls()).toBe(0);
  });

  it("clears rejected random Buffers without invoking hostile own overrides", async () => {
    const hostileDataKey = Buffer.alloc(31, 7);
    const observation = overrideBufferSurface(hostileDataKey);
    const source: CredentialRandomSource = Object.freeze({
      dataKey: () => hostileDataKey,
      payloadNonce: () => Buffer.alloc(12, 2),
      wrapNonce: () => Buffer.alloc(12, 3),
      recordRevision: () => "revision_v1_00000000-0000-4000-8000-000000000001",
    });
    const store = new EncryptedConnectionStore(
      new MemoryPersistence(),
      { current: CURRENT_KEK },
      source
    );
    const payload = Buffer.from(SECRET_CANARY);

    await expect(store.store(CREATE_MUTATION, payload)).rejects.toMatchObject({
      code: "internal_configuration_invalid",
    });
    expect(Array.from(observation.nativeView)).toEqual(Array(31).fill(0));
    expect(observation.overrideCalls()).toBe(0);
    expect(Array.from(payload)).toEqual(Array(SECRET_CANARY.length).fill(0));
  });

  it("clears canaries before rejecting hostile or invalid metadata", async () => {
    let getterCalls = 0;
    const accessor = { ...CREATE_MUTATION } as Record<string, unknown>;
    Object.defineProperty(accessor, "creationOperationId", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return getterCalls === 1 ? CREATE_OPERATION_ID : SECRET_CANARY;
      },
    });
    const symbol = Object.assign(
      { ...CREATE_MUTATION },
      { [Symbol("secret")]: SECRET_CANARY }
    );
    const hidden = { ...CREATE_MUTATION };
    Object.defineProperty(hidden, "hidden", {
      enumerable: false,
      value: SECRET_CANARY,
    });
    const inputs = [
      accessor,
      new Proxy({ ...CREATE_MUTATION }, {}),
      symbol,
      hidden,
      { ...CREATE_MUTATION, token: SECRET_CANARY },
      {
        ...CREATE_MUTATION,
        creationOperationId: `mutation_v1_${"a".repeat(4_096)}`,
      },
      { ...CREATE_MUTATION, provider: "claude" },
    ];

    for (const input of inputs) {
      const { store } = createFixture();
      const transferred = Buffer.from(SECRET_CANARY);
      await expect(
        store.store(input as CredentialCreateMutation, transferred)
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(Array.from(transferred)).toEqual(
        Array(SECRET_CANARY.length).fill(0)
      );
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects non-Buffer, empty, and oversized transferred payloads", async () => {
    const { store } = createFixture();
    await expect(
      store.store(CREATE_MUTATION, new Uint8Array([1]) as unknown as Buffer)
    ).rejects.toMatchObject({ code: "invalid_input" });
    const empty = Buffer.alloc(0);
    await expect(store.store(CREATE_MUTATION, empty)).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(empty).toHaveLength(0);
    const oversized = Buffer.alloc(MAX_CREDENTIAL_BYTES + 1, 7);
    await expect(store.store(CREATE_MUTATION, oversized)).rejects.toMatchObject(
      {
        code: "invalid_input",
      }
    );
    expect(oversized.every((byte) => byte === 0)).toBe(true);
  });

  it("clears every Buffer returned with a wrong random-source size", async () => {
    for (const badField of ["dataKey", "payloadNonce", "wrapNonce"] as const) {
      const returned: Buffer[] = [];
      const make = (length: number, fill: number) => {
        const value = Buffer.alloc(length, fill);
        returned.push(value);
        return value;
      };
      const source: CredentialRandomSource = Object.freeze({
        dataKey: () =>
          make(
            badField === "dataKey" ? 31 : 32,
            badField === "dataKey" ? 7 : 1
          ),
        payloadNonce: () =>
          make(
            badField === "payloadNonce" ? 11 : 12,
            badField === "payloadNonce" ? 7 : 2
          ),
        wrapNonce: () =>
          make(
            badField === "wrapNonce" ? 11 : 12,
            badField === "wrapNonce" ? 7 : 3
          ),
        recordRevision: () =>
          "revision_v1_00000000-0000-4000-8000-000000000001",
      });
      const store = new EncryptedConnectionStore(
        new MemoryPersistence(),
        { current: CURRENT_KEK },
        source
      );
      const transferred = Buffer.from(SECRET_CANARY);
      await expect(
        store.store(CREATE_MUTATION, transferred)
      ).rejects.toMatchObject({ code: "internal_configuration_invalid" });
      expect(Array.from(transferred)).toEqual(
        Array(SECRET_CANARY.length).fill(0)
      );
      for (const buffer of returned) {
        expect(buffer.every((byte) => byte === 0)).toBe(true);
      }
    }
  });

  it("clears all returned random Buffers when a later source step fails", async () => {
    const returned = [
      Buffer.alloc(32, 1),
      Buffer.alloc(12, 2),
      Buffer.alloc(12, 3),
    ];
    const source: CredentialRandomSource = Object.freeze({
      dataKey: () => returned[0],
      payloadNonce: () => returned[1],
      wrapNonce: () => returned[2],
      recordRevision: () => {
        throw new Error(SECRET_CANARY);
      },
    });
    const store = new EncryptedConnectionStore(
      new MemoryPersistence(),
      { current: CURRENT_KEK },
      source
    );
    const transferred = Buffer.from(SECRET_CANARY);

    await expect(
      store.store(CREATE_MUTATION, transferred)
    ).rejects.toMatchObject({ code: "internal_configuration_invalid" });
    expect(Array.from(transferred)).toEqual(
      Array(SECRET_CANARY.length).fill(0)
    );
    for (const buffer of returned) {
      expect(buffer.every((byte) => byte === 0)).toBe(true);
    }
  });

  it("snapshots adapter records and rejects accessors, proxies, and extras", async () => {
    let getterCalls = 0;
    for (const mutate of [
      (record: StoredCredentialEnvelope) => {
        const accessor = { ...record } as Record<string, unknown>;
        Object.defineProperty(accessor, "creationOperationId", {
          enumerable: true,
          get: () => {
            getterCalls += 1;
            return getterCalls === 1 ? CREATE_OPERATION_ID : SECRET_CANARY;
          },
        });
        return accessor;
      },
      (record: StoredCredentialEnvelope) => new Proxy({ ...record }, {}),
      (record: StoredCredentialEnvelope) => ({
        ...record,
        token: SECRET_CANARY,
      }),
      (record: StoredCredentialEnvelope) => {
        const hidden = { ...record };
        Object.defineProperty(hidden, "hidden", {
          enumerable: false,
          value: SECRET_CANARY,
        });
        return hidden;
      },
    ]) {
      const { persistence, store } = createFixture({ seed: 250 });
      await storeText(store);
      persistence.record = mutate(
        persistence.record as StoredCredentialEnvelope
      ) as StoredCredentialEnvelope;
      await expect(store.use(IDENTITY, () => undefined)).rejects.toMatchObject({
        code: "invalid_record",
        message: "Credential record is invalid",
      });
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects malformed and over-bounds persisted fields", async () => {
    for (const patch of [
      { ciphertext: "not+padded=" },
      { payloadNonce: "A" },
      { wrappedDataKey: "A" },
      { ciphertext: "A".repeat(1_398_103) },
      { rotationSequence: 65_536 },
      { envelopeVersion: 2 },
    ]) {
      const { persistence, store } = createFixture({ seed: 260 });
      await storeText(store);
      persistence.record = patchRecord(
        persistence.record as StoredCredentialEnvelope,
        patch as Partial<StoredCredentialEnvelope>
      );
      await expect(store.use(IDENTITY, () => undefined)).rejects.toMatchObject({
        code: "invalid_record",
      });
    }
  });

  it("rejects proxy and accessor persistence outcomes without invoking getters", async () => {
    let getterCalls = 0;
    for (const result of [
      new Proxy({ status: "created" }, {}),
      Object.defineProperty({}, "status", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return "created";
        },
      }),
      { status: "created", extension: SECRET_CANARY },
    ]) {
      const persistence = new MemoryPersistence();
      persistence.createImplementation = async () =>
        result as unknown as CreateCredentialResult;
      const { store } = createFixture({ persistence });
      await expect(storeText(store)).rejects.toMatchObject({
        code: "persistence_unavailable",
      });
    }
    expect(getterCalls).toBe(0);
  });

  it("normalizes adapter and random-source failures without reflecting secrets", async () => {
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
      { current: CURRENT_KEK },
      randomSourceContract(new TestRandomSource())
    );
    for (const operation of [
      () => store.store(CREATE_MUTATION, Buffer.from(SECRET_CANARY)),
      () => store.use(IDENTITY, () => undefined),
      () => store.rotate(ROTATION_MUTATION),
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

    const failingRandomSource: CredentialRandomSource = Object.freeze({
      dataKey: () => {
        throw new Error(SECRET_CANARY);
      },
      payloadNonce: () => Buffer.alloc(12, 1),
      wrapNonce: () => Buffer.alloc(12, 2),
      recordRevision: () => "revision_v1_00000000-0000-4000-8000-000000000001",
    });
    const randomStore = new EncryptedConnectionStore(
      new MemoryPersistence(),
      { current: CURRENT_KEK },
      failingRandomSource
    );
    const error = await randomStore
      .store(CREATE_MUTATION, Buffer.from(SECRET_CANARY))
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: "internal_configuration_invalid",
      message: "Credential store configuration is invalid",
    });
    expect(String(error)).not.toContain(SECRET_CANARY);
  });
});
