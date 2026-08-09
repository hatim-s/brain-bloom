import {
  type KeyObject,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";

const ASSERTION_ALGORITHM = "EdDSA";
const ASSERTION_TYPE = "sprig-internal-assertion";
const ASSERTION_VERSION = 1;
const MAX_ASSERTION_LIFETIME_SECONDS = 60;
const MAX_ASSERTION_LENGTH = 8_192;
const MAX_CLAIM_LENGTH = 256;

const GATEWAY_OPERATIONS = [
  "chat",
  "mind-map-generation",
  "node-editing",
] as const;

type GatewayOperation = (typeof GATEWAY_OPERATIONS)[number];

type AssertionErrorCode =
  | "assertion_expired"
  | "assertion_from_future"
  | "assertion_lifetime_invalid"
  | "audience_mismatch"
  | "connection_mismatch"
  | "internal_auth_configuration_invalid"
  | "invalid_assertion"
  | "invalid_signature"
  | "issuer_mismatch"
  | "missing_assertion"
  | "operation_mismatch"
  | "provider_mismatch"
  | "replay_defense_unavailable"
  | "replay_detected"
  | "subject_mismatch"
  | "unsupported_assertion_version";

type InternalAssertionClaims = Readonly<{
  version: typeof ASSERTION_VERSION;
  issuer: string;
  audience: string;
  subject: string;
  connectionId: string;
  provider: "codex";
  operation: GatewayOperation;
  requestId: string;
  iat: number;
  exp: number;
  nonce: string;
  kid: string;
}>;

type AssertionHeader = Readonly<{
  algorithm: typeof ASSERTION_ALGORITHM;
  type: typeof ASSERTION_TYPE;
  version: typeof ASSERTION_VERSION;
  kid: string;
}>;

type Clock = Readonly<{
  nowSeconds: () => number;
}>;

type SigningKey = Readonly<{
  keyId: string;
  privateKey: KeyObject;
}>;

type VerificationKey = Readonly<{
  keyId: string;
  publicKey: KeyObject;
}>;

type VerificationKeys = Readonly<{
  current: VerificationKey;
  previous?: VerificationKey;
}>;

type IssueAssertionInput = Readonly<{
  issuer: string;
  audience: string;
  subject: string;
  connectionId: string;
  operation: GatewayOperation;
  requestId: string;
  nonce: string;
  lifetimeSeconds?: number;
}>;

type ExpectedAssertionContext = Readonly<{
  issuer: string;
  audience: string;
  subject: string;
  connectionId: string;
  provider: "codex";
  operation: GatewayOperation;
}>;

type VerifyAssertionOptions = Readonly<{
  clock: Clock;
  expected: ExpectedAssertionContext;
  replayDefense: ReplayDefense;
  verificationKeys: VerificationKeys;
}>;

type ReplayEntry = Readonly<{
  requestId: string;
  nonce: string;
  expiresAt: number;
}>;

interface ReplayDefense {
  consume(entry: ReplayEntry, nowSeconds: number): void;
}

/** Stable internal-auth failure that callers may map to secret-free responses. */
class InternalAssertionError extends Error {
  readonly code: AssertionErrorCode;

  constructor(code: AssertionErrorCode, message: string) {
    super(message);
    this.name = "InternalAssertionError";
    this.code = code;
  }
}

/**
 * In-memory replay defense for one gateway process.
 *
 * Live entries are never evicted to make room: capacity exhaustion fails closed.
 * A durable/distributed implementation can replace this through ReplayDefense once
 * the persistent host and state topology are approved.
 */
class BoundedReplayCache implements ReplayDefense {
  private readonly entries: ReplayEntry[] = [];
  private unavailableUntil = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new InternalAssertionError(
        "internal_auth_configuration_invalid",
        "Replay capacity must be a positive safe integer"
      );
    }
  }

  /** Atomically rejects a duplicate or retains both identifiers until expiry. */
  consume(entry: ReplayEntry, nowSeconds: number): void {
    if (!Number.isSafeInteger(nowSeconds)) {
      throw new InternalAssertionError(
        "replay_defense_unavailable",
        "Replay defense received an invalid clock value"
      );
    }

    // Expiry is exclusive, matching assertion verification at expiresAt.
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index].expiresAt <= nowSeconds) {
        this.entries.splice(index, 1);
      }
    }

    if (this.unavailableUntil > nowSeconds) {
      // A token rejected while full could otherwise become usable if an older
      // entry expired first. Keep the cache closed through every such token's
      // validity without retaining an unbounded list of identifiers.
      this.unavailableUntil = Math.max(this.unavailableUntil, entry.expiresAt);
      throw new InternalAssertionError(
        "replay_defense_unavailable",
        "Replay defense is recovering from capacity exhaustion"
      );
    }

    if (
      this.entries.some(
        (existing) =>
          existing.requestId === entry.requestId ||
          existing.nonce === entry.nonce
      )
    ) {
      throw new InternalAssertionError(
        "replay_detected",
        "The assertion request identifier or nonce was already consumed"
      );
    }

    if (this.entries.length >= this.capacity) {
      this.unavailableUntil = entry.expiresAt;
      throw new InternalAssertionError(
        "replay_defense_unavailable",
        "Replay defense capacity is exhausted"
      );
    }

    this.entries.push(entry);
  }
}

