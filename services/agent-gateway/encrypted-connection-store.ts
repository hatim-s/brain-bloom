import {
  createCipheriv,
  createDecipheriv,
  KeyObject,
  randomBytes,
  randomUUID,
} from "node:crypto";

import type { ControlPlaneOperationContext } from "./control-plane.ts";

const ENVELOPE_VERSION = 1;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const AUTH_TAG_BYTES = 16;
const NONCE_BYTES = 12;
const MAX_CREDENTIAL_BYTES = 1_048_576;
const MAX_CIPHERTEXT_LENGTH = 1_398_102;
const MAX_CREDENTIAL_FORMAT_VERSION = 65_535;

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

type CredentialMutation = CredentialIdentity &
  Readonly<{
    operationId: string;
  }>;

type CredentialEncryptionKey = Readonly<{
  keyVersion: string;
  key: KeyObject;
}>;

type CredentialEncryptionKeys = Readonly<{
  current: CredentialEncryptionKey;
  previous?: CredentialEncryptionKey;
}>;

type StoredCredentialEnvelope = Readonly<{
  envelopeVersion: typeof ENVELOPE_VERSION;
  algorithm: typeof ENCRYPTION_ALGORITHM;
  ownerId: string;
  provider: CredentialProvider;
  credentialId: string;
  credentialFormatVersion: number;
  keyVersion: string;
  operationId: string;
  recordRevision: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
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
 * Implementations must key all methods by the complete credential identity.
 * `create`, `replace`, and `delete` must each be one atomic storage operation;
 * `replace` and `delete` compare exactly against `expectedRecordRevision`.
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
  nonce: () => Uint8Array;
  recordRevision: () => string;
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
  nonce: () => randomBytes(NONCE_BYTES),
  recordRevision: () => `revision_v1_${randomUUID()}`,
});

/**
 * Encrypts and atomically persists opaque provider-owned credential bundles.
 *
 * The store never serializes plaintext and only exposes decrypted bytes to a
 * callback. Its temporary plaintext copy is cleared after encryption, and the
 * decrypted buffer is cleared after the callback settles. The callback must not
 * retain aliases and must independently clear any copy it creates.
 */
class EncryptedConnectionStore {
  private readonly keys: CredentialEncryptionKeys;

  constructor(
    private readonly persistence: EncryptedCredentialPersistence,
    keys: CredentialEncryptionKeys,
    private readonly randomSource: CredentialRandomSource = DEFAULT_RANDOM_SOURCE
  ) {
    this.keys = validateKeyRing(keys);
    validateRandomSource(randomSource);
  }

  /** Creates one credential, treating only the same operation id as a retry. */
  async store(
    mutation: CredentialMutation,
    credentialPayload: Uint8Array,
    context?: ControlPlaneOperationContext
  ): Promise<StoreCredentialResult> {
    const validatedMutation = validateMutation(mutation);
    const plaintext = copyCredentialPayload(credentialPayload);

    try {
      const record = encryptCredential(
        validatedMutation,
        plaintext,
        this.keys.current,
        this.randomSource
      );
      const result = await callPersistence(() =>
        this.persistence.create(record, context)
      );
      validateCreateResult(result, validatedMutation);

      if (result.status === "created") {
        return {
          status: "created",
          recordRevision: record.recordRevision,
          keyVersion: record.keyVersion,
        };
      }

      const existing = validateStoredRecord(result.record, validatedMutation);
      if (existing.operationId !== validatedMutation.operationId) {
        throw new CredentialStoreError("credential_already_exists");
      }
      authenticateRecord(existing, this.keys);

      return {
        status: "already_created",
        recordRevision: existing.recordRevision,
        keyVersion: existing.keyVersion,
      };
    } finally {
      plaintext.fill(0);
    }
  }

