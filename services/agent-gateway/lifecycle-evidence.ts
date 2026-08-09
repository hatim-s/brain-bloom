import {
  type KeyObject,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";

import type { ControlPlaneOperationContext } from "./control-plane.ts";

const LIFECYCLE_EVIDENCE_ALGORITHM = "EdDSA";
const LIFECYCLE_EVIDENCE_TYPE = "sprig-lifecycle-evidence";
const LIFECYCLE_EVIDENCE_VERSION = 1;
const MAX_LIFECYCLE_EVIDENCE_LIFETIME_SECONDS = 60;
const MAX_LIFECYCLE_EVIDENCE_LENGTH = 8_192;
const DEFAULT_LIFECYCLE_REPLAY_TIMEOUT_MS = 1_000;
const MAX_LIFECYCLE_REPLAY_TIMEOUT_MS = 10_000;
const LIFECYCLE_EVIDENCE_ISSUER = "sprig-agent-gateway";
const LIFECYCLE_EVIDENCE_AUDIENCE = "sprig-trusted-server";

const UUID_V4_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CLERK_SUBJECT_PATTERN = /^user_[A-Za-z0-9]{16,64}$/;
const CONNECTION_ID_PATTERN = new RegExp(`^connection_v1_${UUID_V4_PATTERN}$`);
const REQUEST_ID_PATTERN = new RegExp(`^request_v1_${UUID_V4_PATTERN}$`);
const EVIDENCE_ID_PATTERN = new RegExp(`^evidence_v1_${UUID_V4_PATTERN}$`);
const NONCE_PATTERN = new RegExp(`^nonce_v1_${UUID_V4_PATTERN}$`);
const GATEWAY_CREDENTIAL_ID_PATTERN = new RegExp(
  `^gwcred_v1_${UUID_V4_PATTERN}$`
);
const KEY_ID_PATTERN = /^lifecycle-v1-[0-9a-f]{8}$/;

const LIFECYCLE_TRANSITIONS = [
  "pending_to_connected",
  "pending_to_error",
  "pending_to_expired",
  "pending_to_revoking",
  "connected_to_error",
  "connected_to_expired",
  "connected_to_revoking",
  "error_to_revoking",
  "expired_to_revoking",
  "revoking_to_revoked",
  "revoked_to_deleted",
] as const;

const LIFECYCLE_ERROR_CODES = [
  "account_type_unsupported",
  "credential_expired",
  "credential_invalid",
  "credential_unavailable",
  "provider_denied",
  "provider_unavailable",
] as const;

const LIFECYCLE_PLAN_LABELS = [
  "ChatGPT",
  "ChatGPT Plus",
  "ChatGPT Pro",
  "ChatGPT Business",
  "ChatGPT Enterprise",
  "ChatGPT Edu",
] as const;

type LifecycleTransition = (typeof LIFECYCLE_TRANSITIONS)[number];
type LifecycleErrorCode = (typeof LIFECYCLE_ERROR_CODES)[number];
type LifecyclePlanLabel = (typeof LIFECYCLE_PLAN_LABELS)[number];

type LifecycleMetadataPolicy =
  | "establish_connection"
  | "record_error"
  | "record_expiry"
  | "empty_terminal";

const LIFECYCLE_TRANSITION_METADATA_POLICIES = {
  pending_to_connected: "establish_connection",
  pending_to_error: "record_error",
  pending_to_expired: "record_expiry",
  pending_to_revoking: "empty_terminal",
  connected_to_error: "record_error",
  connected_to_expired: "record_expiry",
  connected_to_revoking: "empty_terminal",
  error_to_revoking: "empty_terminal",
  expired_to_revoking: "empty_terminal",
  revoking_to_revoked: "empty_terminal",
  revoked_to_deleted: "empty_terminal",
} as const satisfies Record<LifecycleTransition, LifecycleMetadataPolicy>;

type LifecycleEvidenceErrorCode =
  | "audience_mismatch"
  | "connection_mismatch"
  | "credential_revision_mismatch"
  | "evidence_expired"
  | "evidence_from_future"
  | "evidence_lifetime_invalid"
  | "internal_evidence_configuration_invalid"
  | "invalid_evidence"
  | "invalid_signature"
  | "issuer_mismatch"
  | "missing_evidence"
  | "noncanonical_evidence"
  | "provider_mismatch"
  | "replay_defense_unavailable"
  | "replay_detected"
  | "request_id_mismatch"
  | "subject_mismatch"
  | "transition_mismatch"
  | "unsupported_evidence_version";

type LifecycleEvidenceAccount = Readonly<{
  type: "chatgpt";
  present: true;
}>;

type LifecycleEvidenceMetadata = Readonly<{
  gatewayCredentialId: string | null;
  account: LifecycleEvidenceAccount | null;
  planLabel: LifecyclePlanLabel | null;
  errorCode: LifecycleErrorCode | null;
}>;

type LifecycleEvidenceClaims = Readonly<{
  version: typeof LIFECYCLE_EVIDENCE_VERSION;
  issuer: string;
  audience: string;
  subject: string;
  connectionId: string;
  provider: "codex";
  requestId: string;
  evidenceId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  transition: LifecycleTransition;
  credentialRevision: number;
  metadata: LifecycleEvidenceMetadata;
  kid: string;
}>;

type LifecycleEvidenceHeader = Readonly<{
  algorithm: typeof LIFECYCLE_EVIDENCE_ALGORITHM;
  type: typeof LIFECYCLE_EVIDENCE_TYPE;
  version: typeof LIFECYCLE_EVIDENCE_VERSION;
  kid: string;
}>;

type LifecycleEvidenceClock = Readonly<{
  nowSeconds: () => number;
}>;

type LifecycleMonotonicClock = Readonly<{
  nowMilliseconds: () => number;
}>;

type LifecycleEvidenceSigningKey = Readonly<{
  keyId: string;
  privateKey: KeyObject;
}>;

type LifecycleEvidenceVerificationKey = Readonly<{
  keyId: string;
  publicKey: KeyObject;
}>;

type LifecycleEvidenceVerificationKeys = Readonly<{
  current: LifecycleEvidenceVerificationKey;
  previous?: LifecycleEvidenceVerificationKey;
}>;

/**
 * A closed server-side decision accepted by the gateway signer.
 *
 * Callers must derive every field from authenticated server state. Runtime
 * exact-key validation prevents browser-shaped extensions from smuggling raw
 * provider output, tokens, commands, paths, or environment values into evidence.
 */
type ServerLifecycleDecision = Readonly<{
  issuer: string;
  audience: string;
  subject: string;
  connectionId: string;
  requestId: string;
  evidenceId: string;
  nonce: string;
  transition: LifecycleTransition;
  credentialRevision: number;
  metadata: LifecycleEvidenceMetadata;
  lifetimeSeconds?: number;
}>;

type ExpectedLifecycleEvidenceContext = Readonly<{
  issuer: string;
  audience: string;
  subject: string;
  connectionId: string;
  provider: "codex";
  requestId: string;
  transition: LifecycleTransition;
  credentialRevision: number;
}>;

type LifecycleReplayEntry = Readonly<{
  evidenceId: string;
  nonce: string;
  requestId: string;
  expiresAt: number;
}>;

interface LifecycleEvidenceReplayDefense {
  /** Atomically consumes all three identifiers through the entry expiry. */
  consume(
    entry: LifecycleReplayEntry,
    context?: ControlPlaneOperationContext
  ): void | Promise<void>;
}

type VerifyLifecycleEvidenceOptions = Readonly<{
  clock: LifecycleEvidenceClock;
  expected: ExpectedLifecycleEvidenceContext;
  replayDefense: LifecycleEvidenceReplayDefense;
  verificationKeys: LifecycleEvidenceVerificationKeys;
  monotonicClock: LifecycleMonotonicClock;
  replayDefenseTimeoutMs?: number;
  signal?: AbortSignal;
}>;

type LifecycleReplayDefenseErrorCode =
  | "replay_defense_unavailable"
  | "replay_detected";

type ReplayConsumeOutcome =
  | Readonly<{ status: "fulfilled"; value: unknown }>
  | Readonly<{ status: "rejected"; error: unknown }>
  | Readonly<{ status: "aborted" }>
  | Readonly<{ status: "timed_out" }>;

const SKIPPED_REPLAY_CONSUME = Symbol("skipped replay consume");

/** Stable evidence failure whose message contains no signed or provider data. */
class LifecycleEvidenceError extends Error {
  readonly code: LifecycleEvidenceErrorCode;

  constructor(code: LifecycleEvidenceErrorCode, message: string) {
    super(message);
    this.name = "LifecycleEvidenceError";
    this.code = code;
  }
}

/** Explicit replay-store rejection normalized by the verifier. */
class LifecycleReplayDefenseError extends Error {
  readonly code: LifecycleReplayDefenseErrorCode;

  constructor(code: LifecycleReplayDefenseErrorCode) {
    super("Lifecycle evidence replay defense rejected the entry");
    this.name = "LifecycleReplayDefenseError";
    this.code = code;
  }
}

/**
 * Issues one short-lived, Codex-only lifecycle evidence envelope.
 *
 * The signer accepts only the closed transition and metadata vocabulary. It
 * never accepts a provider, account token, raw response, command, path, or
 * environment field.
 */
function issueLifecycleEvidence(
  rawDecision: ServerLifecycleDecision,
  signingKey: LifecycleEvidenceSigningKey,
  clock: LifecycleEvidenceClock
): string {
  assertKeyObject(signingKey.privateKey, "private", "signing key");
  const decision = parseServerDecision(rawDecision);
  const issuedAt = readClock(clock);
  const lifetimeSeconds =
    decision.lifetimeSeconds ?? MAX_LIFECYCLE_EVIDENCE_LIFETIME_SECONDS;
  if (
    !Number.isSafeInteger(lifetimeSeconds) ||
    lifetimeSeconds <= 0 ||
    lifetimeSeconds > MAX_LIFECYCLE_EVIDENCE_LIFETIME_SECONDS
  ) {
    throw new LifecycleEvidenceError(
      "evidence_lifetime_invalid",
      "Lifecycle evidence lifetime is invalid"
    );
  }

  const header: LifecycleEvidenceHeader = {
    algorithm: LIFECYCLE_EVIDENCE_ALGORITHM,
    type: LIFECYCLE_EVIDENCE_TYPE,
    version: LIFECYCLE_EVIDENCE_VERSION,
    kid: assertConfiguredKeyId(signingKey.keyId),
  };
  const claims: LifecycleEvidenceClaims = {
    version: LIFECYCLE_EVIDENCE_VERSION,
    issuer: decision.issuer,
    audience: decision.audience,
    subject: decision.subject,
    connectionId: decision.connectionId,
    provider: "codex",
    requestId: decision.requestId,
    evidenceId: decision.evidenceId,
    nonce: decision.nonce,
    issuedAt,
    expiresAt: issuedAt + lifetimeSeconds,
    transition: decision.transition,
    credentialRevision: decision.credentialRevision,
    metadata: decision.metadata,
    kid: header.kid,
  };

  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
  const signature = signBytes(
    null,
    Buffer.from(signingInput),
    signingKey.privateKey
  );
  const evidence = `${signingInput}.${signature.toString("base64url")}`;
  if (evidence.length > MAX_LIFECYCLE_EVIDENCE_LENGTH) {
    throw invalidEvidence();
  }
  return evidence;
}

/**
 * Authenticates, validates, consumes, and context-binds lifecycle evidence.
 *
 * Replay identifiers are consumed after authentic signature and time/schema
 * validation but before every expected-context comparison. A signed token used
 * against the wrong owner, connection, request, transition, or revision cannot
 * subsequently be replayed against its intended context.
 */
async function verifyLifecycleEvidence(
  token: string | null | undefined,
  options: VerifyLifecycleEvidenceOptions
): Promise<LifecycleEvidenceClaims> {
  const authenticated = authenticateEvidence(token, options.verificationKeys);
  const header = parseHeader(authenticated.encodedHeader);
  const claims = parseClaims(authenticated.encodedClaims);
  assertCanonicalSegment(authenticated.encodedHeader, header);
  assertCanonicalSegment(authenticated.encodedClaims, claims);
  if (
    header.kid !== claims.kid ||
    !authenticated.authenticatedKeyIds.includes(header.kid)
  ) {
    throw new LifecycleEvidenceError(
      "invalid_signature",
      "Lifecycle evidence key identifiers do not match"
    );
  }

  const nowSeconds = readClock(options.clock);
  assertTemporalValidity(claims, nowSeconds);
  const replayDefenseTimeoutMs =
    options.replayDefenseTimeoutMs ?? DEFAULT_LIFECYCLE_REPLAY_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(replayDefenseTimeoutMs) ||
    replayDefenseTimeoutMs <= 0 ||
    replayDefenseTimeoutMs > MAX_LIFECYCLE_REPLAY_TIMEOUT_MS
  ) {
    throw configurationError();
  }

  const replayStartedAtMilliseconds = readMonotonicClock(
    options.monotonicClock
  );
  const replayOutcome = await awaitReplayConsume(
    (context) =>
      options.replayDefense.consume(
        {
          evidenceId: claims.evidenceId,
          nonce: claims.nonce,
          requestId: claims.requestId,
          expiresAt: claims.expiresAt,
        },
        context
      ),
    replayDefenseTimeoutMs,
    options.monotonicClock,
    replayStartedAtMilliseconds,
    options.signal
  );
  if (
    replayOutcome.status === "aborted" ||
    replayOutcome.status === "timed_out"
  ) {
    throw replayError("replay_defense_unavailable");
  }
  if (replayOutcome.status === "rejected") {
    const code =
      replayOutcome.error instanceof LifecycleReplayDefenseError
        ? replayOutcome.error.code
        : "replay_defense_unavailable";
    throw replayError(code);
  }
  // A consume method has no success payload. Treating any returned value as
  // success could make an ambiguous custom-store API fail open.
  if (replayOutcome.value !== undefined) {
    throw replayError("replay_defense_unavailable");
  }

  assertExpectedContext(claims, options.expected);
  return claims;
}

