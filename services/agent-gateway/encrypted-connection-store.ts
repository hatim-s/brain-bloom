import {
  createCipheriv,
  createDecipheriv,
  createHash,
  KeyObject,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { types as utilTypes } from "node:util";

import type { ControlPlaneOperationContext } from "./control-plane.ts";

const ENVELOPE_VERSION = 1;
const PAYLOAD_ALGORITHM = "aes-256-gcm";
const KEY_WRAP_ALGORITHM = "aes-256-gcm";
const AUTH_TAG_BYTES = 16;
const NONCE_BYTES = 12;
const DATA_KEY_BYTES = 32;
const MAX_CREDENTIAL_BYTES = 1_048_576;
const MAX_CIPHERTEXT_LENGTH = 1_398_102;
const MAX_CREDENTIAL_FORMAT_VERSION = 65_535;
const MAX_ROTATION_SEQUENCE = 65_535;
const MAX_KEK_ENCRYPTIONS_PER_STORE_INSTANCE = 65_536;

const UUID_V4_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OWNER_ID_PATTERN = /^user_[A-Za-z0-9]{16,64}$/;
const CREDENTIAL_ID_PATTERN = new RegExp(`^gwcred_v1_${UUID_V4_PATTERN}$`);
const OPERATION_ID_PATTERN = new RegExp(`^mutation_v1_${UUID_V4_PATTERN}$`);
const RECORD_REVISION_PATTERN = new RegExp(`^revision_v1_${UUID_V4_PATTERN}$`);
const KEY_VERSION_PATTERN = /^encryption-v1-[0-9a-f]{8}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type CredentialProvider = "codex";

type CredentialIdentity = Readonly<{
  ownerId: string;
  provider: CredentialProvider;
  credentialId: string;
  credentialFormatVersion: number;
}>;

type CredentialCreateMutation = CredentialIdentity &
  Readonly<{
    creationOperationId: string;
  }>;

type CredentialRotationMutation = CredentialIdentity &
  Readonly<{
    rotationOperationId: string;
  }>;

type CredentialKeyEncryptionKey = Readonly<{
  keyVersion: string;
  key: KeyObject;
}>;

type CredentialKeyEncryptionKeys = Readonly<{
  current: CredentialKeyEncryptionKey;
  previous?: CredentialKeyEncryptionKey;
}>;

type StoredCredentialEnvelope = Readonly<{
  envelopeVersion: typeof ENVELOPE_VERSION;
  payloadAlgorithm: typeof PAYLOAD_ALGORITHM;
  keyWrapAlgorithm: typeof KEY_WRAP_ALGORITHM;
  ownerId: string;
  provider: CredentialProvider;
  credentialId: string;
  credentialFormatVersion: number;
  keyVersion: string;
  creationOperationId: string;
  rotationSequence: number;
  lastRotationOperationId: string | null;
  recordRevision: string;
  payloadNonce: string;
  ciphertext: string;
  payloadAuthTag: string;
  wrappedDataKey: string;
  wrapNonce: string;
  wrapAuthTag: string;
}>;

type CreateCredentialResult =
  | Readonly<{ status: "created" }>
  | Readonly<{ status: "exists"; record: StoredCredentialEnvelope }>;

type ReplaceCredentialResult =
  | Readonly<{ status: "replaced" }>
  | Readonly<{ status: "conflict"; record: StoredCredentialEnvelope }>
  | Readonly<{ status: "missing" }>;

type DeleteCredentialResult =
  | Readonly<{ status: "deleted" }>
  | Readonly<{ status: "conflict"; record: StoredCredentialEnvelope }>
  | Readonly<{ status: "missing" }>;

/**
 * Atomic persistence boundary for encrypted credential envelopes.
 *
 * Implementations must key every method by the complete credential identity.
 * `create`, `replace`, and `delete` must each be one atomic storage operation;
 * replace and delete compare exactly against `expectedRecordRevision`. A read
 * after an ambiguous create outcome must be strongly consistent with any create
 * that committed before that outcome; otherwise reconciliation fails closed.
 */
interface EncryptedCredentialPersistence {
  read(
    identity: CredentialIdentity,
    context?: ControlPlaneOperationContext
  ): Promise<StoredCredentialEnvelope | null>;

  create(
    record: StoredCredentialEnvelope,
    context?: ControlPlaneOperationContext
  ): Promise<CreateCredentialResult>;

  replace(
    record: StoredCredentialEnvelope,
    expectedRecordRevision: string,
    context?: ControlPlaneOperationContext
  ): Promise<ReplaceCredentialResult>;

  delete(
    identity: CredentialIdentity,
    expectedRecordRevision: string,
    context?: ControlPlaneOperationContext
  ): Promise<DeleteCredentialResult>;
}

type CredentialStoreErrorCode =
  | "concurrent_modification"
  | "credential_already_exists"
  | "credential_not_found"
  | "decryption_failed"
  | "internal_configuration_invalid"
  | "invalid_input"
  | "invalid_record"
  | "key_unavailable"
  | "persistence_unavailable";

type StoreCredentialResult = Readonly<{
  status: "created" | "already_created";
  recordRevision: string;
  keyVersion: string;
}>;

type RotateCredentialResult = Readonly<{
  status: "already_current" | "rotated";
  recordRevision: string;
  keyVersion: string;
}>;

type DeleteStoredCredentialResult = Readonly<{
  status: "deleted" | "already_deleted";
}>;

type CredentialRandomSource = Readonly<{
  dataKey: () => Buffer;
  payloadNonce: () => Buffer;
  wrapNonce: () => Buffer;
  recordRevision: () => string;
}>;

type EnvelopeLineage = Readonly<{
  creationOperationId: string;
  rotationSequence: number;
  lastRotationOperationId: string | null;
}>;

type EncryptionMaterial = Readonly<{
  dataKey: Buffer;
  payloadNonce: Buffer;
  wrapNonce: Buffer;
  recordRevision: string;
}>;

/** Stable, secret-free failure exposed by the encrypted-store boundary. */
class CredentialStoreError extends Error {
  readonly code: CredentialStoreErrorCode;

  constructor(code: CredentialStoreErrorCode) {
    super(CREDENTIAL_STORE_ERROR_MESSAGES[code]);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

const CREDENTIAL_STORE_ERROR_MESSAGES = {
  concurrent_modification: "Credential record changed concurrently",
  credential_already_exists: "Credential record already exists",
  credential_not_found: "Credential record was not found",
  decryption_failed: "Credential record could not be decrypted",
  internal_configuration_invalid: "Credential store configuration is invalid",
  invalid_input: "Credential store input is invalid",
  invalid_record: "Credential record is invalid",
  key_unavailable: "Credential encryption key is unavailable",
  persistence_unavailable: "Credential persistence is unavailable",
} as const satisfies Record<CredentialStoreErrorCode, string>;

const DEFAULT_RANDOM_SOURCE: CredentialRandomSource = Object.freeze({
  dataKey: () => randomBytes(DATA_KEY_BYTES),
  payloadNonce: () => randomBytes(NONCE_BYTES),
  wrapNonce: () => randomBytes(NONCE_BYTES),
  recordRevision: () => `revision_v1_${randomUUID()}`,
});

/**
 * Stores opaque provider bundles using per-record envelope encryption.
 *
 * A fresh data-encryption key encrypts each credential and the versioned KEK
 * only wraps that DEK. Passing a Buffer transfers ownership to this method; the
 * caller must not retain or reuse it. Every transferred plaintext, random value,
 * and DEK buffer is cleared before persistence is awaited.
 * Decrypted bytes exist only for `use`'s callback lifetime and are then cleared.
 */
class EncryptedConnectionStore {
  private readonly keys: CredentialKeyEncryptionKeys;
  private readonly randomSource: CredentialRandomSource;
  private readonly maxKekEncryptions: number;
  private readonly dataKeyFingerprints = new Set<string>();
  private readonly wrapNoncesByKeyVersion = new Map<string, Set<string>>();
  private kekEncryptionCount = 0;

  constructor(
    private readonly persistence: EncryptedCredentialPersistence,
    keys: CredentialKeyEncryptionKeys,
    randomSource: CredentialRandomSource = DEFAULT_RANDOM_SOURCE,
    maxKekEncryptions = MAX_KEK_ENCRYPTIONS_PER_STORE_INSTANCE
  ) {
    this.keys = validateKeyRing(keys);
    this.randomSource = validateRandomSource(randomSource);
    if (
      !Number.isSafeInteger(maxKekEncryptions) ||
      maxKekEncryptions < 1 ||
      maxKekEncryptions > MAX_KEK_ENCRYPTIONS_PER_STORE_INSTANCE
    ) {
      throw new CredentialStoreError("internal_configuration_invalid");
    }
    this.maxKekEncryptions = maxKekEncryptions;
  }

  /** Creates one credential; a retry must match operation and payload exactly. */
  async store(
    mutation: CredentialCreateMutation,
    credentialPayload: Buffer,
    context?: ControlPlaneOperationContext
  ): Promise<StoreCredentialResult> {
    if (!Buffer.isBuffer(credentialPayload)) {
      throw new CredentialStoreError("invalid_input");
    }
    return this.storeOwnedCredentialBuffer(
      credentialPayload,
      mutation,
      context
    );
  }

  /** Owns and clears the Buffer before inspecting any hostile metadata or size. */
  private async storeOwnedCredentialBuffer(
    plaintext: Buffer,
    mutation: CredentialCreateMutation,
    context?: ControlPlaneOperationContext
  ): Promise<StoreCredentialResult> {
    let candidate: StoredCredentialEnvelope;
    let validatedMutation: CredentialCreateMutation;
    try {
      assertCredentialPayloadBounds(plaintext);
      validatedMutation = validateCreateMutation(mutation);
      candidate = this.encryptEnvelope(
        validatedMutation,
        {
          creationOperationId: validatedMutation.creationOperationId,
          rotationSequence: 0,
          lastRotationOperationId: null,
        },
        plaintext
      );
    } finally {
      // This executes before the first persistence/dependency await.
      clearBuffer(plaintext);
    }

    let result: CreateCredentialResult;
    try {
      const rawResult = await this.persistence.create(candidate, context);
      result = validateCreateResult(rawResult, validatedMutation);
    } catch {
      return this.reconcileAmbiguousCreate(
        candidate,
        validatedMutation,
        context
      );
    }
    if (result.status === "created") {
      return {
        status: "created",
        recordRevision: candidate.recordRevision,
        keyVersion: candidate.keyVersion,
      };
    }

    return this.resolveExistingCreate(
      candidate,
      result.record,
      validatedMutation
    );
  }

  /** Resolves a lost or malformed create response from encrypted state only. */
  private async reconcileAmbiguousCreate(
    candidate: StoredCredentialEnvelope,
    mutation: CredentialCreateMutation,
    context?: ControlPlaneOperationContext
  ): Promise<StoreCredentialResult> {
    let stored: StoredCredentialEnvelope | null;
    try {
      stored = await this.persistence.read(mutation, context);
    } catch {
      throw new CredentialStoreError("persistence_unavailable");
    }
    if (stored === null) {
      throw new CredentialStoreError("persistence_unavailable");
    }

    let existing: StoredCredentialEnvelope;
    try {
      existing = validateStoredRecord(stored, mutation);
    } catch {
      throw new CredentialStoreError("persistence_unavailable");
    }
    return this.resolveExistingCreate(candidate, existing, mutation);
  }

  /** Accepts an existing create only when lineage and payload both match. */
  private resolveExistingCreate(
    candidate: StoredCredentialEnvelope,
    existing: StoredCredentialEnvelope,
    mutation: CredentialCreateMutation
  ): StoreCredentialResult {
    if (
      existing.creationOperationId !== mutation.creationOperationId ||
      !this.recordsContainSamePayload(candidate, existing)
    ) {
      throw new CredentialStoreError("credential_already_exists");
    }
    return {
      status: "already_created",
      recordRevision: existing.recordRevision,
      keyVersion: existing.keyVersion,
    };
  }

  /** Decrypts one bundle for a callback and clears plaintext after settlement. */
  async use<T>(
    identity: CredentialIdentity,
    consume: (credentialPayload: Uint8Array) => T | PromiseLike<T>,
    context?: ControlPlaneOperationContext
  ): Promise<T> {
    const validatedIdentity = validateIdentity(identity);
    if (typeof consume !== "function") {
      throw new CredentialStoreError("invalid_input");
    }
    const stored = await callPersistence(() =>
      this.persistence.read(validatedIdentity, context)
    );
    if (stored === null) {
      throw new CredentialStoreError("credential_not_found");
    }

    const record = validateStoredRecord(stored, validatedIdentity);
    const plaintext = this.decryptEnvelope(record);
    try {
      return await consume(plaintext);
    } finally {
      clearBuffer(plaintext);
    }
  }

  /** Re-wraps a previous-KEK record with fresh DEK and immutable create lineage. */
  async rotate(
    mutation: CredentialRotationMutation,
    context?: ControlPlaneOperationContext
  ): Promise<RotateCredentialResult> {
    const validatedMutation = validateRotationMutation(mutation);
    const stored = await callPersistence(() =>
      this.persistence.read(validatedMutation, context)
    );
    if (stored === null) {
      throw new CredentialStoreError("credential_not_found");
    }

    const existing = validateStoredRecord(stored, validatedMutation);
    if (
      validatedMutation.rotationOperationId === existing.creationOperationId
    ) {
      throw new CredentialStoreError("invalid_input");
    }
    if (existing.keyVersion === this.keys.current.keyVersion) {
      this.authenticateRecord(existing);
      return {
        status: "already_current",
        recordRevision: existing.recordRevision,
        keyVersion: existing.keyVersion,
      };
    }
    if (existing.rotationSequence >= MAX_ROTATION_SEQUENCE) {
      throw new CredentialStoreError("invalid_record");
    }

    const plaintext = this.decryptEnvelope(existing);
    let replacement: StoredCredentialEnvelope;
    try {
      replacement = this.encryptEnvelope(
        validatedMutation,
        {
          creationOperationId: existing.creationOperationId,
          rotationSequence: existing.rotationSequence + 1,
          lastRotationOperationId: validatedMutation.rotationOperationId,
        },
        plaintext
      );
    } finally {
      // Re-encryption owns no mutable plaintext when the CAS begins.
      clearBuffer(plaintext);
    }

    const result = validateReplaceResult(
      await callPersistence(() =>
        this.persistence.replace(replacement, existing.recordRevision, context)
      ),
      validatedMutation
    );
    if (result.status === "replaced") {
      return {
        status: "rotated",
        recordRevision: replacement.recordRevision,
        keyVersion: replacement.keyVersion,
      };
    }
    if (result.status === "missing") {
      throw new CredentialStoreError("credential_not_found");
    }

    const conflicting = result.record;
    if (
      conflicting.keyVersion === this.keys.current.keyVersion &&
      conflicting.creationOperationId === existing.creationOperationId &&
      this.recordsContainSamePayload(replacement, conflicting)
    ) {
      return {
        status: "already_current",
        recordRevision: conflicting.recordRevision,
        keyVersion: conflicting.keyVersion,
      };
    }
    throw new CredentialStoreError("concurrent_modification");
  }

  /** Deletes exactly the record revision observed by this operation. */
  async delete(
    identity: CredentialIdentity,
    context?: ControlPlaneOperationContext
  ): Promise<DeleteStoredCredentialResult> {
    const validatedIdentity = validateIdentity(identity);
    const stored = await callPersistence(() =>
      this.persistence.read(validatedIdentity, context)
    );
    if (stored === null) return { status: "already_deleted" };

    const existing = validateStoredRecord(stored, validatedIdentity);
    const result = validateDeleteResult(
      await callPersistence(() =>
        this.persistence.delete(
          validatedIdentity,
          existing.recordRevision,
          context
        )
      ),
      validatedIdentity
    );
    if (result.status === "deleted") return { status: "deleted" };
    if (result.status === "missing") return { status: "already_deleted" };

    throw new CredentialStoreError("concurrent_modification");
  }

  /** Builds one envelope synchronously and clears fresh cryptographic material. */
  private encryptEnvelope(
    identity: CredentialIdentity,
    lineage: EnvelopeLineage,
    plaintext: Buffer
  ): StoredCredentialEnvelope {
    const material = this.createEncryptionMaterial();
    try {
      return encryptCredential(
        identity,
        lineage,
        plaintext,
        this.keys.current,
        material
      );
    } finally {
      clearBuffer(material.dataKey);
      clearBuffer(material.payloadNonce);
      clearBuffer(material.wrapNonce);
    }
  }

  /** Decrypts through the KEK-wrapped per-record DEK. */
  private decryptEnvelope(record: StoredCredentialEnvelope): Buffer {
    return decryptCredential(record, findDecryptionKey(record, this.keys));
  }

  /** Authenticates an envelope without retaining its plaintext. */
  private authenticateRecord(record: StoredCredentialEnvelope): void {
    const plaintext = this.decryptEnvelope(record);
    clearBuffer(plaintext);
  }

  /** Constant-time compares credential contents while clearing both plaintexts. */
  private recordsContainSamePayload(
    first: StoredCredentialEnvelope,
    second: StoredCredentialEnvelope
  ): boolean {
    const firstPlaintext = this.decryptEnvelope(first);
    let secondPlaintext: Buffer | undefined;
    let firstDigest: Buffer | undefined;
    let secondDigest: Buffer | undefined;
    try {
      secondPlaintext = this.decryptEnvelope(second);
      firstDigest = createHash("sha256").update(firstPlaintext).digest();
      secondDigest = createHash("sha256").update(secondPlaintext).digest();
      return timingSafeEqual(firstDigest, secondDigest);
    } finally {
      clearBuffer(firstPlaintext);
      clearBuffer(secondPlaintext);
      clearBuffer(firstDigest);
      clearBuffer(secondDigest);
    }
  }

  /** Generates and reserves one bounded set of fresh cryptographic material. */
  private createEncryptionMaterial(): EncryptionMaterial {
    if (this.kekEncryptionCount >= this.maxKekEncryptions) {
      throw new CredentialStoreError("internal_configuration_invalid");
    }

    let dataKey: Buffer | undefined;
    let payloadNonce: Buffer | undefined;
    let wrapNonce: Buffer | undefined;
    try {
      dataKey = takeRandomBytes(this.randomSource.dataKey(), DATA_KEY_BYTES);
      payloadNonce = takeRandomBytes(
        this.randomSource.payloadNonce(),
        NONCE_BYTES
      );
      wrapNonce = takeRandomBytes(this.randomSource.wrapNonce(), NONCE_BYTES);
      const recordRevision = this.randomSource.recordRevision();
      if (
        typeof recordRevision !== "string" ||
        !RECORD_REVISION_PATTERN.test(recordRevision) ||
        isAllZero(dataKey) ||
        isAllZero(payloadNonce) ||
        isAllZero(wrapNonce) ||
        timingSafeEqual(payloadNonce, wrapNonce)
      ) {
        throw new Error("invalid encryption material");
      }

      const fingerprintBytes = createHash("sha256").update(dataKey).digest();
      const dataKeyFingerprint = fingerprintBytes.toString("base64url");
      clearBuffer(fingerprintBytes);
      const wrapNonceText = wrapNonce.toString("base64url");
      const keyNonces =
        this.wrapNoncesByKeyVersion.get(this.keys.current.keyVersion) ??
        new Set<string>();
      if (
        this.dataKeyFingerprints.has(dataKeyFingerprint) ||
        keyNonces.has(wrapNonceText)
      ) {
        throw new Error("duplicate encryption material");
      }

      this.dataKeyFingerprints.add(dataKeyFingerprint);
      keyNonces.add(wrapNonceText);
      this.wrapNoncesByKeyVersion.set(this.keys.current.keyVersion, keyNonces);
      this.kekEncryptionCount += 1;
      return { dataKey, payloadNonce, wrapNonce, recordRevision };
    } catch {
      clearBuffer(dataKey);
      clearBuffer(payloadNonce);
      clearBuffer(wrapNonce);
      throw new CredentialStoreError("internal_configuration_invalid");
    }
  }
}

/** Encrypts payload under a fresh DEK and wraps only that DEK under the KEK. */
function encryptCredential(
  identity: CredentialIdentity,
  lineage: EnvelopeLineage,
  plaintext: Buffer,
  keyEncryptionKey: CredentialKeyEncryptionKey,
  material: EncryptionMaterial
): StoredCredentialEnvelope {
  const common = commonMetadata(
    identity,
    lineage,
    keyEncryptionKey.keyVersion,
    material.recordRevision
  );
  const payloadAad = encodeCanonicalAad({
    ...common,
    layer: "credential-payload-v1",
  });
  let ciphertext: Buffer | undefined;
  let payloadAuthTag: Buffer | undefined;
  let wrappedDataKey: Buffer | undefined;
  let wrapAuthTag: Buffer | undefined;
  let wrapAad: Buffer | undefined;

  try {
    const payloadCipher = createCipheriv(
      PAYLOAD_ALGORITHM,
      material.dataKey,
      material.payloadNonce,
      { authTagLength: AUTH_TAG_BYTES }
    );
    payloadCipher.setAAD(payloadAad);
    ciphertext = Buffer.concat([
      payloadCipher.update(plaintext),
      payloadCipher.final(),
    ]);
    payloadAuthTag = payloadCipher.getAuthTag();

    const payloadDigest = createHash("sha256").update(ciphertext).digest();
    try {
      wrapAad = encodeCanonicalAad({
        ...common,
        layer: "data-key-wrap-v1",
        payloadNonce: material.payloadNonce.toString("base64url"),
        payloadAuthTag: payloadAuthTag.toString("base64url"),
        ciphertextDigest: payloadDigest.toString("base64url"),
      });
    } finally {
      clearBuffer(payloadDigest);
    }

    const wrapCipher = createCipheriv(
      KEY_WRAP_ALGORITHM,
      keyEncryptionKey.key,
      material.wrapNonce,
      { authTagLength: AUTH_TAG_BYTES }
    );
    wrapCipher.setAAD(wrapAad);
    wrappedDataKey = Buffer.concat([
      wrapCipher.update(material.dataKey),
      wrapCipher.final(),
    ]);
    wrapAuthTag = wrapCipher.getAuthTag();

    return Object.freeze({
      ...common,
      payloadNonce: material.payloadNonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      payloadAuthTag: payloadAuthTag.toString("base64url"),
      wrappedDataKey: wrappedDataKey.toString("base64url"),
      wrapNonce: material.wrapNonce.toString("base64url"),
      wrapAuthTag: wrapAuthTag.toString("base64url"),
    });
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error;
    throw new CredentialStoreError("internal_configuration_invalid");
  } finally {
    clearBuffer(payloadAad);
    clearBuffer(wrapAad);
    clearBuffer(ciphertext);
    clearBuffer(payloadAuthTag);
    clearBuffer(wrappedDataKey);
    clearBuffer(wrapAuthTag);
  }
}

/** Unwraps the per-record DEK, authenticates payload AAD, and decrypts bytes. */
function decryptCredential(
  record: StoredCredentialEnvelope,
  keyEncryptionKey: CredentialKeyEncryptionKey
): Buffer {
  const payloadNonce = decodeBase64Url(record.payloadNonce, NONCE_BYTES);
  const ciphertext = decodeBase64Url(record.ciphertext);
  const payloadAuthTag = decodeBase64Url(record.payloadAuthTag, AUTH_TAG_BYTES);
  const wrappedDataKey = decodeBase64Url(record.wrappedDataKey, DATA_KEY_BYTES);
  const wrapNonce = decodeBase64Url(record.wrapNonce, NONCE_BYTES);
  const wrapAuthTag = decodeBase64Url(record.wrapAuthTag, AUTH_TAG_BYTES);
  const common = commonMetadataFromRecord(record);
  const payloadDigest = createHash("sha256").update(ciphertext).digest();
  const wrapAad = encodeCanonicalAad({
    ...common,
    layer: "data-key-wrap-v1",
    payloadNonce: record.payloadNonce,
    payloadAuthTag: record.payloadAuthTag,
    ciphertextDigest: payloadDigest.toString("base64url"),
  });
  clearBuffer(payloadDigest);
  let dataKey: Buffer | undefined;
  let plaintextFirst: Buffer | undefined;

  try {
    const unwrap = createDecipheriv(
      KEY_WRAP_ALGORITHM,
      keyEncryptionKey.key,
      wrapNonce,
      { authTagLength: AUTH_TAG_BYTES }
    );
    unwrap.setAAD(wrapAad);
    unwrap.setAuthTag(wrapAuthTag);
    dataKey = Buffer.concat([unwrap.update(wrappedDataKey), unwrap.final()]);
    if (dataKey.byteLength !== DATA_KEY_BYTES) {
      throw new Error("invalid data key");
    }

    const payloadAad = encodeCanonicalAad({
      ...common,
      layer: "credential-payload-v1",
    });
    try {
      const decipher = createDecipheriv(
        PAYLOAD_ALGORITHM,
        dataKey,
        payloadNonce,
        { authTagLength: AUTH_TAG_BYTES }
      );
      decipher.setAAD(payloadAad);
      decipher.setAuthTag(payloadAuthTag);
      plaintextFirst = decipher.update(ciphertext);
      const plaintextFinal = decipher.final();
      try {
        const plaintext = Buffer.concat([plaintextFirst, plaintextFinal]);
        if (
          plaintext.byteLength === 0 ||
          plaintext.byteLength > MAX_CREDENTIAL_BYTES
        ) {
          clearBuffer(plaintext);
          throw new Error("invalid plaintext length");
        }
        return plaintext;
      } finally {
        clearBuffer(plaintextFinal);
      }
    } finally {
      clearBuffer(payloadAad);
    }
  } catch {
    throw new CredentialStoreError("decryption_failed");
  } finally {
    clearBuffer(dataKey);
    clearBuffer(plaintextFirst);
    clearBuffer(payloadNonce);
    clearBuffer(ciphertext);
    clearBuffer(payloadAuthTag);
    clearBuffer(wrappedDataKey);
    clearBuffer(wrapNonce);
    clearBuffer(wrapAuthTag);
    clearBuffer(wrapAad);
  }
}

/** Returns common metadata in the sole canonical AAD property order. */
function commonMetadata(
  identity: CredentialIdentity,
  lineage: EnvelopeLineage,
  keyVersion: string,
  recordRevision: string
) {
  return {
    envelopeVersion: ENVELOPE_VERSION,
    payloadAlgorithm: PAYLOAD_ALGORITHM,
    keyWrapAlgorithm: KEY_WRAP_ALGORITHM,
    ownerId: identity.ownerId,
    provider: identity.provider,
    credentialId: identity.credentialId,
    credentialFormatVersion: identity.credentialFormatVersion,
    keyVersion,
    creationOperationId: lineage.creationOperationId,
    rotationSequence: lineage.rotationSequence,
    lastRotationOperationId: lineage.lastRotationOperationId,
    recordRevision,
  } as const;
}

/** Reconstructs canonical common metadata from one validated record. */
function commonMetadataFromRecord(record: StoredCredentialEnvelope) {
  return commonMetadata(
    record,
    record,
    record.keyVersion,
    record.recordRevision
  );
}

/** Encodes fixed-order metadata into a temporary AAD buffer. */
function encodeCanonicalAad(value: object): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

/** Selects only the explicitly configured current or previous KEK. */
function findDecryptionKey(
  record: StoredCredentialEnvelope,
  keys: CredentialKeyEncryptionKeys
): CredentialKeyEncryptionKey {
  if (record.keyVersion === keys.current.keyVersion) return keys.current;
  if (record.keyVersion === keys.previous?.keyVersion) return keys.previous;
  throw new CredentialStoreError("key_unavailable");
}

/** Bounds a Buffer after ownership has entered an unconditional clearing scope. */
function assertCredentialPayloadBounds(payload: Buffer): void {
  if (payload.byteLength === 0 || payload.byteLength > MAX_CREDENTIAL_BYTES) {
    throw new CredentialStoreError("invalid_input");
  }
}

/** Accepts ownership of one exact-sized random Buffer for immediate clearing. */
function takeRandomBytes(value: unknown, expectedBytes: number): Buffer {
  if (!Buffer.isBuffer(value)) {
    throw new Error("invalid random bytes");
  }
  if (value.byteLength !== expectedBytes) {
    clearBuffer(value);
    throw new Error("invalid random bytes");
  }
  return value;
}

/** Clears a Buffer through the native method even if an instance shadows it. */
function clearBuffer(value: Buffer | undefined): void {
  if (value !== undefined) Buffer.prototype.fill.call(value, 0);
}

/** Checks an owned random buffer without allocating secret-derived text. */
function isAllZero(value: Buffer): boolean {
  let combined = 0;
  for (let index = 0; index < value.length; index += 1) {
    combined |= value[index];
  }
  return combined === 0;
}

/** Validates and snapshots the closed credential identity. */
function validateIdentity(value: unknown): CredentialIdentity {
  const snapshot = snapshotExactDataObject(
    value,
    [["ownerId", "provider", "credentialId", "credentialFormatVersion"]],
    "invalid_input"
  );
  if (
    typeof snapshot.ownerId !== "string" ||
    !OWNER_ID_PATTERN.test(snapshot.ownerId) ||
    snapshot.provider !== "codex" ||
    typeof snapshot.credentialId !== "string" ||
    !CREDENTIAL_ID_PATTERN.test(snapshot.credentialId) ||
    !Number.isSafeInteger(snapshot.credentialFormatVersion) ||
    (snapshot.credentialFormatVersion as number) < 1 ||
    (snapshot.credentialFormatVersion as number) > MAX_CREDENTIAL_FORMAT_VERSION
  ) {
    throw new CredentialStoreError("invalid_input");
  }
  return Object.freeze({
    ownerId: snapshot.ownerId,
    provider: "codex",
    credentialId: snapshot.credentialId,
    credentialFormatVersion: snapshot.credentialFormatVersion as number,
  });
}

/** Validates and snapshots immutable creation idempotency. */
function validateCreateMutation(value: unknown): CredentialCreateMutation {
  const snapshot = snapshotExactDataObject(
    value,
    [
      [
        "ownerId",
        "provider",
        "credentialId",
        "credentialFormatVersion",
        "creationOperationId",
      ],
    ],
    "invalid_input"
  );
  const identity = validateIdentity({
    ownerId: snapshot.ownerId,
    provider: snapshot.provider,
    credentialId: snapshot.credentialId,
    credentialFormatVersion: snapshot.credentialFormatVersion,
  });
  if (
    typeof snapshot.creationOperationId !== "string" ||
    !OPERATION_ID_PATTERN.test(snapshot.creationOperationId)
  ) {
    throw new CredentialStoreError("invalid_input");
  }
  return Object.freeze({
    ...identity,
    creationOperationId: snapshot.creationOperationId,
  });
}

/** Validates and snapshots a rotation operation independently of create lineage. */
function validateRotationMutation(value: unknown): CredentialRotationMutation {
  const snapshot = snapshotExactDataObject(
    value,
    [
      [
        "ownerId",
        "provider",
        "credentialId",
        "credentialFormatVersion",
        "rotationOperationId",
      ],
    ],
    "invalid_input"
  );
  const identity = validateIdentity({
    ownerId: snapshot.ownerId,
    provider: snapshot.provider,
    credentialId: snapshot.credentialId,
    credentialFormatVersion: snapshot.credentialFormatVersion,
  });
  if (
    typeof snapshot.rotationOperationId !== "string" ||
    !OPERATION_ID_PATTERN.test(snapshot.rotationOperationId)
  ) {
    throw new CredentialStoreError("invalid_input");
  }
  return Object.freeze({
    ...identity,
    rotationOperationId: snapshot.rotationOperationId,
  });
}

/** Validates and snapshots a persistence record before any later use. */
function validateStoredRecord(
  value: unknown,
  expected: CredentialIdentity
): StoredCredentialEnvelope {
  const snapshot = snapshotExactDataObject(
    value,
    [
      [
        "envelopeVersion",
        "payloadAlgorithm",
        "keyWrapAlgorithm",
        "ownerId",
        "provider",
        "credentialId",
        "credentialFormatVersion",
        "keyVersion",
        "creationOperationId",
        "rotationSequence",
        "lastRotationOperationId",
        "recordRevision",
        "payloadNonce",
        "ciphertext",
        "payloadAuthTag",
        "wrappedDataKey",
        "wrapNonce",
        "wrapAuthTag",
      ],
    ],
    "invalid_record"
  );
  if (
    snapshot.envelopeVersion !== ENVELOPE_VERSION ||
    snapshot.payloadAlgorithm !== PAYLOAD_ALGORITHM ||
    snapshot.keyWrapAlgorithm !== KEY_WRAP_ALGORITHM ||
    snapshot.ownerId !== expected.ownerId ||
    snapshot.provider !== expected.provider ||
    snapshot.credentialId !== expected.credentialId ||
    snapshot.credentialFormatVersion !== expected.credentialFormatVersion ||
    typeof snapshot.keyVersion !== "string" ||
    !KEY_VERSION_PATTERN.test(snapshot.keyVersion) ||
    typeof snapshot.creationOperationId !== "string" ||
    !OPERATION_ID_PATTERN.test(snapshot.creationOperationId) ||
    !Number.isSafeInteger(snapshot.rotationSequence) ||
    (snapshot.rotationSequence as number) < 0 ||
    (snapshot.rotationSequence as number) > MAX_ROTATION_SEQUENCE ||
    !isOptionalOperationId(snapshot.lastRotationOperationId) ||
    snapshot.lastRotationOperationId === snapshot.creationOperationId ||
    ((snapshot.rotationSequence as number) === 0) !==
      (snapshot.lastRotationOperationId === null) ||
    typeof snapshot.recordRevision !== "string" ||
    !RECORD_REVISION_PATTERN.test(snapshot.recordRevision) ||
    !isBoundedBase64Url(snapshot.payloadNonce, 16) ||
    !isBoundedBase64Url(snapshot.payloadAuthTag, 22) ||
    !isBoundedBase64Url(snapshot.wrapNonce, 16) ||
    !isBoundedBase64Url(snapshot.wrapAuthTag, 22) ||
    !isBoundedBase64Url(snapshot.wrappedDataKey, 43) ||
    !isBoundedBase64Url(snapshot.ciphertext, MAX_CIPHERTEXT_LENGTH)
  ) {
    throw new CredentialStoreError("invalid_record");
  }

  const payloadNonce = decodeBase64Url(snapshot.payloadNonce, NONCE_BYTES);
  const payloadAuthTag = decodeBase64Url(
    snapshot.payloadAuthTag,
    AUTH_TAG_BYTES
  );
  const wrapNonce = decodeBase64Url(snapshot.wrapNonce, NONCE_BYTES);
  const wrapAuthTag = decodeBase64Url(snapshot.wrapAuthTag, AUTH_TAG_BYTES);
  const wrappedDataKey = decodeBase64Url(
    snapshot.wrappedDataKey,
    DATA_KEY_BYTES
  );
  const ciphertext = decodeBase64Url(snapshot.ciphertext);
  try {
    if (
      ciphertext.byteLength === 0 ||
      ciphertext.byteLength > MAX_CREDENTIAL_BYTES ||
      isAllZero(payloadNonce) ||
      isAllZero(wrapNonce) ||
      timingSafeEqual(payloadNonce, wrapNonce)
    ) {
      throw new CredentialStoreError("invalid_record");
    }
  } finally {
    clearBuffer(payloadNonce);
    clearBuffer(payloadAuthTag);
    clearBuffer(wrapNonce);
    clearBuffer(wrapAuthTag);
    clearBuffer(wrappedDataKey);
    clearBuffer(ciphertext);
  }

  return Object.freeze({
    envelopeVersion: ENVELOPE_VERSION,
    payloadAlgorithm: PAYLOAD_ALGORITHM,
    keyWrapAlgorithm: KEY_WRAP_ALGORITHM,
    ownerId: snapshot.ownerId as string,
    provider: "codex",
    credentialId: snapshot.credentialId as string,
    credentialFormatVersion: snapshot.credentialFormatVersion as number,
    keyVersion: snapshot.keyVersion,
    creationOperationId: snapshot.creationOperationId,
    rotationSequence: snapshot.rotationSequence as number,
    lastRotationOperationId: snapshot.lastRotationOperationId,
    recordRevision: snapshot.recordRevision,
    payloadNonce: snapshot.payloadNonce,
    ciphertext: snapshot.ciphertext,
    payloadAuthTag: snapshot.payloadAuthTag,
    wrappedDataKey: snapshot.wrappedDataKey,
    wrapNonce: snapshot.wrapNonce,
    wrapAuthTag: snapshot.wrapAuthTag,
  });
}

/** Validates the two-KEK overlap without exposing material or accepting aliases. */
function validateKeyRing(value: unknown): CredentialKeyEncryptionKeys {
  try {
    const snapshot = snapshotExactDataObject(
      value,
      [["current"], ["current", "previous"]],
      "internal_configuration_invalid"
    );
    const current = validateEncryptionKey(snapshot.current);
    const previous =
      snapshot.previous === undefined
        ? undefined
        : validateEncryptionKey(snapshot.previous);
    if (
      previous !== undefined &&
      (previous.keyVersion === current.keyVersion ||
        previous.key.equals(current.key))
    ) {
      throw new CredentialStoreError("internal_configuration_invalid");
    }
    return Object.freeze({ current, ...(previous ? { previous } : {}) });
  } catch {
    throw new CredentialStoreError("internal_configuration_invalid");
  }
}

/** Accepts one exact 256-bit Node secret KEK without exporting it. */
function validateEncryptionKey(value: unknown): CredentialKeyEncryptionKey {
  const snapshot = snapshotExactDataObject(
    value,
    [["keyVersion", "key"]],
    "internal_configuration_invalid"
  );
  if (
    typeof snapshot.keyVersion !== "string" ||
    !KEY_VERSION_PATTERN.test(snapshot.keyVersion) ||
    !(snapshot.key instanceof KeyObject) ||
    snapshot.key.type !== "secret" ||
    snapshot.key.symmetricKeySize !== 32
  ) {
    throw new CredentialStoreError("internal_configuration_invalid");
  }
  return Object.freeze({ keyVersion: snapshot.keyVersion, key: snapshot.key });
}

/** Snapshots the injected randomness interface without invoking accessors. */
function validateRandomSource(value: unknown): CredentialRandomSource {
  try {
    const snapshot = snapshotExactDataObject(
      value,
      [["dataKey", "payloadNonce", "wrapNonce", "recordRevision"]],
      "internal_configuration_invalid"
    );
    if (
      typeof snapshot.dataKey !== "function" ||
      typeof snapshot.payloadNonce !== "function" ||
      typeof snapshot.wrapNonce !== "function" ||
      typeof snapshot.recordRevision !== "function"
    ) {
      throw new Error("invalid random source");
    }
    return Object.freeze({
      dataKey: snapshot.dataKey as () => Buffer,
      payloadNonce: snapshot.payloadNonce as () => Buffer,
      wrapNonce: snapshot.wrapNonce as () => Buffer,
      recordRevision: snapshot.recordRevision as () => string,
    });
  } catch {
    throw new CredentialStoreError("internal_configuration_invalid");
  }
}

/** Normalizes all adapter throws so backend details never cross the boundary. */
async function callPersistence<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new CredentialStoreError("persistence_unavailable");
  }
}

/** Snapshots and validates the closed create-result union. */
function validateCreateResult(
  value: unknown,
  expected: CredentialIdentity
): CreateCredentialResult {
  try {
    const snapshot = snapshotExactDataObject(
      value,
      [["status"], ["status", "record"]],
      "persistence_unavailable"
    );
    if (snapshot.status === "created" && !("record" in snapshot)) {
      return { status: "created" };
    }
    if (snapshot.status === "exists" && "record" in snapshot) {
      return {
        status: "exists",
        record: validateStoredRecord(snapshot.record, expected),
      };
    }
  } catch {
    // Fall through to one stable adapter-contract failure.
  }
  throw new CredentialStoreError("persistence_unavailable");
}

/** Snapshots and validates the closed CAS-replace result union. */
function validateReplaceResult(
  value: unknown,
  expected: CredentialIdentity
): ReplaceCredentialResult {
  try {
    const snapshot = snapshotExactDataObject(
      value,
      [["status"], ["status", "record"]],
      "persistence_unavailable"
    );
    if (
      (snapshot.status === "replaced" || snapshot.status === "missing") &&
      !("record" in snapshot)
    ) {
      return { status: snapshot.status };
    }
    if (snapshot.status === "conflict" && "record" in snapshot) {
      return {
        status: "conflict",
        record: validateStoredRecord(snapshot.record, expected),
      };
    }
  } catch {
    // Fall through to one stable adapter-contract failure.
  }
  throw new CredentialStoreError("persistence_unavailable");
}

/** Snapshots and validates the closed CAS-delete result union. */
function validateDeleteResult(
  value: unknown,
  expected: CredentialIdentity
): DeleteCredentialResult {
  try {
    const snapshot = snapshotExactDataObject(
      value,
      [["status"], ["status", "record"]],
      "persistence_unavailable"
    );
    if (
      (snapshot.status === "deleted" || snapshot.status === "missing") &&
      !("record" in snapshot)
    ) {
      return { status: snapshot.status };
    }
    if (snapshot.status === "conflict" && "record" in snapshot) {
      return {
        status: "conflict",
        record: validateStoredRecord(snapshot.record, expected),
      };
    }
  } catch {
    // Fall through to one stable adapter-contract failure.
  }
  throw new CredentialStoreError("persistence_unavailable");
}

/** Strictly decodes canonical unpadded base64url with an optional byte length. */
function decodeBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new CredentialStoreError("invalid_record");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)
  ) {
    clearBuffer(decoded);
    throw new CredentialStoreError("invalid_record");
  }
  return decoded;
}

