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
  type LifecycleMonotonicClock,
  type LifecyclePlanLabel,
  LifecycleReplayDefenseError,
  type LifecycleReplayEntry,
  type LifecycleTransition,
  type ServerLifecycleDecision,
  verifyLifecycleEvidence,
} from "./lifecycle-evidence.ts";

const BASE_TIME = 1_800_000_000;
const OWNER_A = "user_2abcDEF3456789xyz";
const OWNER_B = "user_3abcDEF3456789xyz";
const CONNECTION_A = "connection_v1_11111111-1111-4111-8111-111111111111";
const CONNECTION_B = "connection_v1_22222222-2222-4222-8222-222222222222";
const REQUEST_A = "request_v1_33333333-3333-4333-8333-333333333333";
const REQUEST_B = "request_v1_44444444-4444-4444-8444-444444444444";
const EVIDENCE_A = "evidence_v1_55555555-5555-4555-8555-555555555555";
const EVIDENCE_B = "evidence_v1_66666666-6666-4666-8666-666666666666";
const NONCE_A = "nonce_v1_88888888-8888-4888-8888-888888888888";
const NONCE_B = "nonce_v1_99999999-9999-4999-8999-999999999999";
const GATEWAY_CREDENTIAL_A = "gwcred_v1_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

/** Real monotonic clock for replay timeout behavior. */
class TestMonotonicClock implements LifecycleMonotonicClock {
  nowMilliseconds(): number {
    return performance.now();
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
          existing.nonce === entry.nonce ||
          existing.requestId === entry.requestId
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
  const current = createKeyPair("lifecycle-v1-a1b2c3d4");
  const previous = createKeyPair("lifecycle-v1-b1c2d3e4");
  const expected: ExpectedLifecycleEvidenceContext = {
    issuer: "sprig-agent-gateway",
    audience: "sprig-trusted-server",
    subject: OWNER_A,
    connectionId: CONNECTION_A,
    provider: "codex",
    requestId: REQUEST_A,
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
    gatewayCredentialId: GATEWAY_CREDENTIAL_A,
    account: { type: "chatgpt", present: true },
    planLabel: "ChatGPT Plus",
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
    evidenceId: EVIDENCE_A,
    nonce: NONCE_A,
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
    monotonicClock: LifecycleMonotonicClock;
    replayDefense: LifecycleEvidenceReplayDefense;
    replayDefenseTimeoutMs: number;
    signal: AbortSignal;
    verificationKeys: LifecycleEvidenceVerificationKeys;
  }> = {}
) {
  return verifyLifecycleEvidence(token, {
    clock: fixture.clock,
    monotonicClock: overrides.monotonicClock ?? new TestMonotonicClock(),
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
      subject: OWNER_A,
      connectionId: CONNECTION_A,
      provider: "codex",
      requestId: REQUEST_A,
      evidenceId: EVIDENCE_A,
      nonce: NONCE_A,
      issuedAt: BASE_TIME,
      expiresAt: BASE_TIME + 60,
      transition: "pending_to_connected",
      credentialRevision: 1,
      metadata: connectedMetadata(),
      kid: "lifecycle-v1-a1b2c3d4",
    });
    expect(replayDefense.entries).toEqual([
      {
        evidenceId: EVIDENCE_A,
        nonce: NONCE_A,
        requestId: REQUEST_A,
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
        .replace(OWNER_A, OWNER_B)
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
        `"subject":"${OWNER_A}"`,
        `"subject":"${OWNER_A}","subject":"${OWNER_A}"`
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
      "lifecycle-v1-a1b2c3d4"
    );
    expect(
      (await verify(fixture, issue(fixture, {}, fixture.previous.signing))).kid
    ).toBe("lifecycle-v1-b1c2d3e4");

    const unknown = createKeyPair("lifecycle-v1-c1d2e3f4");
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
            header.kid = "lifecycle-v1-b1c2d3e4";
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
      [{ subject: OWNER_B }, "subject_mismatch"],
      [{ connectionId: CONNECTION_B }, "connection_mismatch"],
      [{ requestId: REQUEST_B }, "request_id_mismatch"],
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

  it("atomically rejects replay by evidence id, nonce, or originating request id", async () => {
    const fixture = createFixture();
    const replayDefense = new MemoryReplayDefense();
    await verify(fixture, issue(fixture), { replayDefense });
    await expectCode(
      () => verify(fixture, issue(fixture), { replayDefense }),
      "replay_detected"
    );
    await expectCode(
      () =>
        verify(
          fixture,
          issue(fixture, {
            evidenceId: EVIDENCE_B,
            nonce: NONCE_A,
            requestId: REQUEST_B,
          }),
          {
            expected: { ...fixture.expected, requestId: REQUEST_B },
            replayDefense,
          }
        ),
      "replay_detected"
    );
    await expectCode(
      () =>
        verify(
          fixture,
          issue(fixture, {
            evidenceId: EVIDENCE_A,
            nonce: NONCE_B,
            requestId: REQUEST_B,
          }),
          {
            expected: { ...fixture.expected, requestId: REQUEST_B },
            replayDefense,
          }
        ),
      "replay_detected"
    );
    await expectCode(
      () =>
        verify(
          fixture,
          issue(fixture, { evidenceId: EVIDENCE_B, nonce: NONCE_B }),
          { replayDefense }
        ),
      "replay_detected"
    );
  });

  it("allows only one concurrent result for the same originating request", async () => {
    const fixture = createFixture();
    const replayDefense = new MemoryReplayDefense();
    const first = issue(fixture);
    const second = issue(fixture, {
      evidenceId: EVIDENCE_B,
      nonce: NONCE_B,
    });
    const outcomes = await Promise.allSettled([
      verify(fixture, first, { replayDefense }),
      verify(fixture, second, { replayDefense }),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      LifecycleEvidenceError
    );
    expect(
      ((rejected as PromiseRejectedResult).reason as LifecycleEvidenceError)
        .code
    ).toBe("replay_detected");
    expect(replayDefense.entries).toHaveLength(1);
  });

  it("enforces required keys and forbids extensions for every exact transition", async () => {
    const fixture = createFixture();
    const errorMetadata: LifecycleEvidenceMetadata = {
      gatewayCredentialId: null,
      account: null,
      planLabel: null,
      errorCode: "provider_denied",
    };
    const expiredMetadata: LifecycleEvidenceMetadata = {
      gatewayCredentialId: null,
      account: null,
      planLabel: null,
      errorCode: "credential_expired",
    };
    const emptyMetadata: LifecycleEvidenceMetadata = {
      gatewayCredentialId: null,
      account: null,
      planLabel: null,
      errorCode: null,
    };
    const transitionCases: ReadonlyArray<
      Readonly<{
        transition: LifecycleTransition;
        policy: "connected" | "error" | "expired" | "empty";
        metadata: LifecycleEvidenceMetadata;
      }>
    > = [
      {
        transition: "pending_to_connected",
        policy: "connected",
        metadata: connectedMetadata(),
      },
      {
        transition: "pending_to_error",
        policy: "error",
        metadata: errorMetadata,
      },
      {
        transition: "pending_to_expired",
        policy: "expired",
        metadata: expiredMetadata,
      },
      {
        transition: "pending_to_revoking",
        policy: "empty",
        metadata: emptyMetadata,
      },
      {
        transition: "connected_to_error",
        policy: "error",
        metadata: errorMetadata,
      },
      {
        transition: "connected_to_expired",
        policy: "expired",
        metadata: expiredMetadata,
      },
      {
        transition: "connected_to_revoking",
        policy: "empty",
        metadata: emptyMetadata,
      },
      {
        transition: "error_to_revoking",
        policy: "empty",
        metadata: emptyMetadata,
      },
      {
        transition: "expired_to_revoking",
        policy: "empty",
        metadata: emptyMetadata,
      },
      {
        transition: "revoking_to_revoked",
        policy: "empty",
        metadata: emptyMetadata,
      },
      {
        transition: "revoked_to_deleted",
        policy: "empty",
        metadata: emptyMetadata,
      },
    ];

    for (const { transition, metadata } of transitionCases) {
      expect(issue(fixture, { transition, metadata }).split(".")).toHaveLength(
        3
      );
      for (const key of Object.keys(metadata)) {
        const missing = { ...metadata } as Record<string, unknown>;
        delete missing[key];
        await expectCode(
          () =>
            issue(fixture, {
              transition,
              metadata: missing as LifecycleEvidenceMetadata,
            }),
          "invalid_evidence"
        );
      }
      await expectCode(
        () =>
          issue(fixture, {
            transition,
            metadata: {
              ...metadata,
              rawProviderOutput: "safe-looking-extension",
            } as LifecycleEvidenceMetadata,
          }),
        "invalid_evidence"
      );
    }

    for (const { transition, policy } of transitionCases) {
      if (policy === "connected") {
        await expectCode(
          () =>
            issue(fixture, {
              transition,
              metadata: connectedMetadata({ gatewayCredentialId: null }),
            }),
          "invalid_evidence"
        );
        await expectCode(
          () =>
            issue(fixture, {
              transition,
              metadata: connectedMetadata({ account: null }),
            }),
          "invalid_evidence"
        );
        await expectCode(
          () =>
            issue(fixture, {
              transition,
              metadata: connectedMetadata({
                errorCode: "provider_unavailable",
              }),
            }),
          "invalid_evidence"
        );
        expect(
          issue(fixture, {
            transition,
            metadata: connectedMetadata({ planLabel: null }),
          })
        ).toContain(".");
        continue;
      }

      const requiredError =
        policy === "error"
          ? "provider_unavailable"
          : policy === "expired"
            ? "credential_expired"
            : null;
      for (const forbidden of [
        { gatewayCredentialId: GATEWAY_CREDENTIAL_A },
        { account: { type: "chatgpt" as const, present: true as const } },
        { planLabel: "ChatGPT Plus" as LifecyclePlanLabel },
      ]) {
        await expectCode(
          () =>
            issue(fixture, {
              transition,
              metadata: {
                gatewayCredentialId: null,
                account: null,
                planLabel: null,
                errorCode: requiredError,
                ...forbidden,
              },
            }),
          "invalid_evidence"
        );
      }
      if (policy === "error" || policy === "expired") {
        await expectCode(
          () =>
            issue(fixture, {
              transition,
              metadata: emptyMetadata,
            }),
          "invalid_evidence"
        );
      }
      if (policy === "error") {
        await expectCode(
          () =>
            issue(fixture, {
              transition,
              metadata: expiredMetadata,
            }),
          "invalid_evidence"
        );
      }
      if (policy === "expired") {
        await expectCode(
          () =>
            issue(fixture, {
              transition,
              metadata: errorMetadata,
            }),
          "invalid_evidence"
        );
      }
      if (policy === "empty") {
        await expectCode(
          () =>
            issue(fixture, {
              transition,
              metadata: errorMetadata,
            }),
          "invalid_evidence"
        );
      }
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

  it("rejects secret, path, env, URL, encoded, control, and confusable values in allowed fields", async () => {
    const fixture = createFixture();
    const canaries = [
      "sk-secret-canary",
      "sess-secret-canary",
      "gwcred_v1_sk-secret-canary",
      "gwcred_v1_CODEX_HOME_secret",
      "gwcred_v1_..%2F..%2Fauth.json",
      "gwcred_v1_https_example_com_token",
      "/Users/secret/.codex/auth.json",
      "..%2F..%2Fauth.json",
      "CODEX_HOME=/credential/home",
      "https://example.com/token",
      "line-one\nline-two",
      "gwcred_v1_／confusable-slash",
    ];

    for (const canary of canaries) {
      const credentialError = await expectCode(
        () =>
          issue(fixture, {
            metadata: connectedMetadata({ gatewayCredentialId: canary }),
          }),
        "invalid_evidence"
      );
      expect(credentialError.message).not.toContain(canary);

      const planError = await expectCode(
        () =>
          issue(fixture, {
            metadata: connectedMetadata({
              planLabel: canary as LifecyclePlanLabel,
            }),
          }),
        "invalid_evidence"
      );
      expect(planError.message).not.toContain(canary);

      for (const field of [
        "issuer",
        "audience",
        "subject",
        "connectionId",
        "requestId",
        "evidenceId",
        "nonce",
      ] as const) {
        const identifierError = await expectCode(
          () => issue(fixture, { [field]: canary }),
          "invalid_evidence"
        );
        expect(identifierError.message).not.toContain(canary);
      }
    }

    await expectCode(
      () =>
        issue(fixture, {
          metadata: connectedMetadata({
            planLabel: "ChatGPT Plуs" as LifecyclePlanLabel,
          }),
        }),
      "invalid_evidence"
    );
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
          metadata: connectedMetadata({
            planLabel: "x".repeat(129) as LifecyclePlanLabel,
          }),
        }),
      "invalid_evidence"
    );
    await expectCode(
      () =>
        issue(fixture, {
          metadata: connectedMetadata({
            planLabel: "Plus\nsecret" as LifecyclePlanLabel,
          }),
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

    for (const magicKey of ["__proto__", "prototype", "constructor"]) {
      const hostileDecision = Object.defineProperty(
        decision(fixture),
        magicKey,
        {
          enumerable: true,
          value: { lifetimeSeconds: 1 },
        }
      );
      await expectCode(
        () =>
          issueLifecycleEvidence(
            hostileDecision,
            fixture.current.signing,
            fixture.clock
          ),
        "invalid_evidence"
      );

      const hostileMetadata = Object.defineProperty(
        connectedMetadata(),
        magicKey,
        { enumerable: true, value: "sk-secret-canary" }
      );
      await expectCode(
        () =>
          issue(fixture, {
            metadata: hostileMetadata,
          }),
        "invalid_evidence"
      );

      const hostileAccount = Object.defineProperty(
        { type: "chatgpt", present: true },
        magicKey,
        { enumerable: true, value: "sk-secret-canary" }
      );
      await expectCode(
        () =>
          issue(fixture, {
            metadata: connectedMetadata({
              account: hostileAccount as {
                readonly type: "chatgpt";
                readonly present: true;
              },
            }),
          }),
        "invalid_evidence"
      );
    }

    const inheritedLifetime = Object.create({ lifetimeSeconds: 1 }) as Record<
      string,
      unknown
    >;
    Object.defineProperties(
      inheritedLifetime,
      Object.getOwnPropertyDescriptors(decision(fixture))
    );
    await expectCode(
      () =>
        issueLifecycleEvidence(
          inheritedLifetime as ServerLifecycleDecision,
          fixture.current.signing,
          fixture.clock
        ),
      "invalid_evidence"
    );

    const symbolDecision = decision(fixture) as ServerLifecycleDecision &
      Record<symbol, unknown>;
    Object.defineProperty(symbolDecision, Symbol("secret"), {
      enumerable: true,
      value: "sk-secret-canary",
    });
    await expectCode(
      () =>
        issueLifecycleEvidence(
          symbolDecision,
          fixture.current.signing,
          fixture.clock
        ),
      "invalid_evidence"
    );

    const hiddenExtension = Object.defineProperty(decision(fixture), "token", {
      enumerable: false,
      value: "sk-secret-canary",
    });
    await expectCode(
      () =>
        issueLifecycleEvidence(
          hiddenExtension,
          fixture.current.signing,
          fixture.clock
        ),
      "invalid_evidence"
    );

    let nestedGetterInvoked = false;
    const accessorMetadata = Object.defineProperty(
      connectedMetadata(),
      "token",
      {
        enumerable: true,
        get() {
          nestedGetterInvoked = true;
          return "sk-secret-canary";
        },
      }
    );
    await expectCode(
      () => issue(fixture, { metadata: accessorMetadata }),
      "invalid_evidence"
    );
    expect(nestedGetterInvoked).toBe(false);

    fixture.clock.set(Number.MAX_SAFE_INTEGER);
    await expectCode(
      () => issue(fixture),
      "internal_evidence_configuration_invalid"
    );
  });

  it("fails closed on replay timeout and abort while observing late settlement", async () => {
    const fixture = createFixture();
    let preflightReads = 0;
    const alreadyLateClock: LifecycleMonotonicClock = {
      nowMilliseconds(): number {
        preflightReads += 1;
        return preflightReads === 1 ? 100 : 106;
      },
    };
    const preflightStore: LifecycleEvidenceReplayDefense = {
      consume(): void {
        throw new Error("late preflight called replay store");
      },
    };
    await expectCode(
      () =>
        verify(fixture, issue(fixture), {
          monotonicClock: alreadyLateClock,
          replayDefense: preflightStore,
          replayDefenseTimeoutMs: 5,
        }),
      "replay_defense_unavailable"
    );

    let blockingSignal: AbortSignal | undefined;
    const blockingStore: LifecycleEvidenceReplayDefense = {
      consume(
        _entry: LifecycleReplayEntry,
        context?: ControlPlaneOperationContext
      ): void {
        blockingSignal = context?.signal;
        const releaseAt = performance.now() + 30;
        while (performance.now() < releaseAt) {
          // Deliberately block to prove the post-settlement deadline check is
          // authoritative even when the timer callback cannot run on time.
        }
      },
    };
    await expectCode(
      () =>
        verify(fixture, issue(fixture), {
          replayDefense: blockingStore,
          replayDefenseTimeoutMs: 5,
        }),
      "replay_defense_unavailable"
    );
    expect(blockingSignal?.aborted).toBe(true);

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
    await expectCode(
      () =>
        verify(fixture, issue(fixture), {
          monotonicClock: { nowMilliseconds: () => Number.NaN },
        }),
      "internal_evidence_configuration_invalid"
    );
  });
});