/**
 * Awaits one atomic replay consume behind an authoritative monotonic deadline.
 *
 * The clock is checked immediately before invocation and after both synchronous
 * and asynchronous settlement. Therefore a blocking consume cannot win merely
 * because its fulfillment microtask runs before a delayed timer callback.
 */
function awaitReplayConsume(
  operation: (
    context: ControlPlaneOperationContext
  ) => unknown | PromiseLike<unknown>,
  timeoutMs: number,
  monotonicClock: LifecycleMonotonicClock,
  startedAtMilliseconds: number,
  requestSignal?: AbortSignal
): Promise<ReplayConsumeOutcome> {
  const operationController = new AbortController();
  const deadlineAtMilliseconds = startedAtMilliseconds + timeoutMs;

  return new Promise<ReplayConsumeOutcome>((resolve) => {
    let settled = false;
    const finish = (
      outcome: ReplayConsumeOutcome,
      cancelOperation: boolean
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", handleRequestAbort);
      if (cancelOperation) operationController.abort();
      resolve(outcome);
    };
    const handleRequestAbort = (): void => {
      finish({ status: "aborted" }, true);
    };
    const readSettlementTime = (): number | null => {
      try {
        const nowMilliseconds = readMonotonicClock(monotonicClock);
        return nowMilliseconds < startedAtMilliseconds ? null : nowMilliseconds;
      } catch {
        return null;
      }
    };

    const timeout = setTimeout(() => {
      finish({ status: "timed_out" }, true);
    }, timeoutMs);
    requestSignal?.addEventListener("abort", handleRequestAbort, {
      once: true,
    });
    if (requestSignal?.aborted) handleRequestAbort();

    Promise.resolve()
      .then(() => {
        if (settled) return SKIPPED_REPLAY_CONSUME;
        const beforeInvocation = readSettlementTime();
        if (
          beforeInvocation === null ||
          beforeInvocation >= deadlineAtMilliseconds
        ) {
          finish({ status: "timed_out" }, true);
          return SKIPPED_REPLAY_CONSUME;
        }
        return operation(
          Object.freeze({
            signal: operationController.signal,
            deadlineAtMilliseconds,
          })
        );
      })
      .then(
        (value) => {
          if (value === SKIPPED_REPLAY_CONSUME) return;
          const settledAt = readSettlementTime();
          if (settledAt === null || settledAt >= deadlineAtMilliseconds) {
            finish({ status: "timed_out" }, true);
            return;
          }
          finish({ status: "fulfilled", value }, false);
        },
        (error: unknown) => {
          // Keep this handler attached after timeout/abort so late rejection is
          // observed, but let an exceeded deadline dominate a store error.
          const settledAt = readSettlementTime();
          if (settledAt === null || settledAt >= deadlineAtMilliseconds) {
            finish({ status: "timed_out" }, true);
            return;
          }
          finish({ status: "rejected", error }, false);
        }
      );
  });
}

