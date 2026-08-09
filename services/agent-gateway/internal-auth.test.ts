import { generateKeyPairSync, sign as signBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authenticateInternalAssertion,
  BoundedReplayCache,
  type Clock,
  type ExpectedAssertionContext,
  type GatewayOperation,
  InternalAssertionError,
  issueInternalAssertion,
  type ReplayDefense,
  type SigningKey,
  type VerificationKeys,
  verifyAuthenticatedInternalAssertion,
  verifyInternalAssertion,
} from "./internal-auth.ts";

const BASE_TIME = 1_800_000_000;

/** Mutable deterministic clock for exact validity-boundary tests. */
class TestClock implements Clock {
  constructor(private current: number = BASE_TIME) {}

  nowSeconds(): number {
    return this.current;
  }

  set(nowSeconds: number): void {
    this.current = nowSeconds;
  }
}

/** Creates an isolated Ed25519 key pair with the requested identifier. */
function createKeyPair(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    signing: { keyId, privateKey } satisfies SigningKey,
    verification: { keyId, publicKey },
  };
}

/** Builds one complete verifier fixture without ambient time or key state. */
function createFixture() {
  const clock = new TestClock();
  const current = createKeyPair("key-current");
  const previous = createKeyPair("key-previous");
  const expected: ExpectedAssertionContext = {
    issuer: "sprig-nextjs",
    audience: "sprig-agent-gateway",
    subject: "user_owner_a",
    connectionId: "connection_a",
    provider: "codex",
    operation: "chat",
    requestId: "request_1",
  };
  const verificationKeys: VerificationKeys = {
    current: current.verification,
    previous: previous.verification,
  };

  return { clock, current, expected, previous, verificationKeys };
}

/** Issues a token using stable unique identifiers unless overridden. */
function issueToken(
  fixture: ReturnType<typeof createFixture>,
  overrides: Partial<{
    audience: string;
    connectionId: string;
    issuer: string;
    lifetimeSeconds: number;
    nonce: string;
    operation: GatewayOperation;
    requestId: string;
    subject: string;
  }> = {},
  signingKey = fixture.current.signing
): string {
  return issueInternalAssertion(
    {
      issuer: overrides.issuer ?? fixture.expected.issuer,
      audience: overrides.audience ?? fixture.expected.audience,
      subject: overrides.subject ?? fixture.expected.subject,
      connectionId: overrides.connectionId ?? fixture.expected.connectionId,
      operation: overrides.operation ?? fixture.expected.operation,
      requestId: overrides.requestId ?? "request_1",
      nonce: overrides.nonce ?? "nonce_1",
      lifetimeSeconds: overrides.lifetimeSeconds,
    },
    signingKey,
    fixture.clock
  );
}

/** Verifies a token with a fresh cache unless a specific defense is provided. */
function verifyToken(
  fixture: ReturnType<typeof createFixture>,
  token: string | null | undefined,
  options: Partial<{
    expected: ExpectedAssertionContext;
    replayDefense: ReplayDefense;
    verificationKeys: VerificationKeys;
  }> = {}
) {
  return verifyInternalAssertion(token, {
    clock: fixture.clock,
    expected: options.expected ?? fixture.expected,
    replayDefense: options.replayDefense ?? new BoundedReplayCache(16),
    verificationKeys: options.verificationKeys ?? fixture.verificationKeys,
  });
}

