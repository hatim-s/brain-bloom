import { generateKeyPairSync, sign as signBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BoundedReplayCache,
  type Clock,
  type ExpectedAssertionContext,
  type GatewayOperation,
  InternalAssertionError,
  issueInternalAssertion,
  type ReplayDefense,
  type SigningKey,
  type VerificationKeys,
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

/** Captures and checks the stable error code from one rejected verification. */
function expectCode(
  action: () => unknown,
  code: InternalAssertionError["code"]
): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(InternalAssertionError);
    expect((error as InternalAssertionError).code).toBe(code);
  }
}

describe("internal gateway assertions", () => {
  it("issues and verifies the exact Codex-only v1 context", () => {
    const fixture = createFixture();
    const claims = verifyToken(fixture, issueToken(fixture));

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

  it("rejects missing, malformed, and signature-tampered assertions", () => {
    const fixture = createFixture();
    expectCode(() => verifyToken(fixture, undefined), "missing_assertion");
    expectCode(() => verifyToken(fixture, "not-a-token"), "invalid_assertion");

    const token = issueToken(fixture);
    const [header, claims, signature] = token.split(".");
    const tamperedSignatureBytes = Buffer.from(signature, "base64url");
    // Flipping a decoded signature bit always changes the Ed25519 signature,
    // unlike replacing a possibly unused base64 padding bit.
    tamperedSignatureBytes[0] ^= 0x01;
    const tamperedSignature = tamperedSignatureBytes.toString("base64url");
    expectCode(
      () => verifyToken(fixture, `${header}.${claims}.${tamperedSignature}`),
      "invalid_signature"
    );

    const tamperedClaims = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(claims, "base64url").toString("utf8")),
        subject: "user_owner_b",
      })
    ).toString("base64url");
    expectCode(
      () => verifyToken(fixture, `${header}.${tamperedClaims}.${signature}`),
      "invalid_signature"
    );
  });

  it("enforces a strict maximum lifetime and exact no-skew boundaries", () => {
    const fixture = createFixture();
    expectCode(
      () => issueToken(fixture, { lifetimeSeconds: 61 }),
      "assertion_lifetime_invalid"
    );

    const token = issueToken(fixture, { lifetimeSeconds: 10 });
    fixture.clock.set(BASE_TIME - 1);
    expectCode(() => verifyToken(fixture, token), "assertion_from_future");

    fixture.clock.set(BASE_TIME + 9);
    expect(verifyToken(fixture, token).exp).toBe(BASE_TIME + 10);

    fixture.clock.set(BASE_TIME + 10);
    expectCode(() => verifyToken(fixture, token), "assertion_expired");
  });

  it("rejects signed assertions whose encoded lifetime exceeds the limit", () => {
    const fixture = createFixture();
    const token = issueToken(fixture);
    const oversized = resignToken(token, fixture.current.signing, (claims) => {
      claims.exp = BASE_TIME + 61;
    });

    expectCode(
      () => verifyToken(fixture, oversized),
      "assertion_lifetime_invalid"
    );
  });

  it("rejects a correctly signed assertion from another protocol version", () => {
    const fixture = createFixture();
    const token = resignToken(
      issueToken(fixture),
      fixture.current.signing,
      (claims) => {
        claims.version = 2;
      }
    );

    expectCode(
      () => verifyToken(fixture, token),
      "unsupported_assertion_version"
    );
  });

  it("rejects authenticated noncanonical header and payload JSON", () => {
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
      expectCode(() => verifyToken(fixture, token), "noncanonical_assertion");
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
    (_label, code, expectedOverride) => {
      const fixture = createFixture();
      const replayDefense = new BoundedReplayCache(4);
      const token = issueToken(fixture);
      const wrongExpected = {
        ...fixture.expected,
        ...expectedOverride,
      } as ExpectedAssertionContext;

      expectCode(
        () =>
          verifyToken(fixture, token, {
            expected: wrongExpected,
            replayDefense,
          }),
        code
      );
      expectCode(
        () => verifyToken(fixture, token, { replayDefense }),
        "replay_detected"
      );
    }
  );

  it("rejects a signed non-Codex provider and still consumes it", () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(4);
    const token = resignToken(
      issueToken(fixture),
      fixture.current.signing,
      (claims) => {
        claims.provider = "claude";
      }
    );

    expectCode(
      () => verifyToken(fixture, token, { replayDefense }),
      "provider_mismatch"
    );
    expectCode(
      () => verifyToken(fixture, token, { replayDefense }),
      "replay_detected"
    );
  });

  it("rejects a signed request identifier mismatch and keeps it consumed", () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(4);
    const token = issueToken(fixture);

    expectCode(
      () =>
        verifyToken(fixture, token, {
          expected: { ...fixture.expected, requestId: "request_2" },
          replayDefense,
        }),
      "request_id_mismatch"
    );
    expectCode(
      () => verifyToken(fixture, token, { replayDefense }),
      "replay_detected"
    );
  });

  it("detects request identifier and nonce reuse independently", () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(4);
    verifyToken(fixture, issueToken(fixture), { replayDefense });

    expectCode(
      () =>
        verifyToken(fixture, issueToken(fixture, { nonce: "nonce_2" }), {
          replayDefense,
        }),
      "replay_detected"
    );
    expectCode(
      () =>
        verifyToken(fixture, issueToken(fixture, { requestId: "request_2" }), {
          replayDefense,
        }),
      "replay_detected"
    );
  });

  it("fails closed through the validity of a token rejected at capacity", () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(1);
    verifyToken(fixture, issueToken(fixture, { lifetimeSeconds: 2 }), {
      replayDefense,
    });

    expectCode(
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
    expectCode(
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
      verifyToken(
        fixture,
        issueToken(fixture, {
          requestId: "request_4",
          nonce: "nonce_4",
        }),
        {
          expected: { ...fixture.expected, requestId: "request_4" },
          replayDefense,
        }
      ).requestId
    ).toBe("request_4");
  });

  it("normalizes unavailable replay state into a fail-closed error", () => {
    const fixture = createFixture();
    const unavailable: ReplayDefense = {
      consume() {
        throw new Error("state backend disconnected");
      },
    };

    expectCode(
      () =>
        verifyToken(fixture, issueToken(fixture), {
          replayDefense: unavailable,
        }),
      "replay_defense_unavailable"
    );
  });

  it("accepts the explicit previous key only during token validity", () => {
    const fixture = createFixture();
    const token = issueToken(
      fixture,
      { lifetimeSeconds: 5 },
      fixture.previous.signing
    );
    expect(verifyToken(fixture, token).kid).toBe("key-previous");

    const currentOnly: VerificationKeys = {
      current: fixture.verificationKeys.current,
    };
    expectCode(
      () => verifyToken(fixture, token, { verificationKeys: currentOnly }),
      "invalid_signature"
    );

    fixture.clock.set(BASE_TIME + 5);
    expectCode(() => verifyToken(fixture, token), "assertion_expired");
  });

  it("rejects unknown key identifiers and ambiguous rotation configuration", () => {
    const fixture = createFixture();
    const unknown = createKeyPair("key-unknown");
    const token = issueToken(fixture, {}, unknown.signing);
    expectCode(() => verifyToken(fixture, token), "invalid_signature");

    expectCode(
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

  it("keeps replay state isolated from unrelated unique assertions", () => {
    const fixture = createFixture();
    const replayDefense = new BoundedReplayCache(3);
    const ownerAMismatch = {
      ...fixture.expected,
      subject: "user_owner_b",
    };
    expectCode(
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
      verifyToken(fixture, unrelated, {
        expected: { ...fixture.expected, requestId: "request_unrelated" },
        replayDefense,
      }).subject
    ).toBe("user_owner_a");
  });
});
