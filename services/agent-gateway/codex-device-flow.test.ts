import { describe, expect, it, vi } from "vitest";

import {
  type CancelCeremonyOutcome,
  type ClaimCleanupOutcome,
  type CodexDeviceCeremonyRecord,
  type CodexDeviceCeremonyStore,
  type CodexDeviceClient,
  type CodexDeviceClientBeginOutcome,
  type CodexDevicePollCompletion,
  type CodexDeviceScope,
  type CompleteCleanupOutcome,
  type CompletePollOutcome,
  createCodexDeviceFlow,
  type PreparePollOutcome,
  type RecordBeginOutcome,
  type ReserveCeremonyOutcome,
} from "./codex-device-flow.ts";
import type { ControlPlaneOperationContext } from "./control-plane.ts";

const OFFICIAL_URL = "https://auth.openai.com/codex/device";
const SECRET_CANARY = "sk-secret-must-never-cross-browser-boundary";
const OWNER_A: CodexDeviceScope = {
  ownerId: "owner_a",
  connectionId: "connection_a",
  requestId: "request_a",
};

/** Mutable clock for exact poll and expiry boundary tests. */
class TestClock {
  constructor(public nowMilliseconds = 1_900_000_000_000) {}

  advance(milliseconds: number): void {
    this.nowMilliseconds += milliseconds;
  }
}

/** Minimal atomic store model used to exercise the public store contract. */
class TestCeremonyStore implements CodexDeviceCeremonyStore {
  readonly records = new Map<string, CodexDeviceCeremonyRecord>();

  async reserve(
    input: Parameters<CodexDeviceCeremonyStore["reserve"]>[0],
    _context: ControlPlaneOperationContext
  ): Promise<ReserveCeremonyOutcome> {
    for (const [id, record] of Array.from(this.records.entries())) {
      if (record.connectionId !== input.scope.connectionId) continue;
      const current = this.expire(record, input.nowMilliseconds);
      this.records.set(id, current);
      if (!isActive(current.status)) continue;
      if (current.ownerId !== input.scope.ownerId) {
        return { status: "not_found" };
      }
      if (current.requestId === input.scope.requestId) {
        return { status: "same_request", record: current };
      }
      return { status: "active_other_request" };
    }
    if (this.records.has(input.ceremonyId)) return { status: "id_collision" };
    const record: CodexDeviceCeremonyRecord = {
      ceremonyId: input.ceremonyId,
      ...input.scope,
      status: "starting",
      createdAtMilliseconds: input.nowMilliseconds,
      expiresAtMilliseconds: input.expiresAtMilliseconds,
      pollIntervalMilliseconds: input.pollIntervalMilliseconds,
      nextPollAtMilliseconds:
        input.nowMilliseconds + input.pollIntervalMilliseconds,
      revision: 1,
      providerBeginKey: input.providerBeginKey,
      cleanupSessionRefs: [],
    };
    this.records.set(input.ceremonyId, record);
    return { status: "reserved", record };
  }

  async recordBegin(
    input: Parameters<CodexDeviceCeremonyStore["recordBegin"]>[0],
    _context: ControlPlaneOperationContext
  ): Promise<RecordBeginOutcome> {
    const record = this.scoped(input.ceremonyId, input.scope);
    if (!record) return { status: "not_found" } as const;
    if (record.providerBeginKey !== input.providerBeginKey) {
      return { status: "not_found" };
    }
    const current = this.expire(record, input.nowMilliseconds);
    if (current.status !== "starting") {
      if (
        current.status === "pending" &&
        current.providerSessionRef === input.providerSessionRef
      ) {
        this.records.set(input.ceremonyId, current);
        return { status: "current", record: current };
      }
      const retained = this.retainCleanup(current, input.providerSessionRef);
      this.records.set(input.ceremonyId, retained);
      return { status: "recorded", record: retained };
    }
    const activated: CodexDeviceCeremonyRecord = {
      ...current,
      status: "pending",
      userCode: input.userCode,
      providerSessionRef: input.providerSessionRef,
      revision: current.revision + 1,
    };
    this.records.set(input.ceremonyId, activated);
    return { status: "recorded", record: activated };
  }

  async preparePoll(
    input: Parameters<CodexDeviceCeremonyStore["preparePoll"]>[0],
    _context: ControlPlaneOperationContext
  ): Promise<PreparePollOutcome> {
    const record = this.scoped(input.ceremonyId, input.scope);
    if (!record) return { status: "not_found" };
    const current = this.expire(record, input.nowMilliseconds);
    this.records.set(input.ceremonyId, current);
    if (
      current.status !== "pending" ||
      input.nowMilliseconds < current.nextPollAtMilliseconds ||
      !current.providerSessionRef
    ) {
      return { status: "current", record: current };
    }
    const granted: CodexDeviceCeremonyRecord = {
      ...current,
      nextPollAtMilliseconds:
        input.nowMilliseconds + current.pollIntervalMilliseconds,
      revision: current.revision + 1,
    };
    this.records.set(input.ceremonyId, granted);
    return {
      status: "granted",
      record: granted,
      pollRevision: granted.revision,
      providerSessionRef: current.providerSessionRef,
    };
  }

  async completePoll(
    input: Parameters<CodexDeviceCeremonyStore["completePoll"]>[0],
    _context: ControlPlaneOperationContext
  ): Promise<CompletePollOutcome> {
    const record = this.scoped(input.ceremonyId, input.scope);
    if (!record) return { status: "not_found" };
    const current = this.expire(record, input.nowMilliseconds);
    if (
      current.status !== "pending" ||
      current.revision !== input.pollRevision
    ) {
      this.records.set(input.ceremonyId, current);
      return { status: "stale", record: current };
    }
    const completed = applyCompletion(current, input.completion);
    this.records.set(input.ceremonyId, completed);
    return { status: "completed", record: completed };
  }