type AuthenticatedEvidence = Readonly<{
  encodedHeader: string;
  encodedClaims: string;
  authenticatedKeyIds: readonly string[];
}>;

/** Authenticates raw bytes against every configured rotation key before parsing. */
function authenticateEvidence(
  token: string | null | undefined,
  keys: LifecycleEvidenceVerificationKeys
): AuthenticatedEvidence {
  if (!token) {
    throw new LifecycleEvidenceError(
      "missing_evidence",
      "Lifecycle evidence is required"
    );
  }
  if (token.length > MAX_LIFECYCLE_EVIDENCE_LENGTH) {
    throw invalidEvidence();
  }
  const segments = token.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw invalidEvidence();
  }

  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  const signature = decodeCanonicalBase64Url(encodedSignature);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const authenticatedKeyIds = authenticateSignature(
    signingInput,
    signature,
    keys
  );
  return {
    encodedHeader,
    encodedClaims,
    authenticatedKeyIds,
  };
}

/** Authenticates against only an explicit current key and optional previous key. */
function authenticateSignature(
  signingInput: string,
  signature: Buffer,
  keys: LifecycleEvidenceVerificationKeys
): readonly string[] {
  assertKeyObject(keys.current.publicKey, "public", "current verification key");
  assertConfiguredKeyId(keys.current.keyId);
  if (keys.previous) {
    assertKeyObject(
      keys.previous.publicKey,
      "public",
      "previous verification key"
    );
    assertConfiguredKeyId(keys.previous.keyId);
    if (keys.current.keyId === keys.previous.keyId) {
      throw configurationError();
    }
  }
  const candidates = keys.previous
    ? [keys.current, keys.previous]
    : [keys.current];
  const authenticatedKeyIds = candidates
    .filter((candidate) =>
      verifyBytes(
        null,
        Buffer.from(signingInput),
        candidate.publicKey,
        signature
      )
    )
    .map((candidate) => candidate.keyId);
  if (authenticatedKeyIds.length === 0) {
    throw new LifecycleEvidenceError(
      "invalid_signature",
      "Lifecycle evidence signature is invalid"
    );
  }
  return authenticatedKeyIds;
}