/** Re-signs controlled test claims to exercise post-signature validation. */
function resignToken(
  token: string,
  signingKey: SigningKey,
  mutate: (claims: Record<string, unknown>) => void
): string {
  const [encodedHeader, encodedClaims] = token.split(".");
  const claims = JSON.parse(
    Buffer.from(encodedClaims, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  mutate(claims);

  const nextClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return signEncodedAssertion(encodedHeader, nextClaims, signingKey);
}

/** Signs pre-encoded JSON segments so tests can authenticate noncanonical forms. */
function signEncodedAssertion(
  encodedHeader: string,
  encodedClaims: string,
  signingKey: SigningKey
): string {
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = signBytes(
    null,
    Buffer.from(signingInput),
    signingKey.privateKey
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

/** Awaits a rejected verification and checks only its stable public code. */
async function expectCode(
  action: () => unknown | Promise<unknown>,
  code: InternalAssertionError["code"]
): Promise<void> {
  const error = await captureAssertionError(action);
  expect(error.code).toBe(code);
}

/** Captures one stable verifier error without accepting another error type. */
async function captureAssertionError(
  action: () => unknown | Promise<unknown>
): Promise<InternalAssertionError> {
  try {
    await action();
    throw new Error("Expected an InternalAssertionError");
  } catch (error) {
    expect(error).toBeInstanceOf(InternalAssertionError);
    return error as InternalAssertionError;
  }
}

describe("internal gateway assertions", () => {
  it("stages configured-key authentication before strict payload validation", async () => {
    const fixture = createFixture();
    const token = issueToken(fixture);
    const [encodedHeader, encodedClaims] = token.split(".");
    const claims = JSON.parse(
      Buffer.from(encodedClaims, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    const noncanonicalClaims = Buffer.from(
      JSON.stringify(claims, null, 2)
    ).toString("base64url");
    const signedNoncanonical = signEncodedAssertion(
      encodedHeader,
      noncanonicalClaims,
      fixture.current.signing
    );

    const authenticated = authenticateInternalAssertion(
      signedNoncanonical,
      fixture.verificationKeys
    );
    await expectCode(
      () =>
        verifyAuthenticatedInternalAssertion(authenticated, {
          clock: fixture.clock,
          expected: fixture.expected,
          replayDefense: new BoundedReplayCache(4),
        }),
      "noncanonical_assertion"
    );

    // Even copying every enumerable field and hidden symbol from a real stage
    // cannot mint another signature-authenticated object identity.
    const forged = { ...authenticated };
    await expectCode(
      () =>
        verifyAuthenticatedInternalAssertion(forged, {
          clock: fixture.clock,
          expected: fixture.expected,
          replayDefense: new BoundedReplayCache(4),
        }),
      "invalid_assertion"
    );
  });

  it("does not create an authenticated stage for unknown or tampered signatures", async () => {
    const fixture = createFixture();
    const unknown = createKeyPair("unknown-key");
    const unknownToken = issueToken(fixture, {}, unknown.signing);
    await expectCode(
      () =>
        authenticateInternalAssertion(unknownToken, fixture.verificationKeys),
      "invalid_signature"
    );

    const token = issueToken(fixture);
    const [header, claims, signature] = token.split(".");
    const bytes = Buffer.from(signature, "base64url");
    bytes[0] ^= 0x01;
    await expectCode(
      () =>
        authenticateInternalAssertion(
          `${header}.${claims}.${bytes.toString("base64url")}`,
          fixture.verificationKeys
        ),
      "invalid_signature"
    );
  });

  it("issues and verifies the exact Codex-only v1 context", async () => {
    const fixture = createFixture();
    const claims = await verifyToken(fixture, issueToken(fixture));

    expect(claims).toEqual({
      version: 1,
      issuer: "sprig-nextjs",
      audience: "sprig-agent-gateway",
      subject: "user_owner_a",
      connectionId: "connection_a",
      provider: "codex",
      operation: "chat",
      requestId: "request_1",
      iat: BASE_TIME,
      exp: BASE_TIME + 60,
      nonce: "nonce_1",
      kid: "key-current",
    });
  });

  it("rejects missing, malformed, and signature-tampered assertions", async () => {
    const fixture = createFixture();
    await expectCode(
      () => verifyToken(fixture, undefined),
      "missing_assertion"
    );
    await expectCode(
      () => verifyToken(fixture, "not-a-token"),
      "invalid_assertion"
    );

    const token = issueToken(fixture);
    const [header, claims, signature] = token.split(".");
    const tamperedSignatureBytes = Buffer.from(signature, "base64url");
    // Flipping a decoded signature bit always changes the Ed25519 signature,
    // unlike replacing a possibly unused base64 padding bit.
    tamperedSignatureBytes[0] ^= 0x01;
    const tamperedSignature = tamperedSignatureBytes.toString("base64url");
    await expectCode(
      () => verifyToken(fixture, `${header}.${claims}.${tamperedSignature}`),
      "invalid_signature"
    );

    const tamperedClaims = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(claims, "base64url").toString("utf8")),
        subject: "user_owner_b",
      })
    ).toString("base64url");
    await expectCode(
      () => verifyToken(fixture, `${header}.${tamperedClaims}.${signature}`),
      "invalid_signature"
    );
  });

  it("enforces a strict maximum lifetime and exact no-skew boundaries", async () => {
    const fixture = createFixture();
    await expectCode(
      () => issueToken(fixture, { lifetimeSeconds: 61 }),
      "assertion_lifetime_invalid"
    );

    const token = issueToken(fixture, { lifetimeSeconds: 10 });
    fixture.clock.set(BASE_TIME - 1);
    await expectCode(
      () => verifyToken(fixture, token),
      "assertion_from_future"
    );

    fixture.clock.set(BASE_TIME + 9);
    expect((await verifyToken(fixture, token)).exp).toBe(BASE_TIME + 10);

    fixture.clock.set(BASE_TIME + 10);
    await expectCode(() => verifyToken(fixture, token), "assertion_expired");
  });

  it("rejects signed assertions whose encoded lifetime exceeds the limit", async () => {
    const fixture = createFixture();
    const token = issueToken(fixture);
    const oversized = resignToken(token, fixture.current.signing, (claims) => {
      claims.exp = BASE_TIME + 61;
    });

    await expectCode(
      () => verifyToken(fixture, oversized),
      "assertion_lifetime_invalid"
    );
  });

  it("rejects a correctly signed assertion from another protocol version", async () => {
    const fixture = createFixture();
    const token = resignToken(
      issueToken(fixture),
      fixture.current.signing,
      (claims) => {
        claims.version = 2;
      }
    );

    await expectCode(
      () => verifyToken(fixture, token),
      "unsupported_assertion_version"
    );
  });

  it("rejects authenticated noncanonical header and payload JSON", async () => {
    const canonicalToken = issueToken(createFixture());
    const [encodedHeader, encodedClaims] = canonicalToken.split(".");
    const header = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    const claims = JSON.parse(
      Buffer.from(encodedClaims, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    const canonicalHeaderJson = JSON.stringify(header);
    const canonicalClaimsJson = JSON.stringify(claims);
    const encode = (value: string) => Buffer.from(value).toString("base64url");

    const variants: ReadonlyArray<readonly [string, string]> = [
      [encode(JSON.stringify({ kid: header.kid, ...header })), encodedClaims],
      [encodedHeader, encode(JSON.stringify({ kid: claims.kid, ...claims }))],
      [encode(JSON.stringify(header, null, 2)), encodedClaims],
      [
        encode(
          canonicalHeaderJson.replace(
            '"algorithm":"EdDSA"',
            '"algorithm":"EdDSA","algorithm":"EdDSA"'
          )
        ),
        encodedClaims,
      ],
      [
        encodedHeader,
        encode(
          canonicalClaimsJson.replace(
            '"requestId":"request_1"',
            '"requestId":"request_shadow","requestId":"request_1"'
          )
        ),
      ],
      [`${encodedHeader}=`, encodedClaims],
    ];

    for (const [noncanonicalHeader, noncanonicalClaims] of variants) {
      const fixture = createFixture();
      const token = signEncodedAssertion(
        noncanonicalHeader,
        noncanonicalClaims,
        fixture.current.signing
      );
      await expectCode(
        () => verifyToken(fixture, token),
        "noncanonical_assertion"
      );
    }
  });

  it.each([
    ["issuer", "issuer_mismatch", { issuer: "unexpected-issuer" }],
    ["audience", "audience_mismatch", { audience: "unexpected-audience" }],
    ["subject", "subject_mismatch", { subject: "user_owner_b" }],
    ["connection", "connection_mismatch", { connectionId: "connection_b" }],
    ["operation", "operation_mismatch", { operation: "node-editing" }],
  ] as const)(
    "rejects a wrong expected %s and consumes the signed assertion",
    async (_label, code, expectedOverride) => {
      const fixture = createFixture();
      const replayDefense = new BoundedReplayCache(4);
      const token = issueToken(fixture);
      const wrongExpected = {
        ...fixture.expected,
        ...expectedOverride,
      } as ExpectedAssertionContext;

      await expectCode(
        () =>
          verifyToken(fixture, token, {
            expected: wrongExpected,
            replayDefense,
          }),
        code
      );
      await expectCode(
        () => verifyToken(fixture, token, { replayDefense }),
        "replay_detected"
      );
    }
  );

  it("rejects a signed non-Codex provider and still consumes it", async () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(4);
    const token = resignToken(
      issueToken(fixture),
      fixture.current.signing,
      (claims) => {
        claims.provider = "claude";
      }
    );

    await expectCode(
      () => verifyToken(fixture, token, { replayDefense }),
      "provider_mismatch"
    );
    await expectCode(
      () => verifyToken(fixture, token, { replayDefense }),
      "replay_detected"
    );
  });

  it("rejects a signed request identifier mismatch and keeps it consumed", async () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(4);
    const token = issueToken(fixture);

    await expectCode(
      () =>
        verifyToken(fixture, token, {
          expected: { ...fixture.expected, requestId: "request_2" },
          replayDefense,
        }),
      "request_id_mismatch"
    );
    await expectCode(
      () => verifyToken(fixture, token, { replayDefense }),
      "replay_detected"
    );
  });

  it("detects request identifier and nonce reuse independently", async () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(4);
    await verifyToken(fixture, issueToken(fixture), { replayDefense });

    await expectCode(
      () =>
        verifyToken(fixture, issueToken(fixture, { nonce: "nonce_2" }), {
          replayDefense,
        }),
      "replay_detected"
    );
    await expectCode(
      () =>
        verifyToken(fixture, issueToken(fixture, { requestId: "request_2" }), {
          replayDefense,
        }),
      "replay_detected"
    );
  });

  it("fails closed through the validity of a token rejected at capacity", async () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(1);
    await verifyToken(fixture, issueToken(fixture, { lifetimeSeconds: 2 }), {
      replayDefense,
    });

    await expectCode(
      () =>
        verifyToken(
          fixture,
          issueToken(fixture, {
            requestId: "request_2",
            nonce: "nonce_2",
          }),
          { replayDefense }
        ),
      "replay_defense_unavailable"
    );

    fixture.clock.set(BASE_TIME + 2);
    await expectCode(
      () =>
        verifyToken(
          fixture,
          issueToken(fixture, {
            requestId: "request_3",
            nonce: "nonce_3",
          }),
          { replayDefense }
        ),
      "replay_defense_unavailable"
    );

    fixture.clock.set(BASE_TIME + 62);
    expect(
      (
        await verifyToken(
          fixture,
          issueToken(fixture, {
            requestId: "request_4",
            nonce: "nonce_4",
          }),
          {
            expected: { ...fixture.expected, requestId: "request_4" },
            replayDefense,
          }
        )
      ).requestId
    ).toBe("request_4");
  });

  it("awaits delayed replay enforcement before resolving verification", async () => {
    const fixture = createFixture();
    let releaseConsume: (() => void) | undefined;
    let settled = false;
    const delayed: ReplayDefense = {
      async consume() {
        await new Promise<void>((resolve) => {
          releaseConsume = resolve;
        });
      },
    };

    const verification = verifyToken(fixture, issueToken(fixture), {
      replayDefense: delayed,
    });
    void verification.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await Promise.resolve();

    expect(releaseConsume).toBeTypeOf("function");
    expect(settled).toBe(false);
    releaseConsume?.();
    await expect(verification).resolves.toMatchObject({
      requestId: "request_1",
    });
  });

  it("normalizes async replay-store rejection without leaking its message", async () => {
    const fixture = createFixture();
    const unavailable: ReplayDefense = {
      async consume() {
        throw new Error("redis://user:secret@private-replay-host");
      },
    };

    const error = await captureAssertionError(() =>
      verifyToken(fixture, issueToken(fixture), {
        replayDefense: unavailable,
      })
    );
    expect(error).toMatchObject({
      code: "replay_defense_unavailable",
      message: "Replay defense could not enforce single use",
    });
    expect(error.message).not.toContain("secret");
    expect(error.message).not.toContain("private-replay-host");
  });

  it("atomically accepts only one concurrent use of an assertion", async () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(4);
    const token = issueToken(fixture);
    const results = await Promise.allSettled([
      verifyToken(fixture, token, { replayDefense }),
      verifyToken(fixture, token, { replayDefense }),
    ]);

    const successes = results.filter((result) => result.status === "fulfilled");
    const rejections = results.filter((result) => result.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toMatchObject({
      reason: {
        code: "replay_detected",
        message: "Internal assertion was already consumed",
      },
    });
  });

  it("accepts the explicit previous key only during token validity", async () => {
    const fixture = createFixture();
    const token = issueToken(
      fixture,
      { lifetimeSeconds: 5 },
      fixture.previous.signing
    );
    expect((await verifyToken(fixture, token)).kid).toBe("key-previous");

    const currentOnly: VerificationKeys = {
      current: fixture.verificationKeys.current,
    };
    await expectCode(
      () => verifyToken(fixture, token, { verificationKeys: currentOnly }),
      "invalid_signature"
    );

    fixture.clock.set(BASE_TIME + 5);
    await expectCode(() => verifyToken(fixture, token), "assertion_expired");
  });

  it("rejects unknown key identifiers and ambiguous rotation configuration", async () => {
    const fixture = createFixture();
    const unknown = createKeyPair("key-unknown");
    const token = issueToken(fixture, {}, unknown.signing);
    await expectCode(() => verifyToken(fixture, token), "invalid_signature");

    await expectCode(
      () =>
        verifyToken(fixture, issueToken(fixture), {
          verificationKeys: {
            current: fixture.current.verification,
            previous: {
              keyId: fixture.current.verification.keyId,
              publicKey: fixture.previous.verification.publicKey,
            },
          },
        }),
      "internal_auth_configuration_invalid"
    );
  });

  it("keeps replay state isolated from unrelated unique assertions", async () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(3);
    const ownerAMismatch = {
      ...fixture.expected,
      subject: "user_owner_b",
    };
    await expectCode(
      () =>
        verifyToken(fixture, issueToken(fixture), {
          expected: ownerAMismatch,
          replayDefense,
        }),
      "subject_mismatch"
    );

    const unrelated = issueToken(fixture, {
      requestId: "request_unrelated",
      nonce: "nonce_unrelated",
    });
    expect(
      (
        await verifyToken(fixture, unrelated, {
          expected: { ...fixture.expected, requestId: "request_unrelated" },
          replayDefense,
        })
      ).subject
    ).toBe("user_owner_a");
  });
});
