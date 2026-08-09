import { generateKeyPairSync, sign as signBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ControlPlaneOperationContext } from "./control-plane.ts";
import {
  type ExpectedLifecycleEvidenceContext,
  issueLifecycleEvidence,
  type LifecycleEvidenceClock,
  LifecycleEvidenceError,
  type LifecycleEvidenceMetadata,
  type LifecycleEvidenceReplayDefense,
  type LifecycleEvidenceSigningKey,
  type LifecycleEvidenceVerificationKeys,
  LifecycleReplayDefenseError,
  type LifecycleReplayEntry,
  type LifecycleTransition,
  type ServerLifecycleDecision,
  verifyLifecycleEvidence,
} from "./lifecycle-evidence.ts";

const BASE_TIME = 1_800_000_000;

/** Mutable deterministic clock for exact validity-boundary tests. */
class TestClock implements LifecycleEvidenceClock {
  constructor(private current = BASE_TIME) {}

  nowSeconds(): number {
    return this.current;
  }

  set(nowSeconds: number): void {
    this.current = nowSeconds;
  }
}

/** Minimal atomic replay store used to prove identifier consumption order. */
class MemoryReplayDefense implements LifecycleEvidenceReplayDefense {
  readonly entries: LifecycleReplayEntry[] = [];

  consume(entry: LifecycleReplayEntry): void {
    if (
      this.entries.some(
        (existing) =>
          existing.evidenceId === entry.evidenceId ||
          existing.nonce === entry.nonce
      )
    ) {
      throw new LifecycleReplayDefenseError("replay_detected");
    }
    this.entries.push(entry);
  }
}

/** Creates an isolated Ed25519 key pair with a stable identifier. */
function createKeyPair(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    signing: { keyId, privateKey } satisfies LifecycleEvidenceSigningKey,
    verification: { keyId, publicKey },
  };
}

/** Builds one fully isolated signer/verifier fixture. */
function createFixture() {
  const clock = new TestClock();
  const current = createKeyPair("lifecycle-current");
  const previous = createKeyPair("lifecycle-previous");
  const expected: ExpectedLifecycleEvidenceContext = {
    issuer: "sprig-agent-gateway",
    audience: "sprig-trusted-server",
    subject: "user_owner_a",
    connectionId: "connection_a",
    provider: "codex",
    requestId: "request_a",
    transition: "pending_to_connected",
    credentialRevision: 1,
  };
  const verificationKeys: LifecycleEvidenceVerificationKeys = {
    current: current.verification,
    previous: previous.verification,
  };
  return { clock, current, expected, previous, verificationKeys };
}

/** Returns the safe successful-account projection required by connected evidence. */
function connectedMetadata(
  overrides: Partial<LifecycleEvidenceMetadata> = {}
): LifecycleEvidenceMetadata {
  return {
    gatewayCredentialId: "gateway_opaque_a",
    account: { type: "chatgpt", present: true },
    planLabel: "Plus",
    errorCode: null,
    ...overrides,
  };
}

/** Returns a complete signer decision with unique replay identifiers. */
function decision(
  fixture: ReturnType<typeof createFixture>,
  overrides: Partial<ServerLifecycleDecision> = {}
): ServerLifecycleDecision {
  return {
    issuer: fixture.expected.issuer,
    audience: fixture.expected.audience,
    subject: fixture.expected.subject,
    connectionId: fixture.expected.connectionId,
    requestId: fixture.expected.requestId,
    evidenceId: "evidence_a",
    nonce: "nonce_a",
    transition: fixture.expected.transition,
    credentialRevision: fixture.expected.credentialRevision,
    metadata: connectedMetadata(),
    ...overrides,
  };
}

/** Issues evidence through the production signer. */
function issue(
  fixture: ReturnType<typeof createFixture>,
  overrides: Partial<ServerLifecycleDecision> = {},
  signingKey = fixture.current.signing
): string {
  return issueLifecycleEvidence(
    decision(fixture, overrides),
    signingKey,
    fixture.clock
  );
}

/** Verifies evidence with a fresh replay store unless one is supplied. */
function verify(
  fixture: ReturnType<typeof createFixture>,
  token: string | null | undefined,
  overrides: Partial<{
    expected: ExpectedLifecycleEvidenceContext;
    replayDefense: LifecycleEvidenceReplayDefense;
    replayDefenseTimeoutMs: number;
    signal: AbortSignal;
    verificationKeys: LifecycleEvidenceVerificationKeys;
  }> = {}
) {
  return verifyLifecycleEvidence(token, {
    clock: fixture.clock,
    expected: overrides.expected ?? fixture.expected,
    replayDefense: overrides.replayDefense ?? new MemoryReplayDefense(),
    verificationKeys: overrides.verificationKeys ?? fixture.verificationKeys,
    replayDefenseTimeoutMs: overrides.replayDefenseTimeoutMs,
    signal: overrides.signal,
  });
}