/** Parses the fixed v1 protected header. */
function parseHeader(segment: string): LifecycleEvidenceHeader {
  const value = parseJsonObject(segment);
  assertExactKeys(value, ["algorithm", "kid", "type", "version"]);
  if (value.version !== LIFECYCLE_EVIDENCE_VERSION) {
    throw new LifecycleEvidenceError(
      "unsupported_evidence_version",
      "Lifecycle evidence version is unsupported"
    );
  }
  if (
    value.algorithm !== LIFECYCLE_EVIDENCE_ALGORITHM ||
    value.type !== LIFECYCLE_EVIDENCE_TYPE
  ) {
    throw invalidEvidence();
  }
  return Object.freeze({
    algorithm: LIFECYCLE_EVIDENCE_ALGORITHM,
    type: LIFECYCLE_EVIDENCE_TYPE,
    version: LIFECYCLE_EVIDENCE_VERSION,
    kid: assertKeyIdClaim(value.kid),
  });
}

/** Parses the exact v1 claim and safe-metadata schema after authentication. */
function parseClaims(segment: string): LifecycleEvidenceClaims {
  const value = parseJsonObject(segment);
  assertExactKeys(value, [
    "audience",
    "connectionId",
    "credentialRevision",
    "evidenceId",
    "expiresAt",
    "issuedAt",
    "issuer",
    "kid",
    "metadata",
    "nonce",
    "provider",
    "requestId",
    "subject",
    "transition",
    "version",
  ]);
  if (value.version !== LIFECYCLE_EVIDENCE_VERSION) {
    throw new LifecycleEvidenceError(
      "unsupported_evidence_version",
      "Lifecycle evidence version is unsupported"
    );
  }
  if (
    !Number.isSafeInteger(value.issuedAt) ||
    !Number.isSafeInteger(value.expiresAt) ||
    !Number.isSafeInteger(value.credentialRevision) ||
    (value.credentialRevision as number) <= 0
  ) {
    throw invalidEvidence();
  }
  const transition = assertTransition(value.transition);
  const evidenceId = assertOpaqueId(value.evidenceId, EVIDENCE_ID_PATTERN);
  const nonce = assertOpaqueId(value.nonce, NONCE_PATTERN);
  if (evidenceId === nonce) throw invalidEvidence();
  const metadata = parseMetadata(value.metadata, transition);
  return Object.freeze({
    version: LIFECYCLE_EVIDENCE_VERSION,
    issuer: assertIssuer(value.issuer),
    audience: assertAudience(value.audience),
    subject: assertClerkSubject(value.subject),
    connectionId: assertOpaqueId(value.connectionId, CONNECTION_ID_PATTERN),
    // A known alternate provider remains parseable so its signed evidence is
    // consumed before the exact Codex expected-context comparison.
    provider: assertProviderClaim(value.provider),
    requestId: assertOpaqueId(value.requestId, REQUEST_ID_PATTERN),
    evidenceId,
    nonce,
    issuedAt: value.issuedAt as number,
    expiresAt: value.expiresAt as number,
    transition,
    credentialRevision: value.credentialRevision as number,
    metadata,
    kid: assertKeyIdClaim(value.kid),
  });
}

