import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFetchGatewayTransport,
  createGatewayServerClient,
  type GatewayAssertionSigner,
  type GatewayAuthorityResolver,
  type GatewayClientError,
  type GatewayClientRequest,
  type GatewayResponseBody,
  type GatewayServerClientOptions,
  type GatewayTransport,
  type GatewayTransportRequest,
  type GatewayTransportResponse,
} from "./server-client.ts";

vi.mock("server-only", () => ({}));

const ORIGIN = "https://gateway.example.test";
const RESPONSE_URL = `${ORIGIN}/internal/v1/operations/chat`;
const SECRET = "secret-canary-never-reflect";

type Fixture = Readonly<{
  authorityResolver: GatewayAuthorityResolver;
  signer: GatewayAssertionSigner;
  transport: GatewayTransport;
  authorizeCalls: ReturnType<typeof vi.fn>;
  signerCalls: ReturnType<typeof vi.fn>;
  transportCalls: ReturnType<typeof vi.fn>;
}>;

/** Builds one authority result that only the injected server dependency returns. */
function authorizedResolution(
  overrides: Readonly<{
    ownerId?: string;
    resource?: Record<string, unknown>;
    connection?: Record<string, unknown>;
    operation?: GatewayClientRequest["operation"];
  }> = {}
) {
  return {
    ownerId: overrides.ownerId ?? "owner-1",
    resource: {
      type: "mindmap" as const,
      requestedId: "map-1",
      canonicalId: "canonical-map-1",
      ...overrides.resource,
    },
    connection: {
      requestedId: "connection-1",
      canonicalId: "canonical-connection-1",
      provider: "codex" as const,
      status: "connected" as const,
      isDefault: true,
      ...overrides.connection,
    },
    operation: overrides.operation ?? ("chat" as const),
  };
}

/** Builds a valid server-derived request with explicit narrow overrides. */
function request(
  overrides: Partial<GatewayClientRequest> = {}
): GatewayClientRequest {
  return {
    resource: { type: "mindmap", id: "map-1" },
    connectionId: "connection-1",
    operation: "chat",
    requestId: "request-1",
    ...overrides,
  };
}

/** Encodes a JSON value as a configurable bounded response stream. */
function jsonResponse(
  value: unknown,
  overrides: Partial<GatewayTransportResponse> & {
    chunkSize?: number;
  } = {}
): GatewayTransportResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const chunkSize = overrides.chunkSize ?? bytes.length;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  });
  return {
    status: 200,
    redirected: false,
    url: RESPONSE_URL,
    headers: new Headers({ "content-type": "application/json" }),
    body,
    ...overrides,
  };
}

/** Builds a response whose body disposal can be asserted independently. */
function trackedJsonResponse(
  value: unknown,
  overrides: Partial<GatewayTransportResponse> = {},
  cancelImplementation?: () => void | PromiseLike<void>
): Readonly<{
  response: GatewayTransportResponse;
  cancel: ReturnType<typeof vi.fn>;
}> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const cancel = vi.fn(
    cancelImplementation ?? (() => stream.cancel().then(() => undefined))
  );
  const body: GatewayResponseBody = {
    getReader: () => stream.getReader(),
    cancel,
  };
  return {
    response: {
      status: 200,
      redirected: false,
      url: RESPONSE_URL,
      headers: new Headers({ "content-type": "application/json" }),
      body,
      ...overrides,
    },
    cancel,
  };
}

/** Creates injected dependencies whose calls can be inspected without I/O. */
function fixture(
  response: GatewayTransportResponse = jsonResponse({
    ok: true,
    data: { answer: "done" },
  })
): Fixture {
  const authorizeCalls = vi.fn(async () => authorizedResolution());
  const signerCalls = vi.fn(async () => "signed-assertion");
  const transportCalls = vi.fn(async () => response);
  return {
    authorityResolver: { authorize: authorizeCalls },
    signer: { sign: signerCalls },
    transport: { send: transportCalls },
    authorizeCalls,
    signerCalls,
    transportCalls,
  };
}