/** Checks a scalar for bounded canonical base64url before decoding. */
function isBoundedBase64Url(
  value: unknown,
  maxLength: number
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    BASE64URL_PATTERN.test(value)
  );
}

/** Accepts null or one valid bounded mutation id. */
function isOptionalOperationId(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && OPERATION_ID_PATTERN.test(value))
  );
}

/**
 * Takes one data-descriptor snapshot and rejects proxy/accessor/hidden state.
 *
 * No caller or adapter property is read again after this function returns.
 * The snapshot itself is a fresh frozen plain object with only the closed keys.
 */
function snapshotExactDataObject(
  value: unknown,
  expectedShapes: readonly (readonly string[])[],
  errorCode:
    | "internal_configuration_invalid"
    | "invalid_input"
    | "invalid_record"
    | "persistence_unavailable"
): Readonly<Record<string, unknown>> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      utilTypes.isProxy(value)
    ) {
      throw new Error("invalid object");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("invalid prototype");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new Error("symbol field");
    }
    const actualKeys = (ownKeys as string[]).sort();
    const matchingShape = expectedShapes.find((shape) => {
      const expectedKeys = [...shape].sort();
      return (
        expectedKeys.length === actualKeys.length &&
        expectedKeys.every((key, index) => key === actualKeys[index])
      );
    });
    if (matchingShape === undefined) {
      throw new Error("unexpected fields");
    }

    const snapshot: Record<string, unknown> = {};
    for (const key of matchingShape) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        descriptor.enumerable !== true
      ) {
        throw new Error("non-data field");
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    throw new CredentialStoreError(errorCode);
  }
}

export {
  AUTH_TAG_BYTES,
  type CreateCredentialResult,
  type CredentialCreateMutation,
  type CredentialIdentity,
  type CredentialKeyEncryptionKey,
  type CredentialKeyEncryptionKeys,
  type CredentialProvider,
  type CredentialRandomSource,
  type CredentialRotationMutation,
  CredentialStoreError,
  type CredentialStoreErrorCode,
  DATA_KEY_BYTES,
  type DeleteCredentialResult,
  type DeleteStoredCredentialResult,
  EncryptedConnectionStore,
  type EncryptedCredentialPersistence,
  ENVELOPE_VERSION,
  KEY_WRAP_ALGORITHM,
  MAX_CREDENTIAL_BYTES,
  MAX_KEK_ENCRYPTIONS_PER_STORE_INSTANCE,
  NONCE_BYTES,
  PAYLOAD_ALGORITHM,
  type ReplaceCredentialResult,
  type RotateCredentialResult,
  type StoreCredentialResult,
  type StoredCredentialEnvelope,
};