/** Issues one short-lived, Codex-only internal gateway assertion. */
function issueInternalAssertion(
  input: IssueAssertionInput,
  signingKey: SigningKey,
  clock: Clock
): string {
  assertKeyObject(signingKey.privateKey, "private", "signing key");
  const issuedAt = readClock(clock);
  const lifetimeSeconds =
    input.lifetimeSeconds ?? MAX_ASSERTION_LIFETIME_SECONDS;

  if (
    !Number.isSafeInteger(lifetimeSeconds) ||
    lifetimeSeconds <= 0 ||
    lifetimeSeconds > MAX_ASSERTION_LIFETIME_SECONDS
  ) {
    throw new InternalAssertionError(
      "assertion_lifetime_invalid",
      "Assertion lifetime must be between 1 and 60 seconds"
    );
  }

  const header: AssertionHeader = {
    algorithm: ASSERTION_ALGORITHM,
    type: ASSERTION_TYPE,
    version: ASSERTION_VERSION,
    kid: assertClaimString(signingKey.keyId, "kid"),
  };
  const claims: InternalAssertionClaims = {
    version: ASSERTION_VERSION,
    issuer: assertClaimString(input.issuer, "issuer"),
    audience: assertClaimString(input.audience, "audience"),
    subject: assertClaimString(input.subject, "subject"),
    connectionId: assertClaimString(input.connectionId, "connectionId"),
    provider: "codex",
    operation: input.operation,
    requestId: assertClaimString(input.requestId, "requestId"),
    iat: issuedAt,
    exp: issuedAt + lifetimeSeconds,
    nonce: assertClaimString(input.nonce, "nonce"),
    kid: header.kid,
  };

  if (!GATEWAY_OPERATIONS.includes(input.operation)) {
    throw new InternalAssertionError(
      "invalid_assertion",
      "Assertion operation is not supported"
    );
  }

  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
  const signature = signBytes(
    null,
    Buffer.from(signingInput),
    signingKey.privateKey
  );
  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * Verifies signature, time, and replay before matching request context.
 *
 * Consuming replay identifiers before context checks is intentional: a signed
 * token presented against the wrong owner or operation must not remain usable.
 */
function verifyInternalAssertion(
  token: string | null | undefined,
  options: VerifyAssertionOptions
): InternalAssertionClaims {
  if (!token) {
    throw new InternalAssertionError(
      "missing_assertion",
      "An internal assertion is required"
    );
  }
  if (token.length > MAX_ASSERTION_LENGTH) {
    throw invalidAssertion();
  }

  const segments = token.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw invalidAssertion();
  }

  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  // Only the key identifier is read before authentication; all header semantics
  // are enforced after the signature succeeds.
  const routingKeyId = parseRoutingKeyId(encodedHeader);
  const key = selectVerificationKey(routingKeyId, options.verificationKeys);
  const signature = decodeBase64Url(encodedSignature);
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  if (!verifyBytes(null, Buffer.from(signingInput), key.publicKey, signature)) {
    throw new InternalAssertionError(
      "invalid_signature",
      "Internal assertion signature is invalid"
    );
  }

  const header = parseHeader(encodedHeader);
  const claims = parseClaims(encodedClaims);
  if (claims.kid !== header.kid) {
    throw new InternalAssertionError(
      "invalid_signature",
      "Internal assertion key identifiers do not match"
    );
  }

  const nowSeconds = readClock(options.clock);
  assertTemporalValidity(claims, nowSeconds);

  // State errors are normalized so unavailable custom stores cannot accidentally
  // degrade into accepting a request without replay protection.
  try {
    options.replayDefense.consume(
      {
        requestId: claims.requestId,
        nonce: claims.nonce,
        expiresAt: claims.exp,
      },
      nowSeconds
    );
  } catch (error) {
    if (
      error instanceof InternalAssertionError &&
      (error.code === "replay_detected" ||
        error.code === "replay_defense_unavailable")
    ) {
      throw error;
    }
    throw new InternalAssertionError(
      "replay_defense_unavailable",
      "Replay defense could not enforce single use"
    );
  }

  assertExpectedContext(claims, options.expected);
  return claims;
}