/** Copies and validates a closed signer decision without invoking accessors. */
function parseServerDecision(
  rawDecision: ServerLifecycleDecision
): ServerLifecycleDecision {
  const value = readPlainDataObject(rawDecision);
  const requiredKeys = [
    "audience",
    "connectionId",
    "credentialRevision",
    "evidenceId",
    "issuer",
    "metadata",
    "nonce",
    "requestId",
    "subject",
    "transition",
  ];
  const allowedKeys = [...requiredKeys, "lifetimeSeconds"];
  assertRequiredAndAllowedKeys(value, requiredKeys, allowedKeys);
  if (
    !Number.isSafeInteger(value.credentialRevision) ||
    (value.credentialRevision as number) <= 0
  ) {
    throw invalidEvidence();
  }
  if (
    value.lifetimeSeconds !== undefined &&
    !Number.isSafeInteger(value.lifetimeSeconds)
  ) {
    throw invalidEvidence();
  }
  const transition = assertTransition(value.transition);
  const evidenceId = assertOpaqueId(value.evidenceId, EVIDENCE_ID_PATTERN);
  const nonce = assertOpaqueId(value.nonce, NONCE_PATTERN);
  if (evidenceId === nonce) throw invalidEvidence();
  return Object.freeze({
    issuer: assertIssuer(value.issuer),
    audience: assertAudience(value.audience),
    subject: assertClerkSubject(value.subject),
    connectionId: assertOpaqueId(value.connectionId, CONNECTION_ID_PATTERN),
    requestId: assertOpaqueId(value.requestId, REQUEST_ID_PATTERN),
    evidenceId,
    nonce,
    transition,
    credentialRevision: value.credentialRevision as number,
    metadata: parseMetadata(value.metadata, transition),
    lifetimeSeconds: value.lifetimeSeconds as number | undefined,
  });
}