  async cancel(
    input: Parameters<CodexDeviceCeremonyStore["cancel"]>[0],
    _context: ControlPlaneOperationContext
  ): Promise<CancelCeremonyOutcome> {
    const record = this.scoped(input.ceremonyId, input.scope);
    if (!record) return { status: "not_found" };
    const current = this.expire(record, input.nowMilliseconds);
    if (!isActive(current.status)) {
      this.records.set(input.ceremonyId, current);
      return {
        status: "current",
        record: current,
      };
    }
    const cancelled: CodexDeviceCeremonyRecord = {
      ...current,
      status: "cancelled",
      cleanupSessionRefs: current.providerSessionRef
        ? uniqueRefs(current.cleanupSessionRefs, current.providerSessionRef)
        : current.cleanupSessionRefs,
      revision: current.revision + 1,
    };
    this.records.set(input.ceremonyId, cancelled);
    return {
      status: "cancelled",
      record: cancelled,
    };
  }

  async claimCleanup(
    input: Parameters<CodexDeviceCeremonyStore["claimCleanup"]>[0],
    _context: ControlPlaneOperationContext
  ): Promise<ClaimCleanupOutcome> {
    const record = this.scoped(input.ceremonyId, input.scope);
    if (!record) return { status: "not_found" };
    const current = this.expire(record, input.nowMilliseconds);
    this.records.set(input.ceremonyId, current);
    const providerSessionRef = current.cleanupSessionRefs[0];
    if (!providerSessionRef) return { status: "current", record: current };
    return {
      status: "granted",
      record: current,
      cleanupRevision: current.revision,
      providerBeginKey: current.providerBeginKey,
      providerSessionRef,
    };
  }

  async completeCleanup(
    input: Parameters<CodexDeviceCeremonyStore["completeCleanup"]>[0],
    _context: ControlPlaneOperationContext
  ): Promise<CompleteCleanupOutcome> {
    const record = this.scoped(input.ceremonyId, input.scope);
    if (!record) return { status: "not_found" };
    if (
      record.revision !== input.cleanupRevision ||
      !record.cleanupSessionRefs.includes(input.providerSessionRef)
    ) {
      return { status: "current", record };
    }
    const completed: CodexDeviceCeremonyRecord = {
      ...record,
      cleanupSessionRefs: record.cleanupSessionRefs.filter(
        (value) => value !== input.providerSessionRef
      ),
      revision: record.revision + 1,
    };
    this.records.set(input.ceremonyId, completed);
    return { status: "completed", record: completed };
  }

  /** Returns a record only when every caller-bound scope component matches. */
  private scoped(
    ceremonyId: string,
    scope: CodexDeviceScope
  ): CodexDeviceCeremonyRecord | undefined {
    const record = this.records.get(ceremonyId);
    return record &&
      record.ownerId === scope.ownerId &&
      record.connectionId === scope.connectionId &&
      record.requestId === scope.requestId
      ? record
      : undefined;
  }

  /** Applies expiry atomically before any other transition. */
  private expire(
    record: CodexDeviceCeremonyRecord,
    nowMilliseconds: number
  ): CodexDeviceCeremonyRecord {
    if (
      !isActive(record.status) ||
      nowMilliseconds < record.expiresAtMilliseconds
    ) {
      return record;
    }
    return {
      ...record,
      status: "expired",
      cleanupSessionRefs: record.providerSessionRef
        ? uniqueRefs(record.cleanupSessionRefs, record.providerSessionRef)
        : record.cleanupSessionRefs,
      revision: record.revision + 1,
    };
  }

  /** Retains each race-loser or terminal provider ref exactly once. */
  private retainCleanup(
    record: CodexDeviceCeremonyRecord,
    providerSessionRef: string
  ): CodexDeviceCeremonyRecord {
    const refs = uniqueRefs(record.cleanupSessionRefs, providerSessionRef);
    return refs === record.cleanupSessionRefs
      ? record
      : { ...record, cleanupSessionRefs: refs, revision: record.revision + 1 };
  }
}

/** Appends one cleanup ref without duplicating an idempotent retry. */
function uniqueRefs(
  values: readonly string[],
  value: string
): readonly string[] {
  return values.includes(value) ? values : [...values, value];
}

/** Deterministic injected provider with fully shaped, server-only results. */
class TestDeviceClient implements CodexDeviceClient {
  readonly begin = vi.fn<CodexDeviceClient["begin"]>(
    async (_input, _context): Promise<CodexDeviceClientBeginOutcome> => ({
      providerSessionRef: `provider-session-${SECRET_CANARY}`,
      userCode: "ABCD-1234",
    })
  );
  readonly poll = vi.fn<CodexDeviceClient["poll"]>(
    async (_input, _context): Promise<CodexDevicePollCompletion> => ({
      status: "pending",
    })
  );
  readonly cancel = vi.fn<CodexDeviceClient["cancel"]>(
    async (_input, _context): Promise<void> => undefined
  );
}