/** Extracts only the bounded key identifier needed to route verification. */
function parseRoutingKeyId(segment: string): string {
  const value = parseJsonObject(segment);
  return assertClaimString(value.kid, "kid");
}

/** Validates exact expected context without revealing any alternate owner state. */
function assertExpectedContext(
  claims: InternalAssertionClaims,
  expected: ExpectedAssertionContext
): void {
  const comparisons: ReadonlyArray<
    readonly [boolean, AssertionErrorCode, string]
  > = [
    [claims.issuer === expected.issuer, "issuer_mismatch", "issuer"],
    [claims.audience === expected.audience, "audience_mismatch", "audience"],
    [claims.subject === expected.subject, "subject_mismatch", "subject"],
    [
      claims.connectionId === expected.connectionId,
      "connection_mismatch",
      "connection",
    ],
    [claims.provider === expected.provider, "provider_mismatch", "provider"],
    [
      claims.operation === expected.operation,
      "operation_mismatch",
      "operation",
    ],
  ];

  for (const [matches, code, field] of comparisons) {
    if (!matches) {
      throw new InternalAssertionError(
        code,
        `Internal assertion ${field} does not match the request context`
      );
    }
  }
}

/** Enforces the strict, no-skew 60-second validity contract. */
function assertTemporalValidity(
  claims: InternalAssertionClaims,
  nowSeconds: number
): void {
  const lifetime = claims.exp - claims.iat;
  if (lifetime <= 0 || lifetime > MAX_ASSERTION_LIFETIME_SECONDS) {
    throw new InternalAssertionError(
      "assertion_lifetime_invalid",
      "Internal assertion lifetime is invalid"
    );
  }
  if (claims.iat > nowSeconds) {
    throw new InternalAssertionError(
      "assertion_from_future",
      "Internal assertion was issued in the future"
    );
  }
  if (claims.exp <= nowSeconds) {
    throw new InternalAssertionError(
      "assertion_expired",
      "Internal assertion has expired"
    );
  }
}

/** Chooses only the explicit current or previous key without widening time. */
function selectVerificationKey(
  keyId: string,
  keys: VerificationKeys
): VerificationKey {
  assertKeyObject(keys.current.publicKey, "public", "current verification key");
  if (keys.previous) {
    assertKeyObject(
      keys.previous.publicKey,
      "public",
      "previous verification key"
    );
    if (keys.previous.keyId === keys.current.keyId) {
      throw new InternalAssertionError(
        "internal_auth_configuration_invalid",
        "Current and previous verification key identifiers must differ"
      );
    }
  }

  const selected =
    keys.current.keyId === keyId
      ? keys.current
      : keys.previous?.keyId === keyId
        ? keys.previous
        : undefined;
  if (!selected) {
    // Treat an unrecognized key as a signature failure to avoid a key oracle.
    throw new InternalAssertionError(
      "invalid_signature",
      "Internal assertion signature is invalid"
    );
  }
  return selected;
}

/** Parses and strictly validates the signed assertion header. */
function parseHeader(segment: string): AssertionHeader {
  const value = parseJsonObject(segment);
  assertExactKeys(value, ["algorithm", "kid", "type", "version"]);

  if (value.version !== ASSERTION_VERSION) {
    throw new InternalAssertionError(
      "unsupported_assertion_version",
      "Internal assertion version is unsupported"
    );
  }
  if (
    value.algorithm !== ASSERTION_ALGORITHM ||
    value.type !== ASSERTION_TYPE
  ) {
    throw invalidAssertion();
  }

  return {
    algorithm: ASSERTION_ALGORITHM,
    type: ASSERTION_TYPE,
    version: ASSERTION_VERSION,
    kid: assertClaimString(value.kid, "kid"),
  };
}