/** Validates the only safe gateway metadata allowed for a transition. */
function parseMetadata(
  rawMetadata: unknown,
  transition: LifecycleTransition
): LifecycleEvidenceMetadata {
  const value = readPlainDataObject(rawMetadata);
  assertExactKeys(value, [
    "account",
    "errorCode",
    "gatewayCredentialId",
    "planLabel",
  ]);
  const gatewayCredentialId = assertNullableGatewayCredentialId(
    value.gatewayCredentialId
  );
  const planLabel = assertNullablePlanLabel(value.planLabel);
  const errorCode = assertNullableErrorCode(value.errorCode);
  const account = parseNullableAccount(value.account);
  const metadata = { gatewayCredentialId, account, planLabel, errorCode };

  const policy = LIFECYCLE_TRANSITION_METADATA_POLICIES[transition];
  if (
    policy === "establish_connection" &&
    (gatewayCredentialId === null || account === null || errorCode !== null)
  ) {
    throw invalidEvidence();
  }
  if (
    policy === "record_error" &&
    (gatewayCredentialId !== null ||
      account !== null ||
      planLabel !== null ||
      errorCode === null ||
      errorCode === "credential_expired")
  ) {
    throw invalidEvidence();
  }
  if (
    policy === "record_expiry" &&
    (gatewayCredentialId !== null ||
      account !== null ||
      planLabel !== null ||
      errorCode !== "credential_expired")
  ) {
    throw invalidEvidence();
  }
  if (
    policy === "empty_terminal" &&
    (gatewayCredentialId !== null ||
      account !== null ||
      planLabel !== null ||
      errorCode !== null)
  ) {
    throw invalidEvidence();
  }
  return Object.freeze(metadata);
}

/** Accepts only the subscription account projection; API-key accounts fail closed. */
function parseNullableAccount(value: unknown): LifecycleEvidenceAccount | null {
  if (value === null) return null;
  const account = readPlainDataObject(value);
  assertExactKeys(account, ["present", "type"]);
  if (account.type !== "chatgpt" || account.present !== true) {
    throw invalidEvidence();
  }
  return Object.freeze({ type: "chatgpt", present: true });
}

/** Consumes every context mismatch only after replay state is committed. */
function assertExpectedContext(
  claims: LifecycleEvidenceClaims,
  expected: ExpectedLifecycleEvidenceContext
): void {
  const comparisons: ReadonlyArray<
    readonly [boolean, LifecycleEvidenceErrorCode]
  > = [
    [claims.issuer === expected.issuer, "issuer_mismatch"],
    [claims.audience === expected.audience, "audience_mismatch"],
    [claims.subject === expected.subject, "subject_mismatch"],
    [claims.connectionId === expected.connectionId, "connection_mismatch"],
    [claims.provider === expected.provider, "provider_mismatch"],
    [claims.requestId === expected.requestId, "request_id_mismatch"],
    [claims.transition === expected.transition, "transition_mismatch"],
    [
      claims.credentialRevision === expected.credentialRevision,
      "credential_revision_mismatch",
    ],
  ];
  for (const [matches, code] of comparisons) {
    if (!matches) {
      throw new LifecycleEvidenceError(
        code,
        "Lifecycle evidence does not match the expected server context"
      );
    }
  }
}

/** Enforces a strict no-skew validity window of at most 60 seconds. */
function assertTemporalValidity(
  claims: LifecycleEvidenceClaims,
  nowSeconds: number
): void {
  const lifetime = claims.expiresAt - claims.issuedAt;
  if (lifetime <= 0 || lifetime > MAX_LIFECYCLE_EVIDENCE_LIFETIME_SECONDS) {
    throw new LifecycleEvidenceError(
      "evidence_lifetime_invalid",
      "Lifecycle evidence lifetime is invalid"
    );
  }
  if (claims.issuedAt > nowSeconds) {
    throw new LifecycleEvidenceError(
      "evidence_from_future",
      "Lifecycle evidence was issued in the future"
    );
  }
  if (claims.expiresAt <= nowSeconds) {
    throw new LifecycleEvidenceError(
      "evidence_expired",
      "Lifecycle evidence has expired"
    );
  }
}