/** Signs pre-encoded segments to test authenticated malformed payloads. */
function signSegments(
  encodedHeader: string,
  encodedClaims: string,
  signingKey: LifecycleEvidenceSigningKey
): string {
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = signBytes(
    null,
    Buffer.from(signingInput),
    signingKey.privateKey
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

/** Re-signs a controlled payload mutation in original property order. */
function resignClaims(
  token: string,
  signingKey: LifecycleEvidenceSigningKey,
  mutate: (claims: Record<string, unknown>) => void
): string {
  const [encodedHeader, encodedClaims] = token.split(".");
  const claims = JSON.parse(
    Buffer.from(encodedClaims, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  mutate(claims);
  return signSegments(
    encodedHeader,
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    signingKey
  );
}

/** Re-signs a controlled protected-header mutation. */
function resignHeader(
  token: string,
  signingKey: LifecycleEvidenceSigningKey,
  mutate: (header: Record<string, unknown>) => void
): string {
  const [encodedHeader, encodedClaims] = token.split(".");
  const header = JSON.parse(
    Buffer.from(encodedHeader, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  mutate(header);
  return signSegments(
    Buffer.from(JSON.stringify(header)).toString("base64url"),
    encodedClaims,
    signingKey
  );
}

/** Captures one stable protocol error and rejects unrelated failures. */
async function expectCode(
  action: () => unknown | Promise<unknown>,
  code: LifecycleEvidenceError["code"]
): Promise<LifecycleEvidenceError> {
  try {
    await action();
    throw new Error("Expected LifecycleEvidenceError");
  } catch (error) {
    expect(error).toBeInstanceOf(LifecycleEvidenceError);
    expect((error as LifecycleEvidenceError).code).toBe(code);
    return error as LifecycleEvidenceError;
  }
}

describe("gateway lifecycle evidence", () => {
  it("issues and verifies the exact Codex-first v1 projection", async () => {
    const fixture = createFixture();
    const replayDefense = new MemoryReplayDefense();
    const claims = await verify(fixture, issue(fixture), { replayDefense });

    expect(claims).toEqual({
      version: 1,
      issuer: "sprig-agent-gateway",
      audience: "sprig-trusted-server",
      subject: "user_owner_a",
      connectionId: "connection_a",
      provider: "codex",
      requestId: "request_a",
      evidenceId: "evidence_a",
      nonce: "nonce_a",
      issuedAt: BASE_TIME,
      expiresAt: BASE_TIME + 60,
      transition: "pending_to_connected",
      credentialRevision: 1,
      metadata: connectedMetadata(),
      kid: "lifecycle-current",
    });
    expect(replayDefense.entries).toEqual([
      {
        evidenceId: "evidence_a",
        nonce: "nonce_a",
        requestId: "request_a",
        expiresAt: BASE_TIME + 60,
      },
    ]);
  });

  it("rejects missing, malformed, claim-tampered, and signature-tampered evidence", async () => {
    const fixture = createFixture();
    await expectCode(() => verify(fixture, undefined), "missing_evidence");
    await expectCode(() => verify(fixture, "not.evidence"), "invalid_evidence");

    const token = issue(fixture);
    const [header, claims, signature] = token.split(".");
    const tamperedClaims = Buffer.from(
      Buffer.from(claims, "base64url")
        .toString("utf8")
        .replace("user_owner_a", "user_owner_b")
    ).toString("base64url");
    await expectCode(
      () => verify(fixture, `${header}.${tamperedClaims}.${signature}`),
      "invalid_signature"
    );

    const signatureBytes = Buffer.from(signature, "base64url");
    signatureBytes[0] ^= 0x01;
    await expectCode(
      () =>
        verify(
          fixture,
          `${header}.${claims}.${signatureBytes.toString("base64url")}`
        ),
      "invalid_signature"
    );
  });

  it("rejects authenticated whitespace, reordered, duplicate-key, and padded encodings", async () => {
    const fixture = createFixture();
    const token = issue(fixture);
    const [header, claims] = token.split(".");
    const claimsText = Buffer.from(claims, "base64url").toString("utf8");
    const whitespaceClaims = Buffer.from(
      JSON.stringify(JSON.parse(claimsText), null, 2)
    ).toString("base64url");
    await expectCode(
      () =>
        verify(
          fixture,
          signSegments(header, whitespaceClaims, fixture.current.signing)
        ),
      "noncanonical_evidence"
    );

    const parsed = JSON.parse(claimsText) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(parsed).reverse());
    await expectCode(
      () =>
        verify(
          fixture,
          signSegments(
            header,
            Buffer.from(JSON.stringify(reordered)).toString("base64url"),
            fixture.current.signing
          )
        ),
      "noncanonical_evidence"
    );

    const duplicateClaims = Buffer.from(
      claimsText.replace(
        '"subject":"user_owner_a"',
        '"subject":"user_owner_a","subject":"user_owner_a"'
      )
    ).toString("base64url");
    await expectCode(
      () =>
        verify(
          fixture,
          signSegments(header, duplicateClaims, fixture.current.signing)
        ),
      "noncanonical_evidence"
    );

    await expectCode(
      () =>
        verify(
          fixture,
          signSegments(header, `${claims}=`, fixture.current.signing)
        ),
      "noncanonical_evidence"
    );
  });

  it("enforces strict expiry, future, and maximum-lifetime boundaries", async () => {
    const fixture = createFixture();
    await expectCode(
      () => issue(fixture, { lifetimeSeconds: 61 }),
      "evidence_lifetime_invalid"
    );
    const token = issue(fixture, { lifetimeSeconds: 10 });

    fixture.clock.set(BASE_TIME - 1);
    await expectCode(() => verify(fixture, token), "evidence_from_future");
    fixture.clock.set(BASE_TIME + 9);
    expect((await verify(fixture, token)).expiresAt).toBe(BASE_TIME + 10);
    fixture.clock.set(BASE_TIME + 10);
    await expectCode(() => verify(fixture, token), "evidence_expired");

    fixture.clock.set(BASE_TIME);
    const overlong = resignClaims(token, fixture.current.signing, (claims) => {
      claims.expiresAt = BASE_TIME + 61;
    });
    await expectCode(
      () => verify(fixture, overlong),
      "evidence_lifetime_invalid"
    );
  });

  it("accepts current and previous rotation keys but no unknown key", async () => {
    const fixture = createFixture();
    expect((await verify(fixture, issue(fixture))).kid).toBe(
      "lifecycle-current"
    );
    expect(
      (await verify(fixture, issue(fixture, {}, fixture.previous.signing))).kid
    ).toBe("lifecycle-previous");

    const unknown = createKeyPair("lifecycle-unknown");
    await expectCode(
      () => verify(fixture, issue(fixture, {}, unknown.signing)),
      "invalid_signature"
    );
    await expectCode(
      () =>
        verify(fixture, issue(fixture), {
          verificationKeys: {
            current: fixture.current.verification,
            previous: {
              ...fixture.previous.verification,
              keyId: fixture.current.verification.keyId,
            },
          },
        }),
      "internal_evidence_configuration_invalid"
    );
  });

  it("pins the algorithm, protocol version, and authenticated key id", async () => {
    const fixture = createFixture();
    const token = issue(fixture);
    await expectCode(
      () =>
        verify(
          fixture,
          resignHeader(token, fixture.current.signing, (header) => {
            header.algorithm = "HS256";
          })
        ),
      "invalid_evidence"
    );
    await expectCode(
      () =>
        verify(
          fixture,
          resignHeader(token, fixture.current.signing, (header) => {
            header.version = 2;
          })
        ),
      "unsupported_evidence_version"
    );
    await expectCode(
      () =>
        verify(
          fixture,
          resignHeader(token, fixture.current.signing, (header) => {
            header.kid = "lifecycle-previous";
          })
        ),
      "invalid_signature"
    );
  });

  it("consumes signed owner, connection, request, transition, revision, and provider mismatches", async () => {
    const fixture = createFixture();
    const cases: ReadonlyArray<
      readonly [
        Partial<ExpectedLifecycleEvidenceContext>,
        LifecycleEvidenceError["code"],
      ]
    > = [
      [{ subject: "user_owner_b" }, "subject_mismatch"],
      [{ connectionId: "connection_b" }, "connection_mismatch"],
      [{ requestId: "request_b" }, "request_id_mismatch"],
      [{ transition: "connected_to_error" }, "transition_mismatch"],
      [{ credentialRevision: 2 }, "credential_revision_mismatch"],
    ];

    for (const [mismatch, code] of cases) {
      const token = issue(fixture);
      const replayDefense = new MemoryReplayDefense();
      await expectCode(
        () =>
          verify(fixture, token, {
            replayDefense,
            expected: { ...fixture.expected, ...mismatch },
          }),
        code
      );
      expect(replayDefense.entries).toHaveLength(1);
      await expectCode(
        () => verify(fixture, token, { replayDefense }),
        "replay_detected"
      );
    }

    const providerToken = resignClaims(
      issue(fixture),
      fixture.current.signing,
      (claims) => {
        claims.provider = "claude";
      }
    );
    const providerReplay = new MemoryReplayDefense();
    await expectCode(
      () => verify(fixture, providerToken, { replayDefense: providerReplay }),
      "provider_mismatch"
    );
    expect(providerReplay.entries).toHaveLength(1);
  });

  it("rejects replay by either evidence id or nonce", async () => {
    const fixture = createFixture();
    const replayDefense = new MemoryReplayDefense();
    await verify(fixture, issue(fixture), { replayDefense });
    await expectCode(
      () => verify(fixture, issue(fixture), { replayDefense }),
      "replay_detected"
    );
    await expectCode(
      () =>
        verify(fixture, issue(fixture, { evidenceId: "evidence_b" }), {
          replayDefense,
        }),
      "replay_detected"
    );
  });

  it("accepts only allowed transition shapes and rejects API-key accounts", async () => {
    const fixture = createFixture();
    const transitionCases: ReadonlyArray<
      readonly [LifecycleTransition, LifecycleEvidenceMetadata]
    > = [
      ["pending_to_connected", connectedMetadata()],
      [
        "pending_to_error",
        {
          gatewayCredentialId: null,
          account: null,
          planLabel: null,
          errorCode: "provider_denied",
        },
      ],
      [
        "pending_to_expired",
        {
          gatewayCredentialId: null,
          account: null,
          planLabel: null,
          errorCode: "credential_expired",
        },
      ],
      [
        "connected_to_revoked",
        {
          gatewayCredentialId: null,
          account: null,
          planLabel: null,
          errorCode: null,
        },
      ],
    ];
    for (const [transition, metadata] of transitionCases) {
      expect(issue(fixture, { transition, metadata }).split(".")).toHaveLength(
        3
      );
    }

    await expectCode(
      () =>
        issue(fixture, {
          metadata: {
            ...connectedMetadata(),
            account: { type: "api_key", present: true },
          } as unknown as LifecycleEvidenceMetadata,
        }),
      "invalid_evidence"
    );
    await expectCode(
      () =>
        issue(fixture, {
          transition: "pending_to_connected",
          metadata: connectedMetadata({ gatewayCredentialId: null }),
        }),
      "invalid_evidence"
    );
    await expectCode(
      () =>
        issue(fixture, {
          transition: "connected_to_revoked",
          metadata: connectedMetadata(),
        }),
      "invalid_evidence"
    );
    await expectCode(
      () =>
        issue(fixture, {
          transition: "pending_to_error",
          metadata: connectedMetadata({ errorCode: null }),
        }),
      "invalid_evidence"
    );
  });

  it("rejects secret-bearing extension fields and never serializes secret canaries", async () => {
    const fixture = createFixture();
    const secretCanaries = [
      "sk-secret-canary",
      "/Users/secret/.codex/auth.json",
      "CODEX_HOME=/credential/home",
      "codex app-server --dangerous",
      "raw-provider-output-canary",
    ];
    for (const [field, canary] of [
      ["token", secretCanaries[0]],
      ["path", secretCanaries[1]],
      ["environment", secretCanaries[2]],
      ["command", secretCanaries[3]],
      ["providerOutput", secretCanaries[4]],
    ]) {
      await expectCode(
        () =>
          issueLifecycleEvidence(
            {
              ...decision(fixture),
              [field]: canary,
            } as ServerLifecycleDecision,
            fixture.current.signing,
            fixture.clock
          ),
        "invalid_evidence"
      );
      await expectCode(
        () =>
          issue(fixture, {
            metadata: {
              ...connectedMetadata(),
              [field]: canary,
            } as LifecycleEvidenceMetadata,
          }),
        "invalid_evidence"
      );
    }

    const token = issue(fixture);
    for (const canary of secretCanaries) {
      expect(token).not.toContain(canary);
      expect(
        Buffer.from(token.split(".")[1], "base64url").toString("utf8")
      ).not.toContain(canary);
    }
  });

  it("rejects huge tokens, identifiers, labels, getters, and invented fields", async () => {
    const fixture = createFixture();
    await expectCode(
      () => verify(fixture, `a.${"b".repeat(8_193)}.c`),
      "invalid_evidence"
    );
    await expectCode(
      () => issue(fixture, { evidenceId: "x".repeat(257) }),
      "invalid_evidence"
    );
    await expectCode(
      () => issue(fixture, { evidenceId: "🙂".repeat(100) }),
      "invalid_evidence"
    );
    await expectCode(
      () => issue(fixture, { evidenceId: "same", nonce: "same" }),
      "invalid_evidence"
    );
    await expectCode(
      () =>
        issue(fixture, {
          metadata: connectedMetadata({ planLabel: "x".repeat(129) }),
        }),
      "invalid_evidence"
    );
    await expectCode(
      () =>
        issue(fixture, {
          metadata: connectedMetadata({ planLabel: "Plus\nsecret" }),
        }),
      "invalid_evidence"
    );
    await expectCode(
      () =>
        issue(fixture, {
          transition: "pending_to_destroyed" as LifecycleTransition,
        }),
      "invalid_evidence"
    );

    let getterInvoked = false;
    const hostile = Object.defineProperty(decision(fixture), "token", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return "secret";
      },
    });
    await expectCode(
      () =>
        issueLifecycleEvidence(hostile, fixture.current.signing, fixture.clock),
      "invalid_evidence"
    );
    expect(getterInvoked).toBe(false);

    fixture.clock.set(Number.MAX_SAFE_INTEGER);
    await expectCode(
      () => issue(fixture),
      "internal_evidence_configuration_invalid"
    );
  });

  it("fails closed on replay timeout and abort while observing late settlement", async () => {
    const fixture = createFixture();
    let storeSignal: AbortSignal | undefined;
    let settleStore: (() => void) | undefined;
    const slowStore: LifecycleEvidenceReplayDefense = {
      consume(
        _entry: LifecycleReplayEntry,
        context?: ControlPlaneOperationContext
      ): Promise<void> {
        storeSignal = context?.signal;
        return new Promise<void>((resolve) => {
          settleStore = resolve;
        });
      },
    };
    await expectCode(
      () =>
        verify(fixture, issue(fixture), {
          replayDefense: slowStore,
          replayDefenseTimeoutMs: 5,
        }),
      "replay_defense_unavailable"
    );
    expect(storeSignal?.aborted).toBe(true);
    settleStore?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const controller = new AbortController();
    const neverCalled: LifecycleEvidenceReplayDefense = {
      consume(): void {
        throw new Error("pre-aborted verification called the store");
      },
    };
    controller.abort("secret abort reason");
    const error = await expectCode(
      () =>
        verify(fixture, issue(fixture), {
          replayDefense: neverCalled,
          signal: controller.signal,
        }),
      "replay_defense_unavailable"
    );
    expect(error.message).not.toContain("secret abort reason");

    let rejectStore: ((error: Error) => void) | undefined;
    let abortSignal: AbortSignal | undefined;
    const controllerDuringStore = new AbortController();
    const lateRejectingStore: LifecycleEvidenceReplayDefense = {
      consume(
        _entry: LifecycleReplayEntry,
        context?: ControlPlaneOperationContext
      ): Promise<void> {
        abortSignal = context?.signal;
        return new Promise<void>((_resolve, reject) => {
          rejectStore = reject;
        });
      },
    };
    const verification = verify(fixture, issue(fixture), {
      replayDefense: lateRejectingStore,
      signal: controllerDuringStore.signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    controllerDuringStore.abort("another secret reason");
    await expectCode(() => verification, "replay_defense_unavailable");
    expect(abortSignal?.aborted).toBe(true);
    rejectStore?.(new Error("late secret store rejection"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("normalizes store rejection, ambiguous success, and configuration failures", async () => {
    const fixture = createFixture();
    const rejecting: LifecycleEvidenceReplayDefense = {
      consume(): Promise<void> {
        return Promise.reject(new Error("secret store failure"));
      },
    };
    const error = await expectCode(
      () => verify(fixture, issue(fixture), { replayDefense: rejecting }),
      "replay_defense_unavailable"
    );
    expect(error.message).not.toContain("secret store failure");

    const ambiguous = {
      consume(): unknown {
        return { committed: "maybe" };
      },
    } as LifecycleEvidenceReplayDefense;
    await expectCode(
      () => verify(fixture, issue(fixture), { replayDefense: ambiguous }),
      "replay_defense_unavailable"
    );
    await expectCode(
      () =>
        verify(fixture, issue(fixture), {
          replayDefenseTimeoutMs: 0,
        }),
      "internal_evidence_configuration_invalid"
    );
  });
});