/** Parses the exact v1 claim set after signature verification. */
function parseClaims(segment: string): InternalAssertionClaims {
  const value = parseJsonObject(segment);
  assertExactKeys(value, [
    "audience",
    "connectionId",
    "exp",
    "iat",
    "issuer",
    "kid",
    "nonce",
    "operation",
    "provider",
    "requestId",
    "subject",
    "version",
  ]);

  if (value.version !== ASSERTION_VERSION) {
    throw new InternalAssertionError(
      "unsupported_assertion_version",
      "Internal assertion version is unsupported"
    );
  }
  if (!Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp)) {
    throw invalidAssertion();
  }

  return {
    version: ASSERTION_VERSION,
    issuer: assertClaimString(value.issuer, "issuer"),
    audience: assertClaimString(value.audience, "audience"),
    subject: assertClaimString(value.subject, "subject"),
    connectionId: assertClaimString(value.connectionId, "connectionId"),
    // Provider and operation remain strings until expected-context matching so
    // a correctly signed mismatch consumes its replay identifiers first.
    provider: assertClaimString(value.provider, "provider") as "codex",
    operation: assertClaimString(
      value.operation,
      "operation"
    ) as GatewayOperation,
    requestId: assertClaimString(value.requestId, "requestId"),
    iat: value.iat as number,
    exp: value.exp as number,
    nonce: assertClaimString(value.nonce, "nonce"),
    kid: assertClaimString(value.kid, "kid"),
  };
}

/** Reads a second-resolution injected clock and refuses ambiguous values. */
function readClock(clock: Clock): number {
  const nowSeconds = clock.nowSeconds();
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new InternalAssertionError(
      "internal_auth_configuration_invalid",
      "Clock must return a non-negative integer epoch second"
    );
  }
  return nowSeconds;
}

/** Restricts keys to Ed25519 and to their required signing/verification role. */
function assertKeyObject(
  key: KeyObject,
  expectedType: "private" | "public",
  label: string
): void {
  if (key.type !== expectedType || key.asymmetricKeyType !== "ed25519") {
    throw new InternalAssertionError(
      "internal_auth_configuration_invalid",
      `${label} must be an Ed25519 ${expectedType} key`
    );
  }
}

/** Validates bounded, non-empty string claims. */
function assertClaimString(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CLAIM_LENGTH
  ) {
    throw new InternalAssertionError(
      "invalid_assertion",
      `Internal assertion ${field} is invalid`
    );
  }
  return value;
}

/** Encodes deterministic JSON as an unpadded base64url segment. */
function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Decodes only canonical, unpadded base64url text. */
function decodeBase64Url(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw invalidAssertion();
  }
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.toString("base64url") !== segment) {
    throw invalidAssertion();
  }
  return decoded;
}

/** Decodes a base64url JSON object without accepting arrays or null. */
function parseJsonObject(segment: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(
      decodeBase64Url(segment).toString("utf8")
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw invalidAssertion();
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof InternalAssertionError) {
      throw error;
    }
    throw invalidAssertion();
  }
}

/** Rejects omitted and extension fields so v1 has one unambiguous contract. */
function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw invalidAssertion();
  }
}

/** Creates a fresh generic invalid-assertion error. */
function invalidAssertion(): InternalAssertionError {
  return new InternalAssertionError(
    "invalid_assertion",
    "Internal assertion is invalid"
  );
}

export {
  ASSERTION_VERSION,
  type AssertionErrorCode,
  BoundedReplayCache,
  type Clock,
  type ExpectedAssertionContext,
  GATEWAY_OPERATIONS,
  type GatewayOperation,
  type InternalAssertionClaims,
  InternalAssertionError,
  type IssueAssertionInput,
  issueInternalAssertion,
  MAX_ASSERTION_LIFETIME_SECONDS,
  type ReplayDefense,
  type ReplayEntry,
  type SigningKey,
  type VerificationKey,
  type VerificationKeys,
  type VerifyAssertionOptions,
  verifyInternalAssertion,
};