/** Creates the client with small test-safe limits and no global dependencies. */
function client(
  current: Fixture,
  overrides: Partial<GatewayServerClientOptions> = {}
) {
  return createGatewayServerClient({
    gatewayOrigin: ORIGIN,
    gatewayOriginAllowlist: [ORIGIN],
    issuer: "sprig-next-server",
    audience: "sprig-agent-gateway",
    authorityResolver: current.authorityResolver,
    assertionSigner: current.signer,
    transport: current.transport,
    requestTimeoutMs: 1_000,
    authorizationTimeoutMs: 100,
    signerTimeoutMs: 100,
    maxResponseBytes: 4_096,
    maxResponseChunks: 32,
    ...overrides,
  });
}

/** Reads the stable error code without depending on implementation messages. */
async function expectCode(
  operation: () => Promise<unknown>,
  code: GatewayClientError["code"]
): Promise<void> {
  await expect(operation()).rejects.toMatchObject({
    name: "GatewayClientError",
    message: "Gateway client request failed",
    code,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("gateway server client", () => {
  it("binds exact owner, connection, provider, operation, request, resource, and route", async () => {
    const current = fixture();
    const result = await client(current).execute(request());

    expect(result).toEqual({ answer: "done" });
    expect(current.authorizeCalls).toHaveBeenCalledTimes(1);
    expect(current.authorizeCalls.mock.calls[0]?.[0]).toEqual({
      resource: { type: "mindmap", id: "map-1" },
      connectionId: "connection-1",
      provider: "codex",
      operation: "chat",
      requireDefault: true,
    });
    expect(current.authorizeCalls.mock.calls[0]?.[1]).toMatchObject({
      signal: expect.any(AbortSignal),
      deadlineAtMilliseconds: expect.any(Number),
    });
    expect(current.signerCalls.mock.calls[0]?.[0]).toEqual({
      issuer: "sprig-next-server",
      audience: "sprig-agent-gateway",
      subject: "owner-1",
      connectionId: "canonical-connection-1",
      provider: "codex",
      operation: "chat",
      requestId: "request-1",
    });

    const transportRequest = current.transportCalls.mock
      .calls[0]?.[0] as GatewayTransportRequest;
    expect(transportRequest).toEqual({
      url: RESPONSE_URL,
      method: "POST",
      headers: {
        authorization: "Bearer signed-assertion",
        "content-type": "application/json",
        "x-request-id": "request-1",
      },
      body: JSON.stringify({
        input: {
          resource: { type: "mindmap", id: "canonical-map-1" },
        },
      }),
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(transportRequest.body).not.toMatch(
      /command|model|token|credential|environment/i
    );
  });

  it.each([
    [null, "missing"],
    [
      authorizedResolution({ resource: { requestedId: "other-map" } }),
      "resource mismatch",
    ],
    [
      authorizedResolution({ connection: { requestedId: "other-connection" } }),
      "connection mismatch",
    ],
    [
      authorizedResolution({ connection: { provider: "claude" } }),
      "provider mismatch",
    ],
    [authorizedResolution({ connection: { status: "revoked" } }), "revoked"],
    [authorizedResolution({ connection: { status: "expired" } }), "expired"],
    [authorizedResolution({ connection: { isDefault: false } }), "non-default"],
    [authorizedResolution({ operation: "node-editing" }), "operation mismatch"],
    [{ ownerId: SECRET }, "malformed"],
  ] as const)(
    "collapses %s authority state to the same oracle-resistant result",
    async (resolved, _description) => {
      const current = fixture();
      current.authorizeCalls.mockResolvedValueOnce(resolved);

      await expect(client(current).execute(request())).rejects.toMatchObject({
        code: "authorization_unavailable",
        status: 404,
        message: "Gateway client request failed",
      });
      expect(current.signerCalls).not.toHaveBeenCalled();
      expect(current.transportCalls).not.toHaveBeenCalled();
    }
  );

  it.each([
    "cross-owner resource",
    "cross-owner connection",
    "store unavailable",
  ])("does not expose %s resolution failure", async () => {
    const current = fixture();
    current.authorizeCalls.mockRejectedValueOnce(
      new Error(`authority detail ${SECRET}`)
    );

    await expect(client(current).execute(request())).rejects.toMatchObject({
      code: "authorization_unavailable",
      status: 404,
      message: "Gateway client request failed",
    });
    expect(current.signerCalls).not.toHaveBeenCalled();
    expect(current.transportCalls).not.toHaveBeenCalled();
  });

  it.each([
    { ownerId: "browser-owner-2" },
    { context: { ownerId: "browser-owner-2" } },
    { resourceOwnerId: "browser-owner-2" },
  ])(
    "rejects browser-forged authority fields before resolution",
    async (forgery) => {
      const current = fixture();
      const forged = { ...request(), ...forgery } as GatewayClientRequest;

      await expectCode(
        () => client(current).execute(forged),
        "gateway_client_configuration_invalid"
      );
      expect(current.authorizeCalls).not.toHaveBeenCalled();
      expect(current.signerCalls).not.toHaveBeenCalled();
    }
  );

  it.each([
    "http://gateway.example.test",
    "https://user:pass@gateway.example.test",
    "https://gateway.example.test/evil",
    "https://gateway.example.test?next=https://evil.test",
    "https://gateway.example.test#evil",
    "https://gateway.example.test@evil.test",
    "https://gateway.example.test/",
    "https://gateway.example.test.",
    "https://localhost",
    "https://agent.localhost",
    "https://agent.local",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://xn--gteway-9za.example.test",
    "https://gаteway.example.test",
    "https://Gateway.example.test",
    "https://gateway.example.test:443",
  ])(
    "rejects noncanonical or injectable gateway origin %s",
    (gatewayOrigin) => {
      const current = fixture();
      expect(() =>
        client(current, {
          gatewayOrigin,
          gatewayOriginAllowlist: [gatewayOrigin],
        })
      ).toThrowError("Gateway client request failed");
    }
  );

  it("requires a nonempty exact allowlist and exact selected membership", () => {
    const current = fixture();
    expect(() => client(current, { gatewayOriginAllowlist: [] })).toThrowError(
      "Gateway client request failed"
    );
    expect(() =>
      client(current, {
        gatewayOrigin: "https://other.example.test",
        gatewayOriginAllowlist: [ORIGIN],
      })
    ).toThrowError("Gateway client request failed");
  });

  it("allows a non-default port only as an exact explicit member", async () => {
    const current = fixture(
      jsonResponse(
        { ok: true, data: "ok" },
        {
          url: "https://gateway.example.test:8443/internal/v1/operations/chat",
        }
      )
    );
    await expect(
      client(current, {
        gatewayOrigin: "https://gateway.example.test:8443",
        gatewayOriginAllowlist: ["https://gateway.example.test:8443"],
      }).execute(request())
    ).resolves.toBe("ok");
  });

  it.each([
    {
      redirected: true,
      url: "https://evil.test/internal/v1/operations/chat",
    },
    { redirected: false, url: "https://evil.test/internal/v1/operations/chat" },
    {
      redirected: false,
      url: `${ORIGIN}/internal/v1/operations/chat?url=https://evil.test`,
    },
  ])(
    "rejects redirected or cross-route response metadata",
    async (metadata) => {
      const current = fixture(jsonResponse({ ok: true, data: null }, metadata));
      await expectCode(
        () => client(current).execute(request()),
        "gateway_response_invalid"
      );
    }
  );

  it.each([
    "redirect",
    "cross-route URL",
    "invalid status",
    "invalid content type",
    "throwing metadata",
    "invalid schema",
  ] as const)("cancels the body on early %s rejection", async (scenario) => {
    const overrides: {
      status?: number;
      redirected?: boolean;
      url?: string;
      headers?: GatewayTransportResponse["headers"];
    } = {};
    let value: unknown = { ok: true, data: null };
    if (scenario === "redirect") overrides.redirected = true;
    if (scenario === "cross-route URL") {
      overrides.url = "https://evil.example.test/internal/v1/operations/chat";
    }
    if (scenario === "invalid status") overrides.status = 201;
    if (scenario === "invalid content type") {
      overrides.headers = new Headers({ "content-type": "text/plain" });
    }
    if (scenario === "throwing metadata") {
      overrides.headers = {
        get() {
          throw new Error(SECRET);
        },
      };
    }
    if (scenario === "invalid schema") {
      value = { ok: true, data: null, extra: true };
    }
    const tracked = trackedJsonResponse(value, overrides);
    const current = fixture(tracked.response);

    await expectCode(
      () => client(current).execute(request()),
      "gateway_response_invalid"
    );
    expect(tracked.cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["rejecting cleanup", "stalled cleanup"] as const)(
    "bounds and observes %s without replacing the response failure",
    async (scenario) => {
      const tracked = trackedJsonResponse(
        { ok: true, data: null },
        { redirected: true },
        () =>
          scenario === "rejecting cleanup"
            ? Promise.reject(new Error(SECRET))
            : new Promise<void>(() => undefined)
      );
      const current = fixture(tracked.response);

      await expectCode(
        () => client(current, { cleanupTimeoutMs: 10 }).execute(request()),
        "gateway_response_invalid"
      );
      expect(tracked.cancel).toHaveBeenCalledTimes(1);
    }
  );

  it("rejects runtime attempts to choose an arbitrary operation", async () => {
    const current = fixture();
    await expectCode(
      () =>
        client(current).execute(
          request({ operation: "shell" as GatewayClientRequest["operation"] })
        ),
      "gateway_client_configuration_invalid"
    );
    expect(current.authorizeCalls).not.toHaveBeenCalled();
  });

  it("enforces byte and chunk limits before parsing a response", async () => {
    const oversized = fixture(
      jsonResponse({ ok: true, data: "x".repeat(128) })
    );
    await expectCode(
      () => client(oversized, { maxResponseBytes: 32 }).execute(request()),
      "response_too_large"
    );

    const flooded = fixture(
      jsonResponse({ ok: true, data: "small" }, { chunkSize: 1 })
    );
    await expectCode(
      () => client(flooded, { maxResponseChunks: 2 }).execute(request()),
      "response_too_large"
    );
  });

  it("times out a stalled response stream and cancels its reader", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const current = fixture({
      status: 200,
      redirected: false,
      url: RESPONSE_URL,
      headers: new Headers({ "content-type": "application/json" }),
      body,
    });

    await expectCode(
      () =>
        client(current, {
          requestTimeoutMs: 20,
          authorizationTimeoutMs: 10,
          signerTimeoutMs: 10,
        }).execute(request()),
      "request_timeout"
    );
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });

  it("propagates caller abort without reflecting the abort reason", async () => {
    const controller = new AbortController();
    const current = fixture({
      status: 200,
      redirected: false,
      url: RESPONSE_URL,
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream<Uint8Array>(),
    });
    const pending = client(current).execute(
      request({ signal: controller.signal })
    );
    controller.abort(new Error(SECRET));

    await expectCode(() => pending, "request_aborted");
    await expect(pending).rejects.not.toThrow(SECRET);
  });

  it("never invokes dependencies for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort(new Error(SECRET));
    const current = fixture();

    await expectCode(
      () => client(current).execute(request({ signal: controller.signal })),
      "request_aborted"
    );
    expect(current.authorizeCalls).not.toHaveBeenCalled();
    expect(current.signerCalls).not.toHaveBeenCalled();
    expect(current.transportCalls).not.toHaveBeenCalled();
  });

  it("closes the abort race between authority and signer handoff", async () => {
    const controller = new AbortController();
    const current = fixture();
    current.authorizeCalls.mockImplementationOnce(async () => {
      controller.abort(new Error(SECRET));
      return authorizedResolution();
    });

    await expectCode(
      () => client(current).execute(request({ signal: controller.signal })),
      "request_aborted"
    );
    expect(current.signerCalls).not.toHaveBeenCalled();
    expect(current.transportCalls).not.toHaveBeenCalled();
  });

  it("normalizes hostile request getters without reflecting their messages", async () => {
    const current = fixture();
    const hostile = Object.defineProperty({}, "resource", {
      get() {
        throw new Error(SECRET);
      },
    }) as GatewayClientRequest;

    await expectCode(
      () => client(current).execute(hostile),
      "gateway_client_configuration_invalid"
    );
    await expect(client(current).execute(hostile)).rejects.not.toThrow(SECRET);
  });

  it.each(["authority", "signer"] as const)(
    "bounds a stalled %s and observes its late rejection",
    async (stage) => {
      let rejectLate: ((error: Error) => void) | undefined;
      const stalled = new Promise<never>((_resolve, reject) => {
        rejectLate = reject;
      });
      const current = fixture();
      if (stage === "authority") {
        current.authorizeCalls.mockReturnValueOnce(stalled);
      } else {
        current.signerCalls.mockReturnValueOnce(stalled);
      }

      const pending = client(current, {
        authorizationTimeoutMs: 10,
        signerTimeoutMs: 10,
      }).execute(request());
      if (stage === "authority") {
        await expect(pending).rejects.toMatchObject({
          code: "authorization_unavailable",
          status: 404,
          message: "Gateway client request failed",
        });
      } else {
        await expectCode(() => pending, "gateway_unavailable");
      }
      rejectLate?.(new Error(SECRET));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(current.transportCalls).not.toHaveBeenCalled();
    }
  );

  it("observes transport settlement after an authoritative timeout", async () => {
    let rejectLate: ((error: Error) => void) | undefined;
    const current = fixture();
    current.transportCalls.mockReturnValueOnce(
      new Promise<never>((_resolve, reject) => {
        rejectLate = reject;
      })
    );

    await expectCode(
      () =>
        client(current, {
          requestTimeoutMs: 20,
          authorizationTimeoutMs: 10,
          signerTimeoutMs: 10,
        }).execute(request()),
      "request_timeout"
    );
    rejectLate?.(new Error(SECRET));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it.each(["timeout", "abort"] as const)(
    "disposes a response that fulfills after transport %s",
    async (outcome) => {
      let resolveLate:
        | ((response: GatewayTransportResponse) => void)
        | undefined;
      const current = fixture();
      current.transportCalls.mockReturnValueOnce(
        new Promise<GatewayTransportResponse>((resolve) => {
          resolveLate = resolve;
        })
      );
      const controller = new AbortController();
      const pending = client(current, {
        requestTimeoutMs: outcome === "abort" ? 1_000 : 20,
        authorizationTimeoutMs: 10,
        signerTimeoutMs: 10,
      }).execute(
        request(outcome === "abort" ? { signal: controller.signal } : {})
      );
      const observed = pending.then(
        () => null,
        (error: unknown) => error
      );
      await vi.waitFor(() =>
        expect(current.transportCalls).toHaveBeenCalledTimes(1)
      );
      if (outcome === "abort") controller.abort();
      await expect(observed).resolves.toMatchObject({
        code: outcome === "abort" ? "request_aborted" : "request_timeout",
        message: "Gateway client request failed",
      });

      const tracked = trackedJsonResponse({ ok: true, data: null });
      resolveLate?.(tracked.response);
      await vi.waitFor(() => expect(tracked.cancel).toHaveBeenCalledTimes(1));
    }
  );

  it.each([
    [201, { ok: true, data: null }, "application/json"],
    [200, { ok: true, data: null, extra: true }, "application/json"],
    [200, { ok: false, error: { code: "unauthorized" } }, "application/json"],
    [
      401,
      { ok: false, error: { code: "operation_failed" } },
      "application/json",
    ],
    [401, { ok: false, error: { code: "unknown" } }, "application/json"],
    [200, { ok: true, data: null }, "text/json"],
  ])(
    "rejects status/schema/content-type ambiguity",
    async (status, value, contentType) => {
      const current = fixture(
        jsonResponse(value, {
          status,
          headers: new Headers({ "content-type": contentType }),
        })
      );
      await expectCode(
        () => client(current).execute(request()),
        "gateway_response_invalid"
      );
    }
  );

  it("rejects malformed JSON and a missing body", async () => {
    const malformedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{not json"));
        controller.close();
      },
    });
    const cancelMalformed = vi.fn(() => malformedStream.cancel());
    const malformed = fixture({
      status: 200,
      redirected: false,
      url: RESPONSE_URL,
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader: () => malformedStream.getReader(),
        cancel: cancelMalformed,
      },
    });
    await expectCode(
      () => client(malformed).execute(request()),
      "gateway_response_invalid"
    );
    expect(cancelMalformed).toHaveBeenCalledTimes(1);

    const missing = fixture({
      status: 200,
      redirected: false,
      url: RESPONSE_URL,
      headers: new Headers({ "content-type": "application/json" }),
      body: null,
    });
    await expectCode(
      () => client(missing).execute(request()),
      "gateway_response_invalid"
    );
  });

  it("maps only exact gateway error/status pairs to stable codes", async () => {
    const current = fixture(
      jsonResponse(
        { ok: false, error: { code: "rate_limited" } },
        { status: 429 }
      )
    );
    await expectCode(() => client(current).execute(request()), "rate_limited");
  });

  it("never reflects dependency, assertion, transport, or response secrets", async () => {
    const scenarios = [
      () => {
        const current = fixture();
        current.signerCalls.mockRejectedValueOnce(new Error(SECRET));
        return client(current).execute(request());
      },
      () => {
        const current = fixture();
        current.signerCalls.mockResolvedValueOnce(`${SECRET}\r\nheader: value`);
        return client(current).execute(request());
      },
      () => {
        const current = fixture();
        current.transportCalls.mockRejectedValueOnce(new Error(SECRET));
        return client(current).execute(request());
      },
      () => {
        const current = fixture({
          status: 502,
          redirected: false,
          url: RESPONSE_URL,
          headers: new Headers({ "content-type": "application/json" }),
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(SECRET));
              controller.close();
            },
          }),
        });
        return client(current).execute(request());
      },
    ];

    for (const scenario of scenarios) {
      await expect(scenario()).rejects.not.toThrow(SECRET);
    }
  });

  it("has no API-key, operator-login, URL, path, issuer, audience, model, or command fallback", async () => {
    const current = fixture();
    current.authorizeCalls.mockResolvedValueOnce(null);
    const invocation = request();
    expect(Object.keys(invocation).sort()).toEqual([
      "connectionId",
      "operation",
      "requestId",
      "resource",
    ]);
    expect(Object.keys(invocation.resource).sort()).toEqual(["id", "type"]);

    await expectCode(
      () => client(current).execute(invocation),
      "authorization_unavailable"
    );
    expect(current.signerCalls).not.toHaveBeenCalled();
    expect(current.transportCalls).not.toHaveBeenCalled();
  });
});

describe("injected fetch transport", () => {
  it("forwards the fixed URL and redirect-error policy to only the injected fetch", async () => {
    const response = new Response("{}", {
      headers: { "content-type": "application/json" },
    });
    const fetchImplementation = vi.fn(async () => response);
    const transport = createFetchGatewayTransport(fetchImplementation);
    const controller = new AbortController();

    await expect(
      transport.send({
        url: RESPONSE_URL,
        method: "POST",
        headers: { authorization: "Bearer assertion" },
        body: "{}",
        redirect: "error",
        signal: controller.signal,
      })
    ).resolves.toBe(response);
    expect(fetchImplementation).toHaveBeenCalledWith(RESPONSE_URL, {
      method: "POST",
      headers: { authorization: "Bearer assertion" },
      body: "{}",
      redirect: "error",
      signal: controller.signal,
    });
  });
});
