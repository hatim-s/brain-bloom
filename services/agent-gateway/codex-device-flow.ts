import { randomBytes } from "node:crypto";

import {
  awaitControlPlaneOperation,
  type ControlPlaneOperationContext,
} from "./control-plane.ts";

const CEREMONY_ID_BYTES = 24;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_PROVIDER_SESSION_REF_LENGTH = 512;
const USER_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{2,14}[A-Z0-9])$/;

type CodexDeviceAccountType = "chatgpt" | "api_key";
type CodexDeviceStatus =
  | "starting"
  | "pending"
  | "authorized"
  | "cancelled"
  | "expired"
  | "denied";

type CodexDeviceScope = Readonly<{
  ownerId: string;
  connectionId: string;
  requestId: string;
}>;

type CodexDeviceAccount = Readonly<{
  type: CodexDeviceAccountType;
  present: true;
}>;

type CodexDeviceCeremonyRecord = Readonly<{
  ceremonyId: string;
  ownerId: string;
  connectionId: string;
  requestId: string;
  status: CodexDeviceStatus;
  createdAtMilliseconds: number;
  expiresAtMilliseconds: number;
  pollIntervalMilliseconds: number;
  nextPollAtMilliseconds: number;
  revision: number;
  userCode?: string;
  providerSessionRef?: string;
  account?: CodexDeviceAccount;
}>;

type CodexDeviceProjection = Readonly<{
  ceremonyId: string;
  status: CodexDeviceStatus;
  verificationUrl: string;
  expiresAtMilliseconds: number;
  pollIntervalMilliseconds: number;
  userCode?: string;
  account?: CodexDeviceAccount;
}>;

type CodexDeviceErrorCode =
  | "aborted"
  | "active_ceremony_exists"
  | "invalid_provider_response"
  | "not_found"
  | "provider_unavailable"
  | "store_unavailable"
  | "timed_out";

type CodexDeviceResult =
  | Readonly<{ ok: true; ceremony: CodexDeviceProjection }>
  | Readonly<{ ok: false; error: CodexDeviceErrorCode }>;

type ReserveCeremonyOutcome =
  | Readonly<{ status: "reserved"; record: CodexDeviceCeremonyRecord }>
  | Readonly<{ status: "same_request"; record: CodexDeviceCeremonyRecord }>
  | Readonly<{ status: "active_other_request" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "id_collision" }>;

type ActivateCeremonyOutcome =
  | Readonly<{ status: "activated"; record: CodexDeviceCeremonyRecord }>
  | Readonly<{ status: "current"; record: CodexDeviceCeremonyRecord }>
  | Readonly<{ status: "not_found" }>;

type PreparePollOutcome =
  | Readonly<{
      status: "granted";
      record: CodexDeviceCeremonyRecord;
      pollRevision: number;
      providerSessionRef: string;
    }>
  | Readonly<{
      status: "current";
      record: CodexDeviceCeremonyRecord;
    }>
  | Readonly<{ status: "not_found" }>;

type CompletePollOutcome =
  | Readonly<{ status: "completed"; record: CodexDeviceCeremonyRecord }>
  | Readonly<{ status: "stale"; record: CodexDeviceCeremonyRecord }>
  | Readonly<{ status: "not_found" }>;

type CancelCeremonyOutcome =
  | Readonly<{
      status: "cancelled" | "current";
      record: CodexDeviceCeremonyRecord;
      providerSessionRef?: string;
    }>
  | Readonly<{ status: "not_found" }>;

type CodexDevicePollCompletion =
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "expired" }>
  | Readonly<{ status: "authorized"; account: CodexDeviceAccount }>;

type CodexDeviceClientBeginOutcome = Readonly<{
  providerSessionRef: string;
  userCode: string;
}>;

