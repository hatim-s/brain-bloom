import { randomBytes } from "node:crypto";

import {
  awaitControlPlaneOperation,
  type ControlPlaneOperationContext,
} from "./control-plane.ts";

const CEREMONY_ID_BYTES = 24;
const MAX_CLEANUP_SESSION_REFS = 8;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_PROVIDER_SESSION_REF_LENGTH = 512;
const MAX_RUNTIME_ARRAY_LENGTH = MAX_CLEANUP_SESSION_REFS;
const MAX_RUNTIME_OWN_STRING_KEYS = 16;
const MAX_RUNTIME_SNAPSHOT_DEPTH = 16;
const MAX_RUNTIME_SNAPSHOT_ENTRIES = 65;
const MAX_RUNTIME_STRING_CODE_UNITS = 1_024;
const MAX_RUNTIME_STRING_UTF8_BYTES = 2_048;
const USER_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{2,14}[A-Z0-9])$/;
const OFFICIAL_CODEX_VERIFICATION_URLS = Object.freeze([
  "https://auth.openai.com/codex/device",
] as const);

type CodexDeviceAccountType = "chatgpt";
type CodexDeviceStatus =
  "starting" | "pending" | "authorized" | "cancelled" | "expired" | "denied";

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
  providerBeginKey: string;
  providerBeginPending: boolean;
  userCode?: string;
  providerSessionRef?: string;
  cleanupSessionRefs: readonly string[];
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

type RecordBeginOutcome =
  | Readonly<{ status: "recorded"; record: CodexDeviceCeremonyRecord }>
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
    }>
  | Readonly<{ status: "not_found" }>;

type ClaimCleanupOutcome =
  | Readonly<{
      status: "granted";
      record: CodexDeviceCeremonyRecord;
      cleanupRevision: number;
      providerBeginKey: string;
      providerSessionRef: string;
    }>
  | Readonly<{ status: "current"; record: CodexDeviceCeremonyRecord }>
  | Readonly<{ status: "not_found" }>;