/** Creates one coordinator fixture without ambient provider or durable state. */
function createFixture(
  overrides: Partial<{
    client: TestDeviceClient;
    store: CodexDeviceCeremonyStore;
    timeout: number;
    verificationUrl: string;
  }> = {}
) {
  const clock = new TestClock();
  const store = overrides.store ?? new TestCeremonyStore();
  const client = overrides.client ?? new TestDeviceClient();
  let identifier = 0;
  let providerKey = 0;
  const flow = createCodexDeviceFlow({
    client,
    store,
    officialVerificationUrl: overrides.verificationUrl ?? OFFICIAL_URL,
    ceremonyTtlMilliseconds: 60_000,
    pollIntervalMilliseconds: 5_000,
    dependencyTimeoutMilliseconds: overrides.timeout ?? 50,
    now: () => clock.nowMilliseconds,
    createCeremonyId: () => (++identifier).toString().padStart(32, "A"),
    createProviderBeginKey: () => (++providerKey).toString().padStart(32, "K"),
  });
  return { client, clock, flow, store };
}

/** Begins a valid ceremony and narrows its successful result for later steps. */
async function beginCeremony(fixture: ReturnType<typeof createFixture>) {
  const result = await fixture.flow.begin(OWNER_A);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ceremony");
  return result.ceremony;
}

/** Creates a controllable promise for race and late-settlement tests. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

/** Identifies the two nonterminal durable statuses. */
function isActive(status: CodexDeviceCeremonyRecord["status"]): boolean {
  return status === "starting" || status === "pending";
}

/** Applies one validated provider completion to a pending record. */
function applyCompletion(
  record: CodexDeviceCeremonyRecord,
  completion: CodexDevicePollCompletion
): CodexDeviceCeremonyRecord {
  if (completion.status === "pending") return record;
  if (completion.status === "authorized") {
    return {
      ...record,
      status: "authorized",
      account: completion.account,
      revision: record.revision + 1,
    };
  }
  return {
    ...record,
    status: completion.status,
    cleanupSessionRefs: record.providerSessionRef
      ? uniqueRefs(record.cleanupSessionRefs, record.providerSessionRef)
      : record.cleanupSessionRefs,
    revision: record.revision + 1,
  };
}