/** Reads an injected integer epoch clock. */
function readClock(clock: LifecycleEvidenceClock): number {
  const nowSeconds = clock.nowSeconds();
  if (
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0 ||
    nowSeconds >
      Number.MAX_SAFE_INTEGER - MAX_LIFECYCLE_EVIDENCE_LIFETIME_SECONDS
  ) {
    throw configurationError();
  }
  return nowSeconds;
}

/** Reads a finite injected monotonic clock without accepting unsafe deadlines. */
function readMonotonicClock(clock: LifecycleMonotonicClock): number {
  const nowMilliseconds = clock.nowMilliseconds();
  if (
    !Number.isFinite(nowMilliseconds) ||
    nowMilliseconds < 0 ||
    nowMilliseconds > Number.MAX_SAFE_INTEGER - MAX_LIFECYCLE_REPLAY_TIMEOUT_MS
  ) {
    throw configurationError();
  }
  return nowMilliseconds;
}

/** Restricts keys to Ed25519 and their required role. */
function assertKeyObject(
  key: KeyObject,
  expectedType: "private" | "public",
  label: string
): void {
  if (key.type !== expectedType || key.asymmetricKeyType !== "ed25519") {
    throw new LifecycleEvidenceError(
      "internal_evidence_configuration_invalid",
      `${label} must be an Ed25519 ${expectedType} key`
    );
  }
}

/** Validates an exact, bounded lifecycle transition. */
function assertTransition(value: unknown): LifecycleTransition {
  if (
    typeof value !== "string" ||
    !LIFECYCLE_TRANSITIONS.includes(value as LifecycleTransition)
  ) {
    throw invalidEvidence();
  }
  return value as LifecycleTransition;
}

/** Validates a stable, bounded lifecycle error code. */
function assertNullableErrorCode(value: unknown): LifecycleErrorCode | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !LIFECYCLE_ERROR_CODES.includes(value as LifecycleErrorCode)
  ) {
    throw invalidEvidence();
  }
  return value as LifecycleErrorCode;
}

/** Validates the sole protocol issuer. */
function assertIssuer(value: unknown): string {
  if (value !== LIFECYCLE_EVIDENCE_ISSUER) throw invalidEvidence();
  return value;
}

/** Validates the sole trusted reconciliation audience. */
function assertAudience(value: unknown): string {
  if (value !== LIFECYCLE_EVIDENCE_AUDIENCE) throw invalidEvidence();
  return value;
}

/** Validates a Clerk user subject without accepting arbitrary safe-looking text. */
function assertClerkSubject(value: unknown): string {
  if (typeof value !== "string" || !CLERK_SUBJECT_PATTERN.test(value)) {
    throw invalidEvidence();
  }
  return value;
}

/** Validates one versioned UUID-shaped server identifier. */
function assertOpaqueId(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw invalidEvidence();
  }
  return value;
}

/** Keeps known alternate-provider evidence consumable before context matching. */
function assertProviderClaim(value: unknown): "codex" {
  if (value !== "codex" && value !== "claude") throw invalidEvidence();
  return value as "codex";
}

/** Validates a signed key identifier before matching authenticated key bytes. */
function assertKeyIdClaim(value: unknown): string {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    throw invalidEvidence();
  }
  return value;
}

/** Validates a configured key identifier as configuration, not signed input. */
function assertConfiguredKeyId(value: unknown): string {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value))
    throw configurationError();
  return value;
}

/** Validates the only opaque credential-handle shape. */
function assertNullableGatewayCredentialId(value: unknown): string | null {
  return value === null
    ? null
    : assertOpaqueId(value, GATEWAY_CREDENTIAL_ID_PATTERN);
}

/** Validates one small server-owned display label enum. */
function assertNullablePlanLabel(value: unknown): LifecyclePlanLabel | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !LIFECYCLE_PLAN_LABELS.includes(value as LifecyclePlanLabel)
  ) {
    throw invalidEvidence();
  }
  return value as LifecyclePlanLabel;
}