  /** Decrypts one bundle for a callback and clears plaintext after it settles. */
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
    const plaintext = decryptCredential(
      record,
      findDecryptionKey(record, this.keys)
    );
    try {
      return await consume(plaintext);
    } finally {
      plaintext.fill(0);
    }
  }

  /**
   * Re-encrypts a previous-key record under the current key with atomic CAS.
   *
   * Current-key records are an idempotent no-op. Unknown key versions fail
   * closed; callers must never widen the overlap ring to bypass rotation.
   */
  async rotate(
    mutation: CredentialMutation,
    context?: ControlPlaneOperationContext
  ): Promise<RotateCredentialResult> {
    const validatedMutation = validateMutation(mutation);
    const stored = await callPersistence(() =>
      this.persistence.read(validatedMutation, context)
    );
    if (stored === null) {
      throw new CredentialStoreError("credential_not_found");
    }

    const existing = validateStoredRecord(stored, validatedMutation);
    if (existing.keyVersion === this.keys.current.keyVersion) {
      authenticateRecord(existing, this.keys);
      return {
        status: "already_current",
        recordRevision: existing.recordRevision,
        keyVersion: existing.keyVersion,
      };
    }

    const plaintext = decryptCredential(
      existing,
      findDecryptionKey(existing, this.keys)
    );
    try {
      const replacement = encryptCredential(
        validatedMutation,
        plaintext,
        this.keys.current,
        this.randomSource
      );
      const result = await callPersistence(() =>
        this.persistence.replace(replacement, existing.recordRevision, context)
      );
      validateReplaceResult(result, validatedMutation);

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

      const conflicting = validateStoredRecord(
        result.record,
        validatedMutation
      );
      // A concurrent successful rotation makes retries safely idempotent.
      if (conflicting.keyVersion === this.keys.current.keyVersion) {
        authenticateRecord(conflicting, this.keys);
        return {
          status: "already_current",
          recordRevision: conflicting.recordRevision,
          keyVersion: conflicting.keyVersion,
        };
      }
      throw new CredentialStoreError("concurrent_modification");
    } finally {
      plaintext.fill(0);
    }
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
    const result = await callPersistence(() =>
      this.persistence.delete(
        validatedIdentity,
        existing.recordRevision,
        context
      )
    );
    validateDeleteResult(result, validatedIdentity);

    if (result.status === "deleted") return { status: "deleted" };
    if (result.status === "missing") return { status: "already_deleted" };

    validateStoredRecord(result.record, validatedIdentity);
    throw new CredentialStoreError("concurrent_modification");
  }
}

/** Encrypts one bounded plaintext copy with all record metadata as AAD. */
function encryptCredential(
  mutation: CredentialMutation,
  plaintext: Buffer,
  encryptionKey: CredentialEncryptionKey,
  randomSource: CredentialRandomSource
): StoredCredentialEnvelope {
  let nonce: Buffer | undefined;
  let recordRevision: string;
  try {
    const randomNonce = randomSource.nonce();
    if (
      !(randomNonce instanceof Uint8Array) ||
      randomNonce.byteLength !== NONCE_BYTES
    ) {
      throw new Error("invalid nonce source");
    }
    nonce = Buffer.from(randomNonce);
    recordRevision = randomSource.recordRevision();
    if (
      typeof recordRevision !== "string" ||
      !RECORD_REVISION_PATTERN.test(recordRevision)
    ) {
      throw new Error("invalid revision source");
    }
  } catch {
    nonce?.fill(0);
    throw new CredentialStoreError("internal_configuration_invalid");
  }

  const metadata = {
    envelopeVersion: ENVELOPE_VERSION,
    algorithm: ENCRYPTION_ALGORITHM,
    ownerId: mutation.ownerId,
    provider: mutation.provider,
    credentialId: mutation.credentialId,
    credentialFormatVersion: mutation.credentialFormatVersion,
    keyVersion: encryptionKey.keyVersion,
    operationId: mutation.operationId,
    recordRevision,
  } as const;
  const aad = Buffer.from(JSON.stringify(metadata), "utf8");

  try {
    const cipher = createCipheriv(
      ENCRYPTION_ALGORITHM,
      encryptionKey.key,
      nonce,
      { authTagLength: AUTH_TAG_BYTES }
    );
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    try {
      return Object.freeze({
        ...metadata,
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        authTag: authTag.toString("base64url"),
      });
    } finally {
      ciphertext.fill(0);
      authTag.fill(0);
    }
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error;
    throw new CredentialStoreError("internal_configuration_invalid");
  } finally {
    nonce.fill(0);
    aad.fill(0);
  }
}