describe("Codex device ceremony flow", () => {
  it("returns only the fixed safe browser projection", async () => {
    const fixture = createFixture();
    const ceremony = await beginCeremony(fixture);

    expect(ceremony).toEqual({
      ceremonyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1",
      status: "pending",
      verificationUrl: `${OFFICIAL_URL}`,
      expiresAtMilliseconds: fixture.clock.nowMilliseconds + 60_000,
      pollIntervalMilliseconds: 5_000,
      userCode: "ABCD-1234",
    });
    expect(JSON.stringify(ceremony)).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(ceremony)).not.toContain("providerSessionRef");
  });

  it.each([
    "http://auth.openai.com/device",
    "https://user:pass@auth.openai.com/device",
    "https://auth.openai.com/device?token=secret",
    "https://auth.openai.com/device#secret",
    "https://evil.example/phish",
    "https://auth.openai.com.evil.example/codex/device",
    "https://xn--openai-9za.example/codex/device",
    "https://auth.openаi.com/codex/device",
    "https://auth.openai.com\\@evil.example/codex/device",
    "https://auth.openai.com:444/codex/device",
    "https://auth.openai.com:443/codex/device",
    "https://auth.openai.com/codex/device/",
    "https://auth.openai.com/codex/other",
    "https://auth.openai.com/codex%2Fdevice",
    "https://auth.openai.com/codex/device%2Fredirect",
    "https://auth.openai.com/codex/%2e%2e/device",
    `https://auth.openai.com/codex/device?next=${encodeURIComponent(
      "https://evil.example"
    )}`,
    "not a url",
  ])("rejects unsafe server verification URL %s", (verificationUrl) => {
    expect(() => createFixture({ verificationUrl })).toThrow(
      /officialVerificationUrl/
    );
  });

  it("rejects malformed or over-shaped provider begin output", async () => {
    const client = new TestDeviceClient();
    client.begin.mockResolvedValue({
      providerSessionRef: "session",
      userCode: "ABCD-1234",
      token: SECRET_CANARY,
    } as never);
    const { flow } = createFixture({ client });

    await expect(flow.begin(OWNER_A)).resolves.toEqual({
      ok: false,
      error: "provider_unavailable",
    });
  });

  it.each([null, undefined, {}, { providerSessionRef: "session" }])(
    "fails closed for malformed provider begin envelope %#",
    async (malformed) => {
      const client = new TestDeviceClient();
      client.begin.mockResolvedValue(malformed as never);
      const { flow } = createFixture({ client });
      await expect(flow.begin(OWNER_A)).resolves.toEqual({
        ok: false,
        error: "provider_unavailable",
      });
    }
  );

  it.each(["a", "lower-code", "ABCD 1234", "A".repeat(17)])(
    "rejects unsafe user code %s",
    async (userCode) => {
      const client = new TestDeviceClient();
      client.begin.mockResolvedValue({
        providerSessionRef: "session",
        userCode,
      });
      const { flow } = createFixture({ client });
      await expect(flow.begin(OWNER_A)).resolves.toEqual({
        ok: false,
        error: "provider_unavailable",
      });
    }
  );

  it("recovers duplicate same-request begin with one ceremony identity", async () => {
    const fixture = createFixture();
    const first = await fixture.flow.begin(OWNER_A);
    const second = await fixture.flow.begin(OWNER_A);

    expect(first).toEqual(second);
    expect(fixture.client.begin).toHaveBeenCalledTimes(1);
  });

  it("fails closed when another request races the active connection", async () => {
    const fixture = createFixture();
    await beginCeremony(fixture);

    await expect(
      fixture.flow.begin({ ...OWNER_A, requestId: "request_b" })
    ).resolves.toEqual({ ok: false, error: "active_ceremony_exists" });
    expect(fixture.client.begin).toHaveBeenCalledTimes(1);
  });

  it("conceals a cross-owner begin against an active connection", async () => {
    const fixture = createFixture();
    await beginCeremony(fixture);

    await expect(
      fixture.flow.begin({ ...OWNER_A, ownerId: "owner_b" })
    ).resolves.toEqual({ ok: false, error: "not_found" });
    expect(fixture.client.begin).toHaveBeenCalledTimes(1);
  });

  it("allows concurrent same-request begin only through idempotent ceremony ID", async () => {
    const client = new TestDeviceClient();
    const beginGate = deferred<CodexDeviceClientBeginOutcome>();
    client.begin.mockImplementation(() => beginGate.promise);
    const fixture = createFixture({ client });

    const first = fixture.flow.begin(OWNER_A);
    const second = fixture.flow.begin(OWNER_A);
    await vi.waitFor(() => expect(client.begin).toHaveBeenCalledTimes(2));
    expect(client.begin.mock.calls[0]?.[0]).toEqual(
      client.begin.mock.calls[1]?.[0]
    );
    beginGate.resolve({
      providerSessionRef: "same-session",
      userCode: "WXYZ-7890",
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
  });

  it.each([
    { ownerId: "owner_b" },
    { connectionId: "connection_b" },
    { requestId: "request_b" },
  ])(
    "conceals scoped records from $ownerId$connectionId$requestId",
    async (change) => {
      const fixture = createFixture();
      const ceremony = await beginCeremony(fixture);
      const foreignScope = { ...OWNER_A, ...change };

      await expect(
        fixture.flow.poll(foreignScope, ceremony.ceremonyId)
      ).resolves.toEqual({ ok: false, error: "not_found" });
      await expect(
        fixture.flow.cancel(foreignScope, ceremony.ceremonyId)
      ).resolves.toEqual({ ok: false, error: "not_found" });
      expect(fixture.client.poll).not.toHaveBeenCalled();
      expect(fixture.client.cancel).not.toHaveBeenCalled();
    }
  );

  it("conceals guessed and malformed ceremony IDs", async () => {
    const fixture = createFixture();
    await beginCeremony(fixture);
    for (const id of ["B".repeat(32), "../secret", SECRET_CANARY]) {
      await expect(fixture.flow.poll(OWNER_A, id)).resolves.toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  it("throttles provider polls at the durable interval", async () => {
    const fixture = createFixture();
    const ceremony = await beginCeremony(fixture);

    await fixture.flow.poll(OWNER_A, ceremony.ceremonyId);
    expect(fixture.client.poll).not.toHaveBeenCalled();
    fixture.clock.advance(5_000);
    await fixture.flow.poll(OWNER_A, ceremony.ceremonyId);
    await fixture.flow.poll(OWNER_A, ceremony.ceremonyId);
    expect(fixture.client.poll).toHaveBeenCalledTimes(1);
  });

  it("projects only strict account type and presence after authorization", async () => {
    const fixture = createFixture();
    const ceremony = await beginCeremony(fixture);
    fixture.clock.advance(5_000);
    fixture.client.poll.mockResolvedValue({
      status: "authorized",
      account: { type: "chatgpt", present: true },
    });

    const result = await fixture.flow.poll(OWNER_A, ceremony.ceremonyId);
    expect(result).toEqual({
      ok: true,
      ceremony: {
        ceremonyId: ceremony.ceremonyId,
        status: "authorized",
        verificationUrl: `${OFFICIAL_URL}`,
        expiresAtMilliseconds: ceremony.expiresAtMilliseconds,
        pollIntervalMilliseconds: 5_000,
        account: { type: "chatgpt", present: true },
      },
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(result)).not.toContain("userCode");
  });

  it("rejects raw or ambiguous authorized account output", async () => {
    const fixture = createFixture();
    const ceremony = await beginCeremony(fixture);
    fixture.clock.advance(5_000);
    fixture.client.poll.mockResolvedValue({
      status: "authorized",
      account: { type: "chatgpt", present: true, email: SECRET_CANARY },
    } as never);

    await expect(
      fixture.flow.poll(OWNER_A, ceremony.ceremonyId)
    ).resolves.toEqual({ ok: false, error: "provider_unavailable" });
  });

  it("rejects ambient API-key presence as a subscription authorization", async () => {
    const fixture = createFixture();
    const ceremony = await beginCeremony(fixture);
    fixture.clock.advance(5_000);
    fixture.client.poll.mockResolvedValue({
      status: "authorized",
      account: { type: "api_key", present: true },
    } as never);

    const result = await fixture.flow.poll(OWNER_A, ceremony.ceremonyId);
    expect(result).toEqual({ ok: false, error: "provider_unavailable" });
    expect(JSON.stringify(result)).not.toContain("api_key");
  });

  it.each([
    null,
    undefined,
    {},
    { status: "authorized" },
    { status: "mystery" },
  ])(
    "fails closed for malformed provider poll envelope %#",
    async (malformed) => {
      const fixture = createFixture();
      const ceremony = await beginCeremony(fixture);
      fixture.clock.advance(5_000);
      fixture.client.poll.mockResolvedValue(malformed as never);
      await expect(
        fixture.flow.poll(OWNER_A, ceremony.ceremonyId)
      ).resolves.toEqual({ ok: false, error: "provider_unavailable" });
    }
  );

  it("keeps cleanup pending when provider cancel fulfills with a malformed value", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store });
    const ceremony = await beginCeremony(fixture);
    fixture.client.cancel.mockResolvedValue({ secret: SECRET_CANARY } as never);

    const result = await fixture.flow.cancel(OWNER_A, ceremony.ceremonyId);
    expect(result).toEqual({ ok: false, error: "provider_unavailable" });
    expect(store.records.get(ceremony.ceremonyId)?.cleanupSessionRefs).toEqual([
      `provider-session-${SECRET_CANARY}`,
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET_CANARY);
  });

  it("fails closed instead of projecting corrupted durable fields", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store });
    const ceremony = await beginCeremony(fixture);
    const record = store.records.get(ceremony.ceremonyId);
    if (!record) throw new Error("missing durable record");
    store.records.set(ceremony.ceremonyId, {
      ...record,
      userCode: SECRET_CANARY,
    });

    const result = await fixture.flow.poll(OWNER_A, ceremony.ceremonyId);
    expect(result).toEqual({ ok: false, error: "store_unavailable" });
    expect(JSON.stringify(result)).not.toContain(SECRET_CANARY);
  });

  it("fences delayed authorization after cancellation", async () => {
    const fixture = createFixture();
    const ceremony = await beginCeremony(fixture);
    const pollGate = deferred<CodexDevicePollCompletion>();
    fixture.client.poll.mockImplementation(() => pollGate.promise);
    fixture.clock.advance(5_000);

    const poll = fixture.flow.poll(OWNER_A, ceremony.ceremonyId);
    await vi.waitFor(() => expect(fixture.client.poll).toHaveBeenCalledOnce());
    await expect(
      fixture.flow.cancel(OWNER_A, ceremony.ceremonyId)
    ).resolves.toMatchObject({ ok: true, ceremony: { status: "cancelled" } });
    pollGate.resolve({
      status: "authorized",
      account: { type: "chatgpt", present: true },
    });
    await expect(poll).resolves.toMatchObject({
      ok: true,
      ceremony: { status: "cancelled" },
    });
  });

  it("fences and cleans up delayed begin after cancellation", async () => {
    const client = new TestDeviceClient();
    const beginGate = deferred<CodexDeviceClientBeginOutcome>();
    client.begin.mockImplementation(() => beginGate.promise);
    const fixture = createFixture({ client });
    const begin = fixture.flow.begin(OWNER_A);
    await vi.waitFor(() => expect(client.begin).toHaveBeenCalledOnce());
    const ceremonyId = client.begin.mock.calls[0]?.[0].ceremonyId;

    await expect(
      fixture.flow.cancel(OWNER_A, ceremonyId)
    ).resolves.toMatchObject({
      ok: true,
      ceremony: { status: "cancelled" },
    });
    beginGate.resolve({
      providerSessionRef: "late-provider-session",
      userCode: "ABCD-1234",
    });
    await expect(begin).resolves.toMatchObject({
      ok: true,
      ceremony: { status: "cancelled" },
    });
    expect(client.cancel).toHaveBeenCalledWith(
      {
        ceremonyId,
        providerBeginKey: "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK1",
        providerSessionRef: "late-provider-session",
      },
      expect.any(Object)
    );
  });

  it("retains and cleans a delayed begin result after exact expiry", async () => {
    const client = new TestDeviceClient();
    const beginGate = deferred<CodexDeviceClientBeginOutcome>();
    client.begin.mockImplementation(() => beginGate.promise);
    const fixture = createFixture({ client });
    const begin = fixture.flow.begin(OWNER_A);
    await vi.waitFor(() => expect(client.begin).toHaveBeenCalledOnce());
    const ceremonyId = client.begin.mock.calls[0]?.[0].ceremonyId;
    fixture.clock.advance(60_000);

    await expect(fixture.flow.poll(OWNER_A, ceremonyId)).resolves.toMatchObject(
      {
        ok: true,
        ceremony: { status: "expired" },
      }
    );
    beginGate.resolve({
      providerSessionRef: "late-expired-session",
      userCode: "ABCD-1234",
    });
    await expect(begin).resolves.toMatchObject({
      ok: true,
      ceremony: { status: "expired" },
    });
    expect(client.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionRef: "late-expired-session" }),
      expect.any(Object)
    );
  });

  it.each(["timeout", "rejection"] as const)(
    "keeps cleanup durable after provider %s and lets a fresh manager retry",
    async (failureMode) => {
      const store = new TestCeremonyStore();
      const client = new TestDeviceClient();
      const beginGate = deferred<CodexDeviceClientBeginOutcome>();
      const cleanupGate = deferred<void>();
      client.begin.mockImplementation(() => beginGate.promise);
      if (failureMode === "timeout") {
        client.cancel.mockImplementationOnce(() => cleanupGate.promise);
      } else {
        client.cancel.mockRejectedValueOnce(new Error(SECRET_CANARY));
      }
      const fixture = createFixture({ client, store, timeout: 20 });
      const begin = fixture.flow.begin(OWNER_A);
      await vi.waitFor(() => expect(client.begin).toHaveBeenCalledOnce(), {
        interval: 1,
        timeout: 10,
      });
      const ceremonyId = client.begin.mock.calls[0]?.[0].ceremonyId;
      await fixture.flow.cancel(OWNER_A, ceremonyId);
      beginGate.resolve({
        providerSessionRef: "durable-cleanup-session",
        userCode: "ABCD-1234",
      });
      await expect(begin).resolves.toMatchObject({
        ok: false,
        error: failureMode === "timeout" ? "timed_out" : "provider_unavailable",
      });
      expect(store.records.get(ceremonyId)?.cleanupSessionRefs).toContain(
        "durable-cleanup-session"
      );

      client.cancel.mockResolvedValue(undefined);
      const freshManager = createFixture({ client, store });
      await expect(
        freshManager.flow.cancel(OWNER_A, ceremonyId)
      ).resolves.toMatchObject({
        ok: true,
        ceremony: { status: "cancelled" },
      });
      expect(store.records.get(ceremonyId)?.cleanupSessionRefs).toEqual([]);
      cleanupGate.resolve();
    }
  );

  it("cleans a distinct session ref returned by a broken concurrent begin loser", async () => {
    const store = new TestCeremonyStore();
    const client = new TestDeviceClient();
    client.begin
      .mockResolvedValueOnce({
        providerSessionRef: "race-session-a",
        userCode: "ABCD-1234",
      })
      .mockResolvedValueOnce({
        providerSessionRef: "race-session-b",
        userCode: "ABCD-1234",
      });
    const fixture = createFixture({ client, store });
    const [first, second] = await Promise.all([
      fixture.flow.begin(OWNER_A),
      fixture.flow.begin(OWNER_A),
    ]);
    expect(first).toMatchObject({ ok: true, ceremony: { status: "pending" } });
    expect(second).toMatchObject({ ok: true, ceremony: { status: "pending" } });
    const record = Array.from(store.records.values())[0];
    const active = record?.providerSessionRef;
    const loser =
      active === "race-session-a" ? "race-session-b" : "race-session-a";
    expect(
      client.cancel.mock.calls.map(([input]) => input.providerSessionRef)
    ).toContain(loser);
    expect(record?.cleanupSessionRefs).toEqual([]);
  });

  it("fences delayed authorization at the exact expiry boundary", async () => {
    const fixture = createFixture();
    const ceremony = await beginCeremony(fixture);
    const pollGate = deferred<CodexDevicePollCompletion>();
    fixture.client.poll.mockImplementation(() => pollGate.promise);
    fixture.clock.advance(5_000);
    const poll = fixture.flow.poll(OWNER_A, ceremony.ceremonyId);
    await vi.waitFor(() => expect(fixture.client.poll).toHaveBeenCalledOnce());
    fixture.clock.advance(55_000);
    pollGate.resolve({
      status: "authorized",
      account: { type: "chatgpt", present: true },
    });
    await expect(poll).resolves.toMatchObject({
      ok: true,
      ceremony: { status: "expired" },
    });
  });

  it("makes repeated cancellation terminal without repeating completed cleanup", async () => {
    const fixture = createFixture();
    const ceremony = await beginCeremony(fixture);
    const first = await fixture.flow.cancel(OWNER_A, ceremony.ceremonyId);
    const second = await fixture.flow.cancel(OWNER_A, ceremony.ceremonyId);

    expect(first).toEqual(second);
    expect(fixture.client.cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["store", "store_unavailable"],
    ["provider", "provider_unavailable"],
  ] as const)(
    "maps opaque %s failures to a stable unavailable result",
    async (kind, code) => {
      const fixture = createFixture();
      if (kind === "store") {
        vi.spyOn(fixture.store, "reserve").mockRejectedValue(
          new Error(SECRET_CANARY)
        );
      } else {
        fixture.client.begin.mockRejectedValue(new Error(SECRET_CANARY));
      }
      const result = await fixture.flow.begin(OWNER_A);
      expect(result).toEqual({ ok: false, error: code });
      expect(JSON.stringify(result)).not.toContain(SECRET_CANARY);
    }
  );

  it.each([
    null,
    undefined,
    { status: "mystery" },
    { status: "reserved" },
    { status: "reserved", record: null },
    { status: "reserved", record: { providerBeginKey: SECRET_CANARY } },
  ])("fails closed for malformed reserve envelope %#", async (malformed) => {
    const store = new TestCeremonyStore();
    vi.spyOn(store, "reserve").mockResolvedValue(malformed as never);
    const { flow } = createFixture({ store });
    await expect(flow.begin(OWNER_A)).resolves.toEqual({
      ok: false,
      error: "store_unavailable",
    });
  });

  it("fails closed for hostile store envelope accessors", async () => {
    const store = new TestCeremonyStore();
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error(SECRET_CANARY);
        },
      }
    );
    vi.spyOn(store, "reserve").mockResolvedValue(hostile as never);
    const { flow } = createFixture({ store });
    const result = await flow.begin(OWNER_A);
    expect(result).toEqual({ ok: false, error: "store_unavailable" });
    expect(JSON.stringify(result)).not.toContain(SECRET_CANARY);
  });

  it("fails closed for null or malformed runtime scope", async () => {
    const fixture = createFixture();
    await expect(fixture.flow.begin(null as never)).resolves.toEqual({
      ok: false,
      error: "not_found",
    });
    await expect(
      fixture.flow.begin({ ownerId: SECRET_CANARY } as never)
    ).resolves.toEqual({ ok: false, error: "not_found" });
    await expect(
      fixture.flow.begin({
        ...OWNER_A,
        verificationUrl: "https://evil.example/phish",
      } as never)
    ).resolves.toEqual({ ok: false, error: "not_found" });
    expect(fixture.client.begin).not.toHaveBeenCalled();
  });

  it("fails closed for malformed begin-result store envelopes", async () => {
    const store = new TestCeremonyStore();
    vi.spyOn(store, "recordBegin").mockResolvedValue({
      status: "recorded",
    } as never);
    const { flow } = createFixture({ store });
    await expect(flow.begin(OWNER_A)).resolves.toEqual({
      ok: false,
      error: "store_unavailable",
    });
  });

  it("fails closed for malformed prepare-poll store envelopes", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store });
    const ceremony = await beginCeremony(fixture);
    vi.spyOn(store, "preparePoll").mockResolvedValue(undefined as never);
    await expect(
      fixture.flow.poll(OWNER_A, ceremony.ceremonyId)
    ).resolves.toEqual({ ok: false, error: "store_unavailable" });
  });

  it("fails closed for malformed complete-poll store envelopes", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store });
    const ceremony = await beginCeremony(fixture);
    fixture.clock.advance(5_000);
    vi.spyOn(store, "completePoll").mockResolvedValue({
      status: "completed",
    } as never);
    await expect(
      fixture.flow.poll(OWNER_A, ceremony.ceremonyId)
    ).resolves.toEqual({ ok: false, error: "store_unavailable" });
  });

  it("fails closed for malformed cancel store envelopes", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store });
    const ceremony = await beginCeremony(fixture);
    vi.spyOn(store, "cancel").mockResolvedValue({
      status: "unexpected",
    } as never);
    await expect(
      fixture.flow.cancel(OWNER_A, ceremony.ceremonyId)
    ).resolves.toEqual({ ok: false, error: "store_unavailable" });
  });

  it("fails closed for malformed cleanup-claim store envelopes", async () => {
    const store = new TestCeremonyStore();
    vi.spyOn(store, "claimCleanup").mockResolvedValue({
      status: "granted",
    } as never);
    const { flow } = createFixture({ store });
    await expect(flow.begin(OWNER_A)).resolves.toEqual({
      ok: false,
      error: "store_unavailable",
    });
  });

  it("fails closed for malformed cleanup-completion store envelopes", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store });
    const ceremony = await beginCeremony(fixture);
    vi.spyOn(store, "completeCleanup").mockResolvedValue(null as never);
    await expect(
      fixture.flow.cancel(OWNER_A, ceremony.ceremonyId)
    ).resolves.toEqual({ ok: false, error: "store_unavailable" });
  });

  it.each(["store", "provider"] as const)(
    "bounds and aborts stalled %s operations while observing late rejection",
    async (kind) => {
      const fixture = createFixture({ timeout: 5 });
      const gate = deferred<never>();
      let context: ControlPlaneOperationContext | undefined;
      if (kind === "store") {
        vi.spyOn(fixture.store, "reserve").mockImplementation(
          (_input, value) => {
            context = value;
            return gate.promise;
          }
        );
      } else {
        fixture.client.begin.mockImplementation((_input, value) => {
          context = value;
          return gate.promise;
        });
      }
      await expect(fixture.flow.begin(OWNER_A)).resolves.toEqual({
        ok: false,
        error: "timed_out",
      });
      expect(context?.signal.aborted).toBe(true);
      gate.reject(new Error(SECRET_CANARY));
      await Promise.resolve();
    }
  );

  it("aborts before calling an injected dependency", async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    controller.abort(SECRET_CANARY);
    await expect(
      fixture.flow.begin(OWNER_A, controller.signal)
    ).resolves.toEqual({
      ok: false,
      error: "aborted",
    });
    expect(fixture.client.begin).not.toHaveBeenCalled();
  });

  it("terminalizes caller abort while independently retaining and cleaning late begin", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store });
    const gate = deferred<CodexDeviceClientBeginOutcome>();
    let context: ControlPlaneOperationContext | undefined;
    fixture.client.begin.mockImplementation((_input, value) => {
      context = value;
      return gate.promise;
    });
    const controller = new AbortController();
    const begin = fixture.flow.begin(OWNER_A, controller.signal);
    await vi.waitFor(() => expect(fixture.client.begin).toHaveBeenCalledOnce());
    controller.abort(SECRET_CANARY);

    await expect(begin).resolves.toEqual({ ok: false, error: "aborted" });
    expect(context?.signal.aborted).toBe(false);
    expect(context?.signal.reason).not.toBe(SECRET_CANARY);
    gate.resolve({
      providerSessionRef: "caller-abort-session",
      userCode: "ABCD-1234",
    });
    await vi.waitFor(() =>
      expect(fixture.client.cancel).toHaveBeenCalledWith(
        expect.objectContaining({ providerSessionRef: "caller-abort-session" }),
        expect.any(Object)
      )
    );
    const record = Array.from(store.records.values())[0];
    expect(record).toMatchObject({
      status: "cancelled",
      cleanupSessionRefs: [],
    });
  });

  it("retries an initially failed abort transition after the begin ref is durable", async () => {
    const store = new TestCeremonyStore();
    vi.spyOn(store, "cancel").mockRejectedValueOnce(new Error(SECRET_CANARY));
    const fixture = createFixture({ store });
    const gate = deferred<CodexDeviceClientBeginOutcome>();
    fixture.client.begin.mockImplementation(() => gate.promise);
    const controller = new AbortController();
    const begin = fixture.flow.begin(OWNER_A, controller.signal);
    await vi.waitFor(() => expect(fixture.client.begin).toHaveBeenCalledOnce());
    controller.abort(SECRET_CANARY);
    await expect(begin).resolves.toEqual({ ok: false, error: "aborted" });

    gate.resolve({
      providerSessionRef: "abort-retry-session",
      userCode: "ABCD-1234",
    });
    await vi.waitFor(() => {
      const record = Array.from(store.records.values())[0];
      expect(record).toMatchObject({
        status: "cancelled",
        cleanupSessionRefs: [],
      });
    });
    expect(fixture.client.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionRef: "abort-retry-session" }),
      expect.any(Object)
    );
  });

  it("recovers an ambiguous late reserve on a same-request retry", async () => {
    const store = new TestCeremonyStore();
    const originalReserve = store.reserve.bind(store);
    const gate = deferred<ReserveCeremonyOutcome>();
    vi.spyOn(store, "reserve").mockImplementationOnce(
      async (input, context) => {
        const committed = await originalReserve(input, context);
        await gate.promise;
        return committed;
      }
    );
    const fixture = createFixture({ store, timeout: 5 });
    await expect(fixture.flow.begin(OWNER_A)).resolves.toEqual({
      ok: false,
      error: "timed_out",
    });
    gate.resolve({ status: "id_collision" });
    const retry = await fixture.flow.begin(OWNER_A);
    expect(retry).toMatchObject({ ok: true, ceremony: { status: "pending" } });
  });

  it("recovers an ambiguous begin-result commit without another provider begin", async () => {
    const store = new TestCeremonyStore();
    const originalRecordBegin = store.recordBegin.bind(store);
    const gate = deferred<void>();
    vi.spyOn(store, "recordBegin").mockImplementationOnce(
      async (input, context) => {
        const committed = await originalRecordBegin(input, context);
        await gate.promise;
        return committed;
      }
    );
    const fixture = createFixture({ store, timeout: 5 });
    await expect(fixture.flow.begin(OWNER_A)).resolves.toEqual({
      ok: false,
      error: "timed_out",
    });
    gate.resolve();

    const retry = await fixture.flow.begin(OWNER_A);
    expect(retry).toMatchObject({ ok: true, ceremony: { status: "pending" } });
    expect(fixture.client.begin).toHaveBeenCalledTimes(1);
  });

  it("recovers an uncommitted begin-result timeout with the persisted idempotency key", async () => {
    const store = new TestCeremonyStore();
    const client = new TestDeviceClient();
    const storeGate = deferred<RecordBeginOutcome>();
    vi.spyOn(store, "recordBegin").mockImplementationOnce(
      () => storeGate.promise
    );
    const fixture = createFixture({ client, store, timeout: 5 });
    await expect(fixture.flow.begin(OWNER_A)).resolves.toEqual({
      ok: false,
      error: "timed_out",
    });
    storeGate.reject(new Error(SECRET_CANARY));

    await expect(fixture.flow.begin(OWNER_A)).resolves.toMatchObject({
      ok: true,
      ceremony: { status: "pending" },
    });
    expect(client.begin).toHaveBeenCalledTimes(2);
    expect(client.begin.mock.calls[0]?.[0]).toEqual(
      client.begin.mock.calls[1]?.[0]
    );
  });

  it("recovers an ambiguous poll completion from durable authorized state", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store, timeout: 5 });
    const ceremony = await beginCeremony(fixture);
    fixture.clock.advance(5_000);
    fixture.client.poll.mockResolvedValue({
      status: "authorized",
      account: { type: "chatgpt", present: true },
    });
    const originalComplete = store.completePoll.bind(store);
    const gate = deferred<void>();
    vi.spyOn(store, "completePoll").mockImplementationOnce(
      async (input, context) => {
        const committed = await originalComplete(input, context);
        await gate.promise;
        return committed;
      }
    );

    await expect(
      fixture.flow.poll(OWNER_A, ceremony.ceremonyId)
    ).resolves.toEqual({ ok: false, error: "timed_out" });
    gate.resolve();
    await expect(
      fixture.flow.poll(OWNER_A, ceremony.ceremonyId)
    ).resolves.toMatchObject({
      ok: true,
      ceremony: { status: "authorized" },
    });
    expect(fixture.client.poll).toHaveBeenCalledTimes(1);
  });

  it("recovers an ambiguous cancellation commit idempotently", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store, timeout: 5 });
    const ceremony = await beginCeremony(fixture);
    const originalCancel = store.cancel.bind(store);
    const gate = deferred<void>();
    vi.spyOn(store, "cancel").mockImplementationOnce(async (input, context) => {
      const committed = await originalCancel(input, context);
      await gate.promise;
      return committed;
    });

    await expect(
      fixture.flow.cancel(OWNER_A, ceremony.ceremonyId)
    ).resolves.toEqual({ ok: false, error: "timed_out" });
    gate.resolve();
    await expect(
      fixture.flow.cancel(OWNER_A, ceremony.ceremonyId)
    ).resolves.toMatchObject({
      ok: true,
      ceremony: { status: "cancelled" },
    });
  });

  it("recovers an ambiguous cleanup completion without repeating provider cleanup", async () => {
    const store = new TestCeremonyStore();
    const fixture = createFixture({ store, timeout: 5 });
    const ceremony = await beginCeremony(fixture);
    const originalCompleteCleanup = store.completeCleanup.bind(store);
    const gate = deferred<void>();
    vi.spyOn(store, "completeCleanup").mockImplementationOnce(
      async (input, context) => {
        const committed = await originalCompleteCleanup(input, context);
        await gate.promise;
        return committed;
      }
    );

    await expect(
      fixture.flow.cancel(OWNER_A, ceremony.ceremonyId)
    ).resolves.toEqual({ ok: false, error: "timed_out" });
    gate.resolve();
    const freshManager = createFixture({ client: fixture.client, store });
    await expect(
      freshManager.flow.cancel(OWNER_A, ceremony.ceremonyId)
    ).resolves.toMatchObject({
      ok: true,
      ceremony: { status: "cancelled" },
    });
    expect(fixture.client.cancel).toHaveBeenCalledTimes(1);
  });

  it("does not accept caller-selected URLs, commands, models, homes, or env", async () => {
    const fixture = createFixture();
    await beginCeremony(fixture);
    const beginInput = fixture.client.begin.mock.calls[0]?.[0];
    expect(beginInput).toEqual({
      ceremonyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1",
      providerBeginKey: "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK1",
    });
    expect(JSON.stringify(beginInput)).not.toMatch(
      /url|command|model|home|env/i
    );
  });
});