/** Reads a plain data object without invoking getters or accepting prototypes. */
function readPlainDataObject(value: unknown): Record<string, unknown> {
  try {
    const prototype =
      typeof value === "object" && value !== null
        ? Object.getPrototypeOf(value)
        : undefined;
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (prototype !== Object.prototype && prototype !== null)
    ) {
      throw invalidEvidence();
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length > 20 ||
      ownKeys.some(
        (key) =>
          typeof key !== "string" ||
          key === "__proto__" ||
          key === "prototype" ||
          key === "constructor"
      )
    ) {
      throw invalidEvidence();
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        typeof descriptor.value === "function"
      ) {
        throw invalidEvidence();
      }
      // A null-prototype destination plus defineProperty prevents magic-key
      // assignment from invoking Object.prototype setters.
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
    return result;
  } catch (error) {
    if (error instanceof LifecycleEvidenceError) throw error;
    throw invalidEvidence();
  }
}

/** Encodes fixed-order JSON as canonical unpadded base64url. */
function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Rejects duplicate keys, whitespace, reordering, and equivalent encodings. */
function assertCanonicalSegment(segment: string, value: object): void {
  if (segment !== encodeJson(value)) {
    throw new LifecycleEvidenceError(
      "noncanonical_evidence",
      "Lifecycle evidence encoding is not canonical"
    );
  }
}

/** Decodes only canonical unpadded base64url input. */
function decodeCanonicalBase64Url(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw invalidEvidence();
  }
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.toString("base64url") !== segment) {
    throw invalidEvidence();
  }
  return decoded;
}

/** Decodes a bounded base64url JSON object after signature authentication. */
function parseJsonObject(segment: string): Record<string, unknown> {
  try {
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(segment)) {
      throw invalidEvidence();
    }
    const decoded = Buffer.from(segment, "base64url");
    if (decoded.byteLength > MAX_LIFECYCLE_EVIDENCE_LENGTH) {
      throw invalidEvidence();
    }
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    return readPlainDataObject(parsed);
  } catch (error) {
    if (error instanceof LifecycleEvidenceError) throw error;
    throw invalidEvidence();
  }
}

/** Rejects omitted and extension fields. */
function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): void {
  assertRequiredAndAllowedKeys(value, expectedKeys, expectedKeys);
}

/** Rejects missing required fields and all fields outside the allowlist. */
function assertRequiredAndAllowedKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  allowedKeys: readonly string[]
): void {
  const actual = Object.keys(value).sort();
  const allowed = new Set(allowedKeys);
  if (
    actual.some((key) => !allowed.has(key)) ||
    requiredKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw invalidEvidence();
  }
}

/** Maps replay outcomes to stable secret-free failures. */
function replayError(
  code: LifecycleReplayDefenseErrorCode
): LifecycleEvidenceError {
  return new LifecycleEvidenceError(
    code,
    code === "replay_detected"
      ? "Lifecycle evidence was already consumed"
      : "Lifecycle evidence replay defense is unavailable"
  );
}

/** Creates a stable invalid-evidence rejection. */
function invalidEvidence(): LifecycleEvidenceError {
  return new LifecycleEvidenceError(
    "invalid_evidence",
    "Lifecycle evidence is invalid"
  );
}

/** Creates a stable invalid-configuration rejection. */
function configurationError(): LifecycleEvidenceError {
  return new LifecycleEvidenceError(
    "internal_evidence_configuration_invalid",
    "Lifecycle evidence configuration is invalid"
  );
}

export {
  DEFAULT_LIFECYCLE_REPLAY_TIMEOUT_MS,
  type ExpectedLifecycleEvidenceContext,
  issueLifecycleEvidence,
  LIFECYCLE_ERROR_CODES,
  LIFECYCLE_EVIDENCE_AUDIENCE,
  LIFECYCLE_EVIDENCE_ISSUER,
  LIFECYCLE_EVIDENCE_VERSION,
  LIFECYCLE_PLAN_LABELS,
  LIFECYCLE_TRANSITIONS,
  type LifecycleErrorCode,
  type LifecycleEvidenceAccount,
  type LifecycleEvidenceClaims,
  type LifecycleEvidenceClock,
  LifecycleEvidenceError,
  type LifecycleEvidenceErrorCode,
  type LifecycleEvidenceMetadata,
  type LifecycleEvidenceReplayDefense,
  type LifecycleEvidenceSigningKey,
  type LifecycleEvidenceVerificationKey,
  type LifecycleEvidenceVerificationKeys,
  type LifecycleMonotonicClock,
  type LifecyclePlanLabel,
  LifecycleReplayDefenseError,
  type LifecycleReplayDefenseErrorCode,
  type LifecycleReplayEntry,
  type LifecycleTransition,
  MAX_LIFECYCLE_EVIDENCE_LIFETIME_SECONDS,
  MAX_LIFECYCLE_REPLAY_TIMEOUT_MS,
  type ServerLifecycleDecision,
  verifyLifecycleEvidence,
  type VerifyLifecycleEvidenceOptions,
};