/** Authenticates and decrypts one strict envelope without reflecting details. */
function decryptCredential(
  record: StoredCredentialEnvelope,
  encryptionKey: CredentialEncryptionKey
): Buffer {
  const nonce = decodeBase64Url(record.nonce, NONCE_BYTES, "invalid_record");
  const ciphertext = decodeBase64Url(
    record.ciphertext,
    undefined,
    "invalid_record"
  );
  const authTag = decodeBase64Url(
    record.authTag,
    AUTH_TAG_BYTES,
    "invalid_record"
  );
  const aad = Buffer.from(JSON.stringify(recordMetadata(record)), "utf8");
  let firstChunk: Buffer | undefined;

  try {
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      encryptionKey.key,
      nonce,
      { authTagLength: AUTH_TAG_BYTES }
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    firstChunk = decipher.update(ciphertext);
    const finalChunk = decipher.final();
    try {
      const plaintext = Buffer.concat([firstChunk, finalChunk]);
      if (
        plaintext.byteLength === 0 ||
        plaintext.byteLength > MAX_CREDENTIAL_BYTES
      ) {
        plaintext.fill(0);
        throw new CredentialStoreError("decryption_failed");
      }
      return plaintext;
    } finally {
      finalChunk.fill(0);
    }
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error;
    throw new CredentialStoreError("decryption_failed");
  } finally {
    firstChunk?.fill(0);
    nonce.fill(0);
    ciphertext.fill(0);
    authTag.fill(0);
    aad.fill(0);
  }
}

/** Selects only the explicitly configured current or previous key. */
function findDecryptionKey(
  record: StoredCredentialEnvelope,
  keys: CredentialEncryptionKeys
): CredentialEncryptionKey {
  if (record.keyVersion === keys.current.keyVersion) return keys.current;
  if (record.keyVersion === keys.previous?.keyVersion) return keys.previous;
  throw new CredentialStoreError("key_unavailable");
}

/** Authenticates an envelope for an idempotent path without retaining plaintext. */
function authenticateRecord(
  record: StoredCredentialEnvelope,
  keys: CredentialEncryptionKeys
): void {
  const plaintext = decryptCredential(record, findDecryptionKey(record, keys));
  plaintext.fill(0);
}

/** Returns metadata in the one canonical AAD property order. */
function recordMetadata(record: StoredCredentialEnvelope) {
  return {
    envelopeVersion: record.envelopeVersion,
    algorithm: record.algorithm,
    ownerId: record.ownerId,
    provider: record.provider,
    credentialId: record.credentialId,
    credentialFormatVersion: record.credentialFormatVersion,
    keyVersion: record.keyVersion,
    operationId: record.operationId,
    recordRevision: record.recordRevision,
  } as const;
}

/** Copies and bounds caller-owned plaintext before any asynchronous operation. */
function copyCredentialPayload(payload: Uint8Array): Buffer {
  if (!(payload instanceof Uint8Array)) {
    throw new CredentialStoreError("invalid_input");
  }
  if (payload.byteLength === 0 || payload.byteLength > MAX_CREDENTIAL_BYTES) {
    throw new CredentialStoreError("invalid_input");
  }
  return Buffer.from(payload);
}

/** Validates and freezes the closed credential identity contract. */
function validateIdentity(value: CredentialIdentity): CredentialIdentity {
  assertPlainExactObject(value, [
    "ownerId",
    "provider",
    "credentialId",
    "credentialFormatVersion",
  ]);
  if (
    !OWNER_ID_PATTERN.test(value.ownerId) ||
    value.provider !== "codex" ||
    !CREDENTIAL_ID_PATTERN.test(value.credentialId) ||
    !Number.isSafeInteger(value.credentialFormatVersion) ||
    value.credentialFormatVersion < 1 ||
    value.credentialFormatVersion > MAX_CREDENTIAL_FORMAT_VERSION
  ) {
    throw new CredentialStoreError("invalid_input");
  }
  return Object.freeze({ ...value });
}