interface CodexDeviceClient {
  /**
   * Starts or recovers a provider ceremony idempotently by ceremonyId.
   * Implementations must never vary command, model, home, or environment from
   * caller input because none of those values are accepted by this contract.
   */
  begin(
    input: Readonly<{ ceremonyId: string }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<CodexDeviceClientBeginOutcome>;

  /** Polls the server-held provider session without returning raw output. */
  poll(
    input: Readonly<{
      ceremonyId: string;
      providerSessionRef: string;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<CodexDevicePollCompletion>;

  /** Cancels a provider ceremony idempotently by ceremonyId. */
  cancel(
    input: Readonly<{
      ceremonyId: string;
      providerSessionRef: string;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<void>;
}

interface CodexDeviceCeremonyStore {
  /**
   * Atomically expires stale ceremonies, enforces one active ceremony per
   * connection, and reserves the supplied server-generated identifier. A
   * cross-owner connection match must be concealed as not_found. A different
   * request owned by the same owner is active_other_request;
   * implementations must never disclose the conflicting record.
   */
  reserve(
    input: Readonly<{
      ceremonyId: string;
      scope: CodexDeviceScope;
      nowMilliseconds: number;
      expiresAtMilliseconds: number;
      pollIntervalMilliseconds: number;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<ReserveCeremonyOutcome>;

  /** Activates only the matching starting record, or returns current state. */
  activate(
    input: Readonly<{
      ceremonyId: string;
      scope: CodexDeviceScope;
      nowMilliseconds: number;
      userCode: string;
      providerSessionRef: string;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<ActivateCeremonyOutcome>;

  /**
   * Atomically validates scope, applies expiry and poll throttling, and grants
   * at most one poll revision for the current interval.
   */
  preparePoll(
    input: Readonly<{
      ceremonyId: string;
      scope: CodexDeviceScope;
      nowMilliseconds: number;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<PreparePollOutcome>;

  /** Commits a provider result only while its granted revision remains live. */
  completePoll(
    input: Readonly<{
      ceremonyId: string;
      scope: CodexDeviceScope;
      nowMilliseconds: number;
      pollRevision: number;
      completion: CodexDevicePollCompletion;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<CompletePollOutcome>;

  /** Atomically validates scope and makes cancellation terminal/idempotent. */
  cancel(
    input: Readonly<{
      ceremonyId: string;
      scope: CodexDeviceScope;
      nowMilliseconds: number;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<CancelCeremonyOutcome>;
}

type CodexDeviceFlowOptions = Readonly<{
  client: CodexDeviceClient;
  store: CodexDeviceCeremonyStore;
  officialVerificationUrl: string;
  ceremonyTtlMilliseconds: number;
  pollIntervalMilliseconds: number;
  dependencyTimeoutMilliseconds: number;
  now?: () => number;
  createCeremonyId?: () => string;
}>;

type CodexDeviceFlow = Readonly<{
  begin: (
    scope: CodexDeviceScope,
    requestSignal?: AbortSignal
  ) => Promise<CodexDeviceResult>;
  poll: (
    scope: CodexDeviceScope,
    ceremonyId: string,
    requestSignal?: AbortSignal
  ) => Promise<CodexDeviceResult>;
  cancel: (
    scope: CodexDeviceScope,
    ceremonyId: string,
    requestSignal?: AbortSignal
  ) => Promise<CodexDeviceResult>;
}>;

/** Creates the provider-neutral Codex device authorization coordinator. */
function createCodexDeviceFlow(
  options: CodexDeviceFlowOptions
): CodexDeviceFlow {
  validateOptions(options);
  const verificationUrl = normalizeOfficialVerificationUrl(
    options.officialVerificationUrl
  );
  const now = options.now ?? Date.now;
  const createCeremonyId = options.createCeremonyId ?? defaultCeremonyId;

  /** Starts or recovers one request-bound ceremony without duplicate sessions. */
  async function begin(
    scope: CodexDeviceScope,
    requestSignal?: AbortSignal
  ): Promise<CodexDeviceResult> {
    if (!isValidScope(scope)) return failure("not_found");
    const nowMilliseconds = now();
    const ceremonyId = createCeremonyId();
    if (!isValidCeremonyId(ceremonyId)) return failure("store_unavailable");

    const reservation = await awaitDependency(
      (context) =>
        options.store.reserve(
          {
            ceremonyId,
            scope,
            nowMilliseconds,
            expiresAtMilliseconds:
              nowMilliseconds + options.ceremonyTtlMilliseconds,
            pollIntervalMilliseconds: options.pollIntervalMilliseconds,
          },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "store"
    );
    if (!reservation.ok) return reservation.result;
    if (reservation.value.status === "active_other_request") {
      return failure("active_ceremony_exists");
    }
    if (reservation.value.status === "not_found") return failure("not_found");
    if (reservation.value.status === "id_collision") {
      return failure("store_unavailable");
    }

    const record = reservation.value.record;
    if (!isValidRecord(record, scope, record.ceremonyId)) {
      return failure("store_unavailable");
    }
    if (record.status !== "starting") {
      return resultFromRecord(
        record,
        scope,
        record.ceremonyId,
        verificationUrl
      );
    }

    const providerBegin = await awaitDependency(
      (context) =>
        options.client.begin({ ceremonyId: record.ceremonyId }, context),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "provider"
    );
    if (!providerBegin.ok) return providerBegin.result;
    if (!isValidBeginOutcome(providerBegin.value)) {
      return failure("invalid_provider_response");
    }

    const activation = await awaitDependency(
      (context) =>
        options.store.activate(
          {
            ceremonyId: record.ceremonyId,
            scope,
            nowMilliseconds: now(),
            userCode: providerBegin.value.userCode,
            providerSessionRef: providerBegin.value.providerSessionRef,
          },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "store"
    );
    if (!activation.ok) return activation.result;
    if (activation.value.status === "not_found") return failure("not_found");
    if (!isValidRecord(activation.value.record, scope, record.ceremonyId)) {
      return failure("store_unavailable");
    }
    if (
      activation.value.status === "current" &&
      (activation.value.record.status === "cancelled" ||
        activation.value.record.status === "expired")
    ) {
      // A provider begin can settle after the durable ceremony became terminal.
      // Cancel that newly learned session, but never cancel a concurrently
      // activated pending session owned by the same idempotency key.
      const cleanup = await awaitDependency(
        (context) =>
          options.client.cancel(
            {
              ceremonyId: record.ceremonyId,
              providerSessionRef: providerBegin.value.providerSessionRef,
            },
            context
          ),
        options.dependencyTimeoutMilliseconds,
        requestSignal,
        "provider"
      );
      if (!cleanup.ok) return cleanup.result;
    }
    return resultFromRecord(
      activation.value.record,
      scope,
      record.ceremonyId,
      verificationUrl
    );
  }

  /** Polls at the store-granted cadence and fences every late completion. */
  async function poll(
    scope: CodexDeviceScope,
    ceremonyId: string,
    requestSignal?: AbortSignal
  ): Promise<CodexDeviceResult> {
    if (!isValidScope(scope) || !isValidCeremonyId(ceremonyId)) {
      return failure("not_found");
    }
    const prepared = await awaitDependency(
      (context) =>
        options.store.preparePoll(
          { ceremonyId, scope, nowMilliseconds: now() },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "store"
    );
    if (!prepared.ok) return prepared.result;
    if (prepared.value.status === "not_found") return failure("not_found");
    if (prepared.value.status === "current") {
      return resultFromRecord(
        prepared.value.record,
        scope,
        ceremonyId,
        verificationUrl
      );
    }
    const grantedPoll = prepared.value;
    if (
      !isValidRecord(grantedPoll.record, scope, ceremonyId) ||
      grantedPoll.record.status !== "pending" ||
      !isValidProviderSessionRef(grantedPoll.providerSessionRef) ||
      grantedPoll.record.providerSessionRef !==
        grantedPoll.providerSessionRef ||
      !Number.isSafeInteger(grantedPoll.pollRevision) ||
      grantedPoll.pollRevision !== grantedPoll.record.revision
    ) {
      return failure("store_unavailable");
    }

    const providerPoll = await awaitDependency(
      (context) =>
        options.client.poll(
          {
            ceremonyId,
            providerSessionRef: grantedPoll.providerSessionRef,
          },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "provider"
    );
    if (!providerPoll.ok) return providerPoll.result;
    if (!isValidPollCompletion(providerPoll.value)) {
      return failure("invalid_provider_response");
    }

    const completed = await awaitDependency(
      (context) =>
        options.store.completePoll(
          {
            ceremonyId,
            scope,
            nowMilliseconds: now(),
            pollRevision: grantedPoll.pollRevision,
            completion: providerPoll.value,
          },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "store"
    );
    if (!completed.ok) return completed.result;
    if (completed.value.status === "not_found") return failure("not_found");
    return resultFromRecord(
      completed.value.record,
      scope,
      ceremonyId,
      verificationUrl
    );
  }

  /** Commits terminal cancellation before bounded provider cleanup. */
  async function cancel(
    scope: CodexDeviceScope,
    ceremonyId: string,
    requestSignal?: AbortSignal
  ): Promise<CodexDeviceResult> {
    if (!isValidScope(scope) || !isValidCeremonyId(ceremonyId)) {
      return failure("not_found");
    }
    const cancellation = await awaitDependency(
      (context) =>
        options.store.cancel(
          { ceremonyId, scope, nowMilliseconds: now() },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "store"
    );
    if (!cancellation.ok) return cancellation.result;
    if (cancellation.value.status === "not_found") return failure("not_found");
    const durableCancellation = cancellation.value;
    if (
      !isValidRecord(durableCancellation.record, scope, ceremonyId) ||
      (durableCancellation.providerSessionRef !== undefined &&
        (!isValidProviderSessionRef(durableCancellation.providerSessionRef) ||
          durableCancellation.record.providerSessionRef !==
            durableCancellation.providerSessionRef))
    ) {
      return failure("store_unavailable");
    }

    if (durableCancellation.providerSessionRef) {
      const providerSessionRef = durableCancellation.providerSessionRef;
      const providerCancellation = await awaitDependency(
        (context) =>
          options.client.cancel(
            {
              ceremonyId,
              providerSessionRef,
            },
            context
          ),
        options.dependencyTimeoutMilliseconds,
        requestSignal,
        "provider"
      );
      if (!providerCancellation.ok) return providerCancellation.result;
    }
    return resultFromRecord(
      durableCancellation.record,
      scope,
      ceremonyId,
      verificationUrl
    );
  }

  return Object.freeze({ begin, poll, cancel });
}

/** Bounds one injected dependency and maps all opaque failures to stable codes. */
async function awaitDependency<T>(
  operation: (context: ControlPlaneOperationContext) => PromiseLike<T>,
  timeoutMilliseconds: number,
  requestSignal: AbortSignal | undefined,
  kind: "provider" | "store"
): Promise<
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; result: CodexDeviceResult }>
> {
  const outcome = await awaitControlPlaneOperation(
    operation,
    timeoutMilliseconds,
    requestSignal
  );
  if (outcome.status === "fulfilled") return { ok: true, value: outcome.value };
  if (outcome.status === "aborted") {
    return { ok: false, result: failure("aborted") };
  }
  if (outcome.status === "timed_out") {
    return { ok: false, result: failure("timed_out") };
  }
  return {
    ok: false,
    result: failure(
      kind === "store" ? "store_unavailable" : "provider_unavailable"
    ),
  };
}

/** Projects the only ceremony fields safe for an untrusted browser. */
function project(
  record: CodexDeviceCeremonyRecord,
  verificationUrl: string
): CodexDeviceProjection {
  const projection: {
    ceremonyId: string;
    status: CodexDeviceStatus;
    verificationUrl: string;
    expiresAtMilliseconds: number;
    pollIntervalMilliseconds: number;
    userCode?: string;
    account?: CodexDeviceAccount;
  } = {
    ceremonyId: record.ceremonyId,
    status: record.status,
    verificationUrl,
    expiresAtMilliseconds: record.expiresAtMilliseconds,
    pollIntervalMilliseconds: record.pollIntervalMilliseconds,
  };
  if (record.status === "pending" && record.userCode) {
    projection.userCode = record.userCode;
  }
  if (record.status === "authorized" && record.account) {
    projection.account = Object.freeze({
      type: record.account.type,
      present: true,
    });
  }
  return Object.freeze(projection);
}

/** Validates durable state before returning any portion to the browser. */
function resultFromRecord(
  record: CodexDeviceCeremonyRecord,
  scope: CodexDeviceScope,
  ceremonyId: string,
  verificationUrl: string
): CodexDeviceResult {
  return isValidRecord(record, scope, ceremonyId)
    ? success(project(record, verificationUrl))
    : failure("store_unavailable");
}

/** Rejects corrupted, over-shaped, or cross-scope durable ceremony records. */
function isValidRecord(
  value: unknown,
  scope: CodexDeviceScope,
  ceremonyId: string
): value is CodexDeviceCeremonyRecord {
  if (!isPlainObject(value)) return false;
  if (
    value.ceremonyId !== ceremonyId ||
    !isValidCeremonyId(ceremonyId) ||
    value.ownerId !== scope.ownerId ||
    value.connectionId !== scope.connectionId ||
    value.requestId !== scope.requestId ||
    ![
      "starting",
      "pending",
      "authorized",
      "cancelled",
      "expired",
      "denied",
    ].includes(String(value.status))
  ) {
    return false;
  }
  const finiteIntegers = [
    value.createdAtMilliseconds,
    value.expiresAtMilliseconds,
    value.pollIntervalMilliseconds,
    value.nextPollAtMilliseconds,
    value.revision,
  ];
  if (
    !finiteIntegers.every(
      (item) => typeof item === "number" && Number.isSafeInteger(item)
    ) ||
    (value.pollIntervalMilliseconds as number) <= 0 ||
    (value.revision as number) <= 0 ||
    (value.expiresAtMilliseconds as number) <=
      (value.createdAtMilliseconds as number)
  ) {
    return false;
  }
  if (value.status === "pending") {
    return (
      typeof value.userCode === "string" &&
      USER_CODE_PATTERN.test(value.userCode) &&
      isValidProviderSessionRef(value.providerSessionRef)
    );
  }
  if (value.status === "authorized") return isValidAccount(value.account);
  return true;
}

/** Validates provider begin output without reflecting its malformed values. */
function isValidBeginOutcome(
  value: unknown
): value is CodexDeviceClientBeginOutcome {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes("providerSessionRef") &&
    keys.includes("userCode") &&
    typeof value.providerSessionRef === "string" &&
    isValidProviderSessionRef(value.providerSessionRef) &&
    typeof value.userCode === "string" &&
    USER_CODE_PATTERN.test(value.userCode)
  );
}

/** Accepts only the finite provider poll union used by the state machine. */
function isValidPollCompletion(
  value: unknown
): value is CodexDevicePollCompletion {
  if (!isPlainObject(value) || typeof value.status !== "string") return false;
  const keys = Object.keys(value);
  if (["pending", "denied", "expired"].includes(value.status)) {
    return keys.length === 1;
  }
  if (value.status !== "authorized" || keys.length !== 2) return false;
  return isValidAccount(value.account);
}

/** Validates the only account presence shape permitted across the boundary. */
function isValidAccount(value: unknown): value is CodexDeviceAccount {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes("type") &&
    keys.includes("present") &&
    (value.type === "chatgpt" || value.type === "api_key") &&
    value.present === true
  );
}

/** Bounds the opaque server-only provider session reference. */
function isValidProviderSessionRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PROVIDER_SESSION_REF_LENGTH &&
    !hasControlCharacters(value)
  );
}

/** Detects control bytes without embedding them in a lint-hostile regex. */
function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/** Constrains the browser URL to one server-owned HTTPS URL with no payload. */
function normalizeOfficialVerificationUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("officialVerificationUrl must be a valid HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.origin === "null"
  ) {
    throw new TypeError("officialVerificationUrl must be a clean HTTPS URL");
  }
  return url.toString();
}

/** Validates all finite server policy before any dependency can execute. */
function validateOptions(options: CodexDeviceFlowOptions): void {
  for (const value of [
    options.ceremonyTtlMilliseconds,
    options.pollIntervalMilliseconds,
    options.dependencyTimeoutMilliseconds,
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("device-flow time bounds must be positive integers");
    }
  }
  if (options.pollIntervalMilliseconds >= options.ceremonyTtlMilliseconds) {
    throw new TypeError("poll interval must be shorter than ceremony TTL");
  }
}

/** Validates opaque caller scope without reflecting which field failed. */
function isValidScope(scope: CodexDeviceScope): boolean {
  return [scope.ownerId, scope.connectionId, scope.requestId].every(
    (value) =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_IDENTIFIER_LENGTH
  );
}

/** Recognizes the fixed entropy and alphabet of server-generated IDs. */
function isValidCeremonyId(value: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(value);
}

/** Generates a 192-bit opaque identifier without caller-controlled material. */
function defaultCeremonyId(): string {
  return randomBytes(CEREMONY_ID_BYTES).toString("base64url");
}

/** Creates a stable successful result without extra provider fields. */
function success(ceremony: CodexDeviceProjection): CodexDeviceResult {
  return Object.freeze({ ok: true, ceremony });
}

/** Creates one non-reflective browser error shape. */
function failure(error: CodexDeviceErrorCode): CodexDeviceResult {
  return Object.freeze({ ok: false, error });
}

/** Rejects arrays and class instances from provider-controlled results. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export {
  type ActivateCeremonyOutcome,
  type CancelCeremonyOutcome,
  type CodexDeviceAccount,
  type CodexDeviceAccountType,
  type CodexDeviceCeremonyRecord,
  type CodexDeviceCeremonyStore,
  type CodexDeviceClient,
  type CodexDeviceClientBeginOutcome,
  type CodexDeviceErrorCode,
  type CodexDeviceFlow,
  type CodexDeviceFlowOptions,
  type CodexDevicePollCompletion,
  type CodexDeviceProjection,
  type CodexDeviceResult,
  type CodexDeviceScope,
  type CodexDeviceStatus,
  type CompletePollOutcome,
  createCodexDeviceFlow,
  type PreparePollOutcome,
  type ReserveCeremonyOutcome,
};