type CompleteCleanupOutcome =
  | Readonly<{
      status: "completed" | "current";
      record: CodexDeviceCeremonyRecord;
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
   * Starts or recovers a provider ceremony atomically and idempotently by the
   * persisted ceremonyId/providerBeginKey pair across processes and restarts.
   * Implementations must never vary command, model, home, or environment from
   * caller input because none of those values are accepted by this contract.
   */
  begin(
    input: Readonly<{ ceremonyId: string; providerBeginKey: string }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<CodexDeviceClientBeginOutcome>;

  /** Polls the server-held provider session without returning raw output. */
  poll(
    input: Readonly<{
      ceremonyId: string;
      providerBeginKey: string;
      providerSessionRef: string;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<CodexDevicePollCompletion>;

  /** Cancels one exact provider session idempotently by persisted begin key. */
  cancel(
    input: Readonly<{
      ceremonyId: string;
      providerBeginKey: string;
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
      providerBeginKey: string;
      scope: CodexDeviceScope;
      nowMilliseconds: number;
      expiresAtMilliseconds: number;
      pollIntervalMilliseconds: number;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<ReserveCeremonyOutcome>;

  /**
   * Atomically records every idempotent begin result. The first result may
   * activate a starting record; terminal and race-loser references must be
   * retained in cleanupSessionRefs until completeCleanup removes them.
   */
  recordBegin(
    input: Readonly<{
      ceremonyId: string;
      providerBeginKey: string;
      scope: CodexDeviceScope;
      nowMilliseconds: number;
      userCode: string;
      providerSessionRef: string;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<RecordBeginOutcome>;

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

  /** Atomically grants one retained provider session for idempotent cleanup. */
  claimCleanup(
    input: Readonly<{
      ceremonyId: string;
      scope: CodexDeviceScope;
      nowMilliseconds: number;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<ClaimCleanupOutcome>;

  /** Removes only the exact cleanup revision/reference after provider success. */
  completeCleanup(
    input: Readonly<{
      ceremonyId: string;
      scope: CodexDeviceScope;
      nowMilliseconds: number;
      cleanupRevision: number;
      providerSessionRef: string;
    }>,
    context: ControlPlaneOperationContext
  ): PromiseLike<CompleteCleanupOutcome>;
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
  createProviderBeginKey?: () => string;
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

type BeginLifecycleState = { abortRequested: boolean };

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
  const createProviderBeginKey =
    options.createProviderBeginKey ?? defaultCeremonyId;

  /** Reads the injected clock without exposing exceptions or invalid values. */
  function readServerTime(): number | null {
    try {
      const value = now();
      return isValidTimestamp(value) ? value : null;
    } catch {
      return null;
    }
  }

  /** Starts or recovers one request-bound ceremony without duplicate sessions. */
  async function begin(
    scope: CodexDeviceScope,
    requestSignal?: AbortSignal
  ): Promise<CodexDeviceResult> {
    const durableScope = parseScopeSnapshot(scope);
    if (!durableScope) return failure("not_found");
    const nowMilliseconds = readServerTime();
    if (nowMilliseconds === null) return failure("store_unavailable");
    const ceremonyId = safelyCreateOpaqueId(createCeremonyId);
    const providerBeginKey = safelyCreateOpaqueId(createProviderBeginKey);
    if (!ceremonyId || !providerBeginKey) return failure("store_unavailable");

    const reservation = await awaitDependency(
      (context) =>
        options.store.reserve(
          {
            ceremonyId,
            providerBeginKey,
            scope: durableScope,
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
    const reserved = parseRuntimeSnapshot(reservation.value, (value) =>
      parseReserveOutcome(value, durableScope, ceremonyId, providerBeginKey)
    );
    if (!reserved) return failure("store_unavailable");
    if (reserved.status === "active_other_request") {
      return failure("active_ceremony_exists");
    }
    if (reserved.status === "not_found") return failure("not_found");
    if (reserved.status === "id_collision") {
      return failure("store_unavailable");
    }

    const record = reserved.record;
    if (record.status !== "starting") {
      const cleaned = await drainCleanup(record, durableScope);
      if (!cleaned.ok) return cleaned.result;
      return resultFromRecord(
        cleaned.record,
        durableScope,
        record.ceremonyId,
        verificationUrl
      );
    }

    // Once the durable reservation commits, provider settlement and cleanup are
    // server-owned. Caller abort stops waiting but cannot discard a late ref.
    const lifecycleState: BeginLifecycleState = { abortRequested: false };
    const lifecycle = settleProviderBegin(
      record,
      durableScope,
      lifecycleState
    ).catch(() => failure("provider_unavailable"));
    return awaitCallerLifecycle(lifecycle, requestSignal, () => {
      lifecycleState.abortRequested = true;
      return terminalizeAfterCallerAbort(record, durableScope);
    });
  }

  /** Makes caller-aborted begin terminal while the provider settles independently. */
  async function terminalizeAfterCallerAbort(
    record: CodexDeviceCeremonyRecord,
    scope: CodexDeviceScope
  ): Promise<void> {
    const nowMilliseconds = readServerTime();
    if (nowMilliseconds === null) return;
    const cancellation = await awaitDependency(
      (context) =>
        options.store.cancel(
          {
            ceremonyId: record.ceremonyId,
            scope,
            nowMilliseconds,
          },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      undefined,
      "store"
    );
    if (!cancellation.ok) return;
    const durable = parseRuntimeSnapshot(cancellation.value, (value) =>
      parseCancelOutcome(value, scope, record.ceremonyId)
    );
    if (!durable || durable.status === "not_found") return;
    await drainCleanup(durable.record, scope);
  }

  /** Records an idempotent provider begin result before any cleanup attempt. */
  async function settleProviderBegin(
    record: CodexDeviceCeremonyRecord,
    scope: CodexDeviceScope,
    lifecycleState: BeginLifecycleState
  ): Promise<CodexDeviceResult> {
    const operationController = new AbortController();
    const deadlineAtMilliseconds =
      Date.now() + options.dependencyTimeoutMilliseconds;
    return new Promise<CodexDeviceResult>((resolve) => {
      let responseSettled = false;
      const finishResponse = (result: CodexDeviceResult): void => {
        if (responseSettled) return;
        responseSettled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(() => {
        operationController.abort();
        finishResponse(failure("timed_out"));
      }, options.dependencyTimeoutMilliseconds);
      const rawBegin = Promise.resolve().then(() =>
        options.client.begin(
          {
            ceremonyId: record.ceremonyId,
            providerBeginKey: record.providerBeginKey,
          },
          Object.freeze({
            signal: operationController.signal,
            deadlineAtMilliseconds,
          })
        )
      );
      const durableSettlement = rawBegin.then(
        (value) => {
          // A fulfillment owns reconciliation even after the response deadline.
          clearTimeout(timeout);
          return recordProviderBeginResult(
            value,
            record,
            scope,
            lifecycleState
          );
        },
        () => {
          clearTimeout(timeout);
          return failure("provider_unavailable");
        }
      );
      durableSettlement.then(finishResponse, () =>
        finishResponse(failure("provider_unavailable"))
      );
    });
  }

  /** Persists and reconciles one provider begin result, including late success. */
  async function recordProviderBeginResult(
    rawProviderResult: unknown,
    record: CodexDeviceCeremonyRecord,
    scope: CodexDeviceScope,
    lifecycleState: BeginLifecycleState
  ): Promise<CodexDeviceResult> {
    const providerResult = parseRuntimeSnapshot(
      rawProviderResult,
      parseProviderBeginOutcome
    );
    if (!providerResult) {
      return failure("provider_unavailable");
    }
    const nowMilliseconds = readServerTime();
    if (nowMilliseconds === null) return failure("store_unavailable");
    const recordedBegin = await awaitDependency(
      (context) =>
        options.store.recordBegin(
          {
            ceremonyId: record.ceremonyId,
            providerBeginKey: record.providerBeginKey,
            scope,
            nowMilliseconds,
            userCode: providerResult.userCode,
            providerSessionRef: providerResult.providerSessionRef,
          },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      undefined,
      "store"
    );
    if (!recordedBegin.ok) return recordedBegin.result;
    const recorded = parseRuntimeSnapshot(recordedBegin.value, (value) =>
      parseRecordBeginOutcome(
        value,
        scope,
        record.ceremonyId,
        record.providerBeginKey,
        providerResult.providerSessionRef
      )
    );
    if (!recorded) return failure("store_unavailable");
    if (recorded.status === "not_found") return failure("not_found");
    if (lifecycleState.abortRequested) {
      // Retry the durable terminal transition after the ref is recorded. This
      // closes an ambiguous or failed first cancellation attempt during abort.
      await terminalizeAfterCallerAbort(recorded.record, scope);
    }
    const cleaned = await drainCleanup(recorded.record, scope);
    if (!cleaned.ok) return cleaned.result;
    return resultFromRecord(
      cleaned.record,
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
    const durableScope = parseScopeSnapshot(scope);
    if (!durableScope || !isValidCeremonyId(ceremonyId)) {
      return failure("not_found");
    }
    const prepareAtMilliseconds = readServerTime();
    if (prepareAtMilliseconds === null) return failure("store_unavailable");
    const prepared = await awaitDependency(
      (context) =>
        options.store.preparePoll(
          {
            ceremonyId,
            scope: durableScope,
            nowMilliseconds: prepareAtMilliseconds,
          },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "store"
    );
    if (!prepared.ok) return prepared.result;
    const preparedOutcome = parseRuntimeSnapshot(prepared.value, (value) =>
      parsePreparePollOutcome(value, durableScope, ceremonyId)
    );
    if (!preparedOutcome) return failure("store_unavailable");
    if (preparedOutcome.status === "not_found") return failure("not_found");
    if (preparedOutcome.status === "current") {
      const cleaned = await drainCleanup(preparedOutcome.record, durableScope);
      if (!cleaned.ok) return cleaned.result;
      return resultFromRecord(
        cleaned.record,
        durableScope,
        ceremonyId,
        verificationUrl
      );
    }
    const grantedPoll = preparedOutcome;

    const providerPoll = await awaitDependency(
      (context) =>
        options.client.poll(
          {
            ceremonyId,
            providerBeginKey: grantedPoll.record.providerBeginKey,
            providerSessionRef: grantedPoll.providerSessionRef,
          },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "provider"
    );
    if (!providerPoll.ok) return providerPoll.result;
    const providerCompletion = parseRuntimeSnapshot(
      providerPoll.value,
      parseProviderPollOutcome
    );
    if (!providerCompletion) {
      return failure("provider_unavailable");
    }
    const completeAtMilliseconds = readServerTime();
    if (completeAtMilliseconds === null) return failure("store_unavailable");

    const completed = await awaitDependency(
      (context) =>
        options.store.completePoll(
          {
            ceremonyId,
            scope: durableScope,
            nowMilliseconds: completeAtMilliseconds,
            pollRevision: grantedPoll.pollRevision,
            completion: providerCompletion,
          },
          context
        ),
      options.dependencyTimeoutMilliseconds,
      requestSignal,
      "store"
    );
    if (!completed.ok) return completed.result;
    const completedOutcome = parseRuntimeSnapshot(completed.value, (value) =>
      parseCompletePollOutcome(value, durableScope, ceremonyId)
    );
    if (!completedOutcome) return failure("store_unavailable");
    if (completedOutcome.status === "not_found") return failure("not_found");
    const cleaned = await drainCleanup(completedOutcome.record, durableScope);
    if (!cleaned.ok) return cleaned.result;
    return resultFromRecord(
      cleaned.record,
      durableScope,
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
    const durableScope = parseScopeSnapshot(scope);
    if (!durableScope || !isValidCeremonyId(ceremonyId)) {
      return failure("not_found");
    }
    const lifecycle = commitExplicitCancellation(
      durableScope,
      ceremonyId
    ).catch(() => failure("store_unavailable"));
    return awaitCallerLifecycle(lifecycle, requestSignal);
  }

  /** Owns terminal cancellation independently from the browser response signal. */
  async function commitExplicitCancellation(
    scope: CodexDeviceScope,
    ceremonyId: string
  ): Promise<CodexDeviceResult> {
    const nowMilliseconds = readServerTime();
    if (nowMilliseconds === null) return failure("store_unavailable");
    const cancellation = await awaitDependency(
      (context) =>
        options.store.cancel({ ceremonyId, scope, nowMilliseconds }, context),
      options.dependencyTimeoutMilliseconds,
      undefined,
      "store"
    );
    if (!cancellation.ok) return cancellation.result;
    const durableCancellation = parseRuntimeSnapshot(
      cancellation.value,
      (value) => parseCancelOutcome(value, scope, ceremonyId)
    );
    if (!durableCancellation) return failure("store_unavailable");
    if (durableCancellation.status === "not_found") return failure("not_found");
    if (durableCancellation.record.providerBeginPending) {
      // Recovery continues independently; terminal cancellation is already
      // durable and should not wait for a provider that may settle much later.
      settleProviderBegin(durableCancellation.record, scope, {
        abortRequested: true,
      }).catch(() => failure("provider_unavailable"));
    }
    const cleaned = await drainCleanup(durableCancellation.record, scope);
    if (!cleaned.ok) return cleaned.result;
    return resultFromRecord(cleaned.record, scope, ceremonyId, verificationUrl);
  }

  /** Drains durable cleanup work under server-owned deadlines, never caller abort. */
  async function drainCleanup(
    initialRecord: CodexDeviceCeremonyRecord,
    scope: CodexDeviceScope
  ): Promise<
    | Readonly<{ ok: true; record: CodexDeviceCeremonyRecord }>
    | Readonly<{ ok: false; result: CodexDeviceResult }>
  > {
    let record = initialRecord;
    for (let attempt = 0; attempt < MAX_CLEANUP_SESSION_REFS; attempt += 1) {
      const claimAtMilliseconds = readServerTime();
      if (claimAtMilliseconds === null) {
        return { ok: false, result: failure("store_unavailable") };
      }
      const claimedCleanup = await awaitDependency(
        (context) =>
          options.store.claimCleanup(
            {
              ceremonyId: record.ceremonyId,
              scope,
              nowMilliseconds: claimAtMilliseconds,
            },
            context
          ),
        options.dependencyTimeoutMilliseconds,
        undefined,
        "store"
      );
      if (!claimedCleanup.ok) return claimedCleanup;
      const claimed = parseRuntimeSnapshot(claimedCleanup.value, (value) =>
        parseClaimCleanupOutcome(value, scope, record.ceremonyId)
      );
      if (!claimed) {
        return { ok: false, result: failure("store_unavailable") };
      }
      if (claimed.status === "not_found") {
        return { ok: false, result: failure("not_found") };
      }
      record = claimed.record;
      if (claimed.status === "current") return { ok: true, record };

      const providerCancellation = await awaitDependency(
        (context) =>
          options.client.cancel(
            {
              ceremonyId: record.ceremonyId,
              providerBeginKey: claimed.providerBeginKey,
              providerSessionRef: claimed.providerSessionRef,
            },
            context
          ),
        options.dependencyTimeoutMilliseconds,
        undefined,
        "provider"
      );
      if (!providerCancellation.ok) return providerCancellation;
      if (providerCancellation.value !== undefined) {
        return { ok: false, result: failure("provider_unavailable") };
      }
      const completeAtMilliseconds = readServerTime();
      if (completeAtMilliseconds === null) {
        return { ok: false, result: failure("store_unavailable") };
      }
      const completedCleanup = await awaitDependency(
        (context) =>
          options.store.completeCleanup(
            {
              ceremonyId: record.ceremonyId,
              scope,
              nowMilliseconds: completeAtMilliseconds,
              cleanupRevision: claimed.cleanupRevision,
              providerSessionRef: claimed.providerSessionRef,
            },
            context
          ),
        options.dependencyTimeoutMilliseconds,
        undefined,
        "store"
      );
      if (!completedCleanup.ok) return completedCleanup;
      const completed = parseRuntimeSnapshot(completedCleanup.value, (value) =>
        parseCompleteCleanupOutcome(
          value,
          scope,
          record.ceremonyId,
          claimed.providerSessionRef
        )
      );
      if (!completed) {
        return { ok: false, result: failure("store_unavailable") };
      }
      if (completed.status === "not_found") {
        return { ok: false, result: failure("not_found") };
      }
      record = completed.record;
    }
    return record.cleanupSessionRefs.length === 0
      ? { ok: true, record }
      : { ok: false, result: failure("store_unavailable") };
  }

  return Object.freeze({ begin, poll, cancel });
}

/** Lets a caller stop waiting without aborting the server-owned lifecycle. */
function awaitCallerLifecycle(
  lifecycle: Promise<CodexDeviceResult>,
  requestSignal?: AbortSignal,
  onAbort?: () => Promise<void>
): Promise<CodexDeviceResult> {
  if (!requestSignal) return lifecycle;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CodexDeviceResult): void => {
      if (settled) return;
      settled = true;
      requestSignal.removeEventListener("abort", handleAbort);
      resolve(result);
    };
    const handleAbort = (): void => {
      // The server-owned terminal transition continues after the response.
      onAbort?.().catch(() => undefined);
      finish(failure("aborted"));
    };
    requestSignal.addEventListener("abort", handleAbort, { once: true });
    if (requestSignal.aborted) handleAbort();
    lifecycle.then(finish, () => finish(failure("provider_unavailable")));
  });
}

type RuntimeSnapshotState = {
  entries: number;
  seen: WeakSet<object>;
};

/** Copies one injected boundary into a closed, deeply frozen data snapshot. */
function parseRuntimeSnapshot<T>(
  source: unknown,
  parser: (snapshot: unknown) => T | null
): T | null {
  try {
    const state: RuntimeSnapshotState = {
      entries: 0,
      seen: new WeakSet<object>(),
    };
    const snapshot = snapshotRuntimeValue(source, state, 0);
    return parser(snapshot);
  } catch {
    return null;
  }
}

/** Recursively snapshots data properties without invoking source getters. */
function snapshotRuntimeValue(
  source: unknown,
  state: RuntimeSnapshotState,
  depth: number
): unknown {
  if (
    source === null ||
    typeof source === "number" ||
    typeof source === "boolean"
  ) {
    consumeSnapshotEntries(state, 1);
    return source;
  }
  if (typeof source === "string") {
    consumeSnapshotEntries(state, 1);
    if (
      source.length > MAX_RUNTIME_STRING_CODE_UNITS ||
      Buffer.byteLength(source, "utf8") > MAX_RUNTIME_STRING_UTF8_BYTES
    ) {
      throw new TypeError("oversized runtime string");
    }
    return source;
  }
  if (
    typeof source !== "object" ||
    depth > MAX_RUNTIME_SNAPSHOT_DEPTH ||
    state.seen.has(source)
  ) {
    throw new TypeError("invalid runtime snapshot");
  }
  consumeSnapshotEntries(state, 1);
  state.seen.add(source);
  const prototype = Reflect.getPrototypeOf(source);

  if (Array.isArray(source)) {
    if (prototype !== Array.prototype) {
      throw new TypeError("non-plain runtime array");
    }
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(source, "length");
    const length = lengthDescriptor?.value;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_RUNTIME_ARRAY_LENGTH
    ) {
      throw new TypeError("invalid runtime array length");
    }
    // Length is capped before own-key enumeration so a huge sparse array never
    // drives an allocation or iteration proportional to its claimed length.
    const keys = Reflect.ownKeys(source);
    if (
      keys.length > MAX_RUNTIME_OWN_STRING_KEYS ||
      keys.some((key) => typeof key === "symbol") ||
      keys.length !== length + 1
    ) {
      throw new TypeError("sparse or extended runtime array");
    }
    // Charge every own slot plus the primitive length value. Indexed values
    // are charged recursively below.
    consumeSnapshotEntries(state, keys.length + 1);
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("runtime array accessors are unavailable");
      }
      snapshot.push(snapshotRuntimeValue(descriptor.value, state, depth + 1));
    }
    return Object.freeze(snapshot);
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("non-plain runtime object");
  }
  const keys = Reflect.ownKeys(source);
  if (
    keys.length > MAX_RUNTIME_OWN_STRING_KEYS ||
    keys.some((key) => typeof key === "symbol")
  ) {
    throw new TypeError("runtime object cardinality is unavailable");
  }
  consumeSnapshotEntries(state, keys.length);
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("runtime accessors are unavailable");
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: snapshotRuntimeValue(descriptor.value, state, depth + 1),
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

/** Charges values and property/array slots to one total snapshot budget. */
function consumeSnapshotEntries(
  state: RuntimeSnapshotState,
  count: number
): void {
  if (state.entries + count > MAX_RUNTIME_SNAPSHOT_ENTRIES) {
    throw new TypeError("runtime snapshot budget exhausted");
  }
  state.entries += count;
}

/** Normalizes caller scope once before it crosses any durable boundary. */
function parseScopeSnapshot(source: unknown): CodexDeviceScope | null {
  return parseRuntimeSnapshot(source, (snapshot) =>
    isValidScope(snapshot) ? (snapshot as CodexDeviceScope) : null
  );
}

/** Parses the exact atomic reserve envelope before any record dereference. */
function parseReserveOutcome(
  value: unknown,
  scope: CodexDeviceScope,
  proposedCeremonyId: string,
  proposedProviderBeginKey: string
): ReserveCeremonyOutcome | null {
  if (!isPlainObject(value) || typeof value.status !== "string") return null;
  if (
    ["active_other_request", "not_found", "id_collision"].includes(value.status)
  ) {
    return hasExactKeys(value, ["status"])
      ? (value as ReserveCeremonyOutcome)
      : null;
  }
  if (
    (value.status !== "reserved" && value.status !== "same_request") ||
    !hasExactKeys(value, ["status", "record"]) ||
    !isValidRecord(value.record, scope)
  ) {
    return null;
  }
  if (
    value.status === "reserved" &&
    (value.record.ceremonyId !== proposedCeremonyId ||
      value.record.providerBeginKey !== proposedProviderBeginKey ||
      value.record.status !== "starting")
  ) {
    return null;
  }
  if (
    value.status === "same_request" &&
    value.record.status !== "starting" &&
    value.record.status !== "pending"
  ) {
    return null;
  }
  return value as ReserveCeremonyOutcome;
}

/** Parses the exact durable provider-begin result envelope. */
function parseRecordBeginOutcome(
  value: unknown,
  scope: CodexDeviceScope,
  ceremonyId: string,
  providerBeginKey: string,
  providerSessionRef: string
): RecordBeginOutcome | null {
  if (!isPlainObject(value) || typeof value.status !== "string") return null;
  if (value.status === "not_found") {
    return hasExactKeys(value, ["status"]) ? { status: "not_found" } : null;
  }
  if (
    (value.status !== "recorded" && value.status !== "current") ||
    !hasExactKeys(value, ["status", "record"]) ||
    !isValidRecord(value.record, scope, ceremonyId) ||
    value.record.providerBeginKey !== providerBeginKey ||
    value.record.providerBeginPending !== false ||
    value.record.status === "starting" ||
    (value.record.providerSessionRef !== providerSessionRef &&
      !value.record.cleanupSessionRefs.includes(providerSessionRef))
  ) {
    return null;
  }
  return value as RecordBeginOutcome;
}

/** Parses and verifies poll grants before a provider session is touched. */
function parsePreparePollOutcome(
  value: unknown,
  scope: CodexDeviceScope,
  ceremonyId: string
): PreparePollOutcome | null {
  if (!isPlainObject(value) || typeof value.status !== "string") return null;
  if (value.status === "not_found") {
    return hasExactKeys(value, ["status"]) ? { status: "not_found" } : null;
  }
  if (value.status === "current") {
    return hasExactKeys(value, ["status", "record"]) &&
      isValidRecord(value.record, scope, ceremonyId)
      ? (value as PreparePollOutcome)
      : null;
  }
  if (
    value.status !== "granted" ||
    !hasExactKeys(value, [
      "status",
      "record",
      "pollRevision",
      "providerSessionRef",
    ]) ||
    !isValidRecord(value.record, scope, ceremonyId) ||
    value.record.status !== "pending" ||
    !isValidProviderSessionRef(value.providerSessionRef) ||
    value.record.providerSessionRef !== value.providerSessionRef ||
    !Number.isSafeInteger(value.pollRevision) ||
    value.pollRevision !== value.record.revision
  ) {
    return null;
  }
  return value as PreparePollOutcome;
}

/** Parses the exact poll-completion store envelope. */
function parseCompletePollOutcome(
  value: unknown,
  scope: CodexDeviceScope,
  ceremonyId: string
): CompletePollOutcome | null {
  const parsed = parseRecordOutcome(value, scope, ceremonyId, [
    "completed",
    "stale",
  ]) as CompletePollOutcome | null;
  if (
    parsed?.status === "completed" &&
    !["pending", "authorized", "denied", "expired"].includes(
      parsed.record.status
    )
  ) {
    return null;
  }
  return parsed;
}

/** Parses the exact cancellation store envelope. */
function parseCancelOutcome(
  value: unknown,
  scope: CodexDeviceScope,
  ceremonyId: string
): CancelCeremonyOutcome | null {
  const parsed = parseRecordOutcome(value, scope, ceremonyId, [
    "cancelled",
    "current",
  ]) as CancelCeremonyOutcome | null;
  if (
    (parsed?.status === "cancelled" && parsed.record.status !== "cancelled") ||
    (parsed?.status === "current" &&
      (parsed.record.status === "starting" ||
        parsed.record.status === "pending"))
  ) {
    return null;
  }
  return parsed;
}

/** Parses a cleanup grant and proves its reference remains durably retained. */
function parseClaimCleanupOutcome(
  value: unknown,
  scope: CodexDeviceScope,
  ceremonyId: string
): ClaimCleanupOutcome | null {
  if (!isPlainObject(value) || typeof value.status !== "string") return null;
  if (value.status === "not_found") {
    return hasExactKeys(value, ["status"]) ? { status: "not_found" } : null;
  }
  if (value.status === "current") {
    return hasExactKeys(value, ["status", "record"]) &&
      isValidRecord(value.record, scope, ceremonyId) &&
      value.record.cleanupSessionRefs.length === 0
      ? (value as ClaimCleanupOutcome)
      : null;
  }
  if (
    value.status !== "granted" ||
    !hasExactKeys(value, [
      "status",
      "record",
      "cleanupRevision",
      "providerBeginKey",
      "providerSessionRef",
    ]) ||
    !isValidRecord(value.record, scope, ceremonyId) ||
    value.providerBeginKey !== value.record.providerBeginKey ||
    !isValidProviderSessionRef(value.providerSessionRef) ||
    !value.record.cleanupSessionRefs.includes(value.providerSessionRef) ||
    !Number.isSafeInteger(value.cleanupRevision) ||
    value.cleanupRevision !== value.record.revision
  ) {
    return null;
  }
  return value as ClaimCleanupOutcome;
}

/** Parses cleanup completion without assuming a successful removal. */
function parseCompleteCleanupOutcome(
  value: unknown,
  scope: CodexDeviceScope,
  ceremonyId: string,
  providerSessionRef: string
): CompleteCleanupOutcome | null {
  const parsed = parseRecordOutcome(value, scope, ceremonyId, [
    "completed",
    "current",
  ]) as CompleteCleanupOutcome | null;
  if (
    parsed?.status === "completed" &&
    parsed.record.cleanupSessionRefs.includes(providerSessionRef)
  ) {
    return null;
  }
  return parsed;
}

/** Parses a common exact status/record or not-found store envelope. */
function parseRecordOutcome(
  value: unknown,
  scope: CodexDeviceScope,
  ceremonyId: string,
  statuses: readonly string[]
):
  | Readonly<{ status: string; record: CodexDeviceCeremonyRecord }>
  | Readonly<{ status: "not_found" }>
  | null {
  if (!isPlainObject(value) || typeof value.status !== "string") return null;
  if (value.status === "not_found") {
    return hasExactKeys(value, ["status"]) ? { status: "not_found" } : null;
  }
  return statuses.includes(value.status) &&
    hasExactKeys(value, ["status", "record"]) &&
    isValidRecord(value.record, scope, ceremonyId)
    ? (value as Readonly<{
        status: string;
        record: CodexDeviceCeremonyRecord;
      }>)
    : null;
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
  let outcome;
  try {
    outcome = await awaitControlPlaneOperation(
      operation,
      timeoutMilliseconds,
      requestSignal
    );
  } catch {
    return {
      ok: false,
      result: failure(
        kind === "store" ? "store_unavailable" : "provider_unavailable"
      ),
    };
  }
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
  ceremonyId?: string
): value is CodexDeviceCeremonyRecord {
  if (!isPlainObject(value)) return false;
  const requiredKeys = [
    "ceremonyId",
    "ownerId",
    "connectionId",
    "requestId",
    "status",
    "createdAtMilliseconds",
    "expiresAtMilliseconds",
    "pollIntervalMilliseconds",
    "nextPollAtMilliseconds",
    "revision",
    "providerBeginKey",
    "providerBeginPending",
    "cleanupSessionRefs",
  ];
  const allowedKeys = new Set([
    ...requiredKeys,
    "userCode",
    "providerSessionRef",
    "account",
  ]);
  const recordKeys = Object.keys(value);
  if (
    !requiredKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
    ) ||
    recordKeys.some((key) => !allowedKeys.has(key))
  ) {
    return false;
  }
  if (
    !isValidCeremonyId(value.ceremonyId) ||
    (ceremonyId !== undefined && value.ceremonyId !== ceremonyId) ||
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
  if (
    !isValidCeremonyId(value.providerBeginKey) ||
    typeof value.providerBeginPending !== "boolean" ||
    !Array.isArray(value.cleanupSessionRefs) ||
    value.cleanupSessionRefs.length > MAX_CLEANUP_SESSION_REFS ||
    !value.cleanupSessionRefs.every(isValidProviderSessionRef) ||
    new Set(value.cleanupSessionRefs).size !== value.cleanupSessionRefs.length
  ) {
    return false;
  }
  if (
    value.status === "starting" &&
    (value.userCode !== undefined ||
      value.providerSessionRef !== undefined ||
      value.account !== undefined ||
      value.cleanupSessionRefs.length !== 0 ||
      value.providerBeginPending !== true)
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
      isValidProviderSessionRef(value.providerSessionRef) &&
      !value.cleanupSessionRefs.includes(value.providerSessionRef) &&
      value.account === undefined &&
      value.providerBeginPending === false
    );
  }
  if (
    value.providerSessionRef !== undefined &&
    !isValidProviderSessionRef(value.providerSessionRef)
  ) {
    return false;
  }
  if (value.status === "authorized") return isValidAccount(value.account);
  if (value.account !== undefined) return false;
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

/** Returns only a pre-snapshotted, closed provider begin envelope. */
function parseProviderBeginOutcome(
  value: unknown
): CodexDeviceClientBeginOutcome | null {
  return isValidBeginOutcome(value)
    ? (value as CodexDeviceClientBeginOutcome)
    : null;
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

/** Returns only a pre-snapshotted, subscription-safe poll completion. */
function parseProviderPollOutcome(
  value: unknown
): CodexDevicePollCompletion | null {
  return isValidPollCompletion(value)
    ? (value as CodexDevicePollCompletion)
    : null;
}

/** Validates the only account presence shape permitted across the boundary. */
function isValidAccount(value: unknown): value is CodexDeviceAccount {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes("type") &&
    keys.includes("present") &&
    value.type === "chatgpt" &&
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
    value !== url.href ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.origin === "null" ||
    !OFFICIAL_CODEX_VERIFICATION_URLS.includes(
      url.href as (typeof OFFICIAL_CODEX_VERIFICATION_URLS)[number]
    )
  ) {
    throw new TypeError(
      "officialVerificationUrl must match the Codex verification allowlist"
    );
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
function isValidScope(scope: unknown): scope is CodexDeviceScope {
  if (
    !isPlainObject(scope) ||
    !hasExactKeys(scope, ["ownerId", "connectionId", "requestId"])
  ) {
    return false;
  }
  return [scope.ownerId, scope.connectionId, scope.requestId].every(
    (value) =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_IDENTIFIER_LENGTH
  );
}

/** Recognizes the fixed entropy and alphabet of server-generated IDs. */
function isValidCeremonyId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
}

/** Calls a server-owned identifier generator without reflecting its failure. */
function safelyCreateOpaqueId(generator: () => string): string | null {
  try {
    const value = generator();
    return isValidCeremonyId(value) ? value : null;
  } catch {
    return null;
  }
}

/** Recognizes finite nonnegative millisecond timestamps. */
function isValidTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
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
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Requires an exact envelope key set at every injected runtime boundary. */
function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  try {
    const keys = Object.keys(value);
    return (
      keys.length === expected.length &&
      expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    );
  } catch {
    return false;
  }
}

export {
  type CancelCeremonyOutcome,
  type ClaimCleanupOutcome,
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
  type CompleteCleanupOutcome,
  type CompletePollOutcome,
  createCodexDeviceFlow,
  type PreparePollOutcome,
  type RecordBeginOutcome,
  type ReserveCeremonyOutcome,
};