/** Validates the identity plus one bounded idempotency key. */
function validateMutation(value: CredentialMutation): CredentialMutation {
  assertPlainExactObject(value, [
    "ownerId",
    "provider",
    "credentialId",
    "credentialFormatVersion",
    "operationId",
  ]);
  const identity = validateIdentity({
    ownerId: value.ownerId,
    provider: value.provider,
    credentialId: value.credentialId,
    credentialFormatVersion: value.credentialFormatVersion,
  });
  if (!OPERATION_ID_PATTERN.test(value.operationId)) {
    throw new CredentialStoreError("invalid_input");
  }
  return Object.freeze({ ...identity, operationId: value.operationId });
}

/** Validates a persisted envelope before its metadata or ciphertext is trusted. */
function validateStoredRecord(
  value: StoredCredentialEnvelope,
  expected: CredentialIdentity
): StoredCredentialEnvelope {
  try {
    assertPlainExactObject(value, [
      "envelopeVersion",
      "algorithm",
      "ownerId",
      "provider",
      "credentialId",
      "credentialFormatVersion",
      "keyVersion",
      "operationId",
      "recordRevision",
      "nonce",
      "ciphertext",
      "authTag",
    ]);
    if (
      value.envelopeVersion !== ENVELOPE_VERSION ||
      value.algorithm !== ENCRYPTION_ALGORITHM ||
      value.ownerId !== expected.ownerId ||
      value.provider !== expected.provider ||
      value.credentialId !== expected.credentialId ||
      value.credentialFormatVersion !== expected.credentialFormatVersion ||
      !KEY_VERSION_PATTERN.test(value.keyVersion) ||
      !OPERATION_ID_PATTERN.test(value.operationId) ||
      !RECORD_REVISION_PATTERN.test(value.recordRevision) ||
      value.nonce.length !== 16 ||
      value.authTag.length !== 22 ||
      value.ciphertext.length === 0 ||
      value.ciphertext.length > MAX_CIPHERTEXT_LENGTH ||
      !BASE64URL_PATTERN.test(value.nonce) ||
      !BASE64URL_PATTERN.test(value.authTag) ||
      !BASE64URL_PATTERN.test(value.ciphertext)
    ) {
      throw new CredentialStoreError("invalid_record");
    }
    decodeBase64Url(value.nonce, NONCE_BYTES, "invalid_record").fill(0);
    decodeBase64Url(value.authTag, AUTH_TAG_BYTES, "invalid_record").fill(0);
    const ciphertext = decodeBase64Url(
      value.ciphertext,
      undefined,
      "invalid_record"
    );
    if (
      ciphertext.byteLength === 0 ||
      ciphertext.byteLength > MAX_CREDENTIAL_BYTES
    ) {
      ciphertext.fill(0);
      throw new CredentialStoreError("invalid_record");
    }
    ciphertext.fill(0);
    return Object.freeze({ ...value });
  } catch (error) {
    if (
      error instanceof CredentialStoreError &&
      error.code === "invalid_record"
    ) {
      throw error;
    }
    throw new CredentialStoreError("invalid_record");
  }
}

/** Validates the two-key overlap ring without exporting key bytes. */
function validateKeyRing(
  value: CredentialEncryptionKeys
): CredentialEncryptionKeys {
  try {
    assertPlainExactObject(
      value,
      value.previous === undefined ? ["current"] : ["current", "previous"]
    );
    const current = validateEncryptionKey(value.current);
    const previous = value.previous
      ? validateEncryptionKey(value.previous)
      : undefined;
    if (previous?.keyVersion === current.keyVersion) {
      throw new CredentialStoreError("internal_configuration_invalid");
    }
    return Object.freeze({ current, ...(previous ? { previous } : {}) });
  } catch {
    throw new CredentialStoreError("internal_configuration_invalid");
  }
}

/** Accepts one non-exported-by-this-module 256-bit Node secret KeyObject. */
function validateEncryptionKey(
  value: CredentialEncryptionKey
): CredentialEncryptionKey {
  assertPlainExactObject(value, ["keyVersion", "key"]);
  if (
    !KEY_VERSION_PATTERN.test(value.keyVersion) ||
    !(value.key instanceof KeyObject) ||
    value.key.type !== "secret" ||
    value.key.symmetricKeySize !== 32
  ) {
    throw new CredentialStoreError("internal_configuration_invalid");
  }
  return Object.freeze({ ...value });
}

/** Validates injected randomness synchronously without consuming it. */
function validateRandomSource(value: CredentialRandomSource): void {
  try {
    assertPlainExactObject(value, ["nonce", "recordRevision"]);
    if (
      typeof value.nonce !== "function" ||
      typeof value.recordRevision !== "function"
    ) {
      throw new Error("invalid random source");
    }
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

/** Validates the closed create-result union before branching on it. */
function validateCreateResult(
  value: CreateCredentialResult,
  expected: CredentialIdentity
): void {
  try {
    assertPlainExactObject(
      value,
      value.status === "created" ? ["status"] : ["status", "record"]
    );
    if (value.status === "created") return;
    if (value.status === "exists") {
      validateStoredRecord(value.record, expected);
      return;
    }
  } catch {
    // Fall through to one stable persistence error.
  }
  throw new CredentialStoreError("persistence_unavailable");
}

/** Validates the closed CAS-replace result union. */
function validateReplaceResult(
  value: ReplaceCredentialResult,
  expected: CredentialIdentity
): void {
  try {
    const expectedKeys =
      value.status === "conflict" ? ["status", "record"] : ["status"];
    assertPlainExactObject(value, expectedKeys);
    if (value.status === "replaced" || value.status === "missing") return;
    if (value.status === "conflict") {
      validateStoredRecord(value.record, expected);
      return;
    }
  } catch {
    // Fall through to one stable persistence error.
  }
  throw new CredentialStoreError("persistence_unavailable");
}

/** Validates the closed CAS-delete result union. */
function validateDeleteResult(
  value: DeleteCredentialResult,
  expected: CredentialIdentity
): void {
  try {
    const expectedKeys =
      value.status === "conflict" ? ["status", "record"] : ["status"];
    assertPlainExactObject(value, expectedKeys);
    if (value.status === "deleted" || value.status === "missing") return;
    if (value.status === "conflict") {
      validateStoredRecord(value.record, expected);
      return;
    }
  } catch {
    // Fall through to one stable persistence error.
  }
  throw new CredentialStoreError("persistence_unavailable");
}

/** Strictly decodes canonical unpadded base64url with an optional byte length. */
function decodeBase64Url(
  value: string,
  expectedBytes: number | undefined,
  errorCode: "invalid_record"
): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new CredentialStoreError(errorCode);
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)
  ) {
    decoded.fill(0);
    throw new CredentialStoreError(errorCode);
  }
  return decoded;
}

/** Rejects arrays, custom prototypes, symbols, omissions, and extensions. */
function assertPlainExactObject(
  value: unknown,
  expectedKeys: readonly string[]
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new CredentialStoreError("invalid_input");
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new CredentialStoreError("invalid_input");
  }
}

export {
  AUTH_TAG_BYTES,
  type CreateCredentialResult,
  type CredentialEncryptionKey,
  type CredentialEncryptionKeys,
  type CredentialIdentity,
  type CredentialMutation,
  type CredentialProvider,
  type CredentialRandomSource,
  CredentialStoreError,
  type CredentialStoreErrorCode,
  type DeleteCredentialResult,
  type DeleteStoredCredentialResult,
  EncryptedConnectionStore,
  type EncryptedCredentialPersistence,
  ENCRYPTION_ALGORITHM,
  ENVELOPE_VERSION,
  MAX_CREDENTIAL_BYTES,
  NONCE_BYTES,
  type ReplaceCredentialResult,
  type RotateCredentialResult,
  type StoreCredentialResult,
  type StoredCredentialEnvelope,
};
