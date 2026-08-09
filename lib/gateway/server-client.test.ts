import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFetchGatewayTransport,
  createGatewayServerClient,
  type GatewayAssertionSigner,
  type GatewayClientError,
  type GatewayClientRequest,
  type GatewayConnectionResolver,
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
  resolver: GatewayConnectionResolver;
  signer: GatewayAssertionSigner;
  transport: GatewayTransport;
  resolverCalls: ReturnType<typeof vi.fn>;
  signerCalls: ReturnType<typeof vi.fn>;
  transportCalls: ReturnType<typeof vi.fn>;
}>;

/** Builds a valid server-derived request with explicit narrow overrides. */
function request(
  overrides: Partial<GatewayClientRequest> = {}
): GatewayClientRequest {
  return {
    context: {
      ownerId: "owner-1",
      resource: { type: "mindmap", id: "map-1" },
    },
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

/** Creates injected dependencies whose calls can be inspected without I/O. */
function fixture(
  response: GatewayTransportResponse = jsonResponse({
    ok: true,
    data: { answer: "done" },
  })
): Fixture {
  const resolverCalls = vi.fn(async () => ({
    ownerId: "owner-1",
    connectionId: "connection-1",
    provider: "codex" as const,
    status: "connected" as const,
    isDefault: true,
  }));
  const signerCalls = vi.fn(async () => "signed-assertion");
  const transportCalls = vi.fn(async () => response);
  return {
    resolver: { resolve: resolverCalls },
    signer: { sign: signerCalls },
    transport: { send: transportCalls },
    resolverCalls,
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
    issuer: "sprig-next-server",
    audience: "sprig-agent-gateway",
    connectionResolver: current.resolver,
    assertionSigner: current.signer,
    transport: current.transport,
    requestTimeoutMs: 1_000,
    resolverTimeoutMs: 100,
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
    expect(current.resolverCalls).toHaveBeenCalledTimes(1);
    expect(current.resolverCalls.mock.calls[0]?.[0]).toEqual({
      ownerId: "owner-1",
      connectionId: "connection-1",
      provider: "codex",
      requireDefault: true,
    });
    expect(current.resolverCalls.mock.calls[0]?.[1]).toMatchObject({
      signal: expect.any(AbortSignal),
      deadlineAtMilliseconds: expect.any(Number),
    });
    expect(current.signerCalls.mock.calls[0]?.[0]).toEqual({
      issuer: "sprig-next-server",
      audience: "sprig-agent-gateway",
      subject: "owner-1",
      connectionId: "connection-1",
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
        input: { resource: { type: "mindmap", id: "map-1" } },
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
      {
        ownerId: "owner-2",
        connectionId: "connection-1",
        provider: "codex",
        status: "connected",
        isDefault: true,
      },
      "cross-owner",
    ],
    [
      {
        ownerId: "owner-1",
        connectionId: "connection-2",
        provider: "codex",
        status: "connected",
        isDefault: true,
      },
      "connection mismatch",
    ],
    [
      {
        ownerId: "owner-1",
        connectionId: "connection-1",
        provider: "claude",
        status: "connected",
        isDefault: true,
      },
      "provider mismatch",
    ],
    [
      {
        ownerId: "owner-1",
        connectionId: "connection-1",
        provider: "codex",
        status: "revoked",
        isDefault: true,
      },
      "revoked",
    ],
    [
      {
        ownerId: "owner-1",
        connectionId: "connection-1",
        provider: "codex",
        status: "expired",
        isDefault: true,
      },
      "expired",
    ],
    [
      {
        ownerId: "owner-1",
        connectionId: "connection-1",
        provider: "codex",
        status: "connected",
        isDefault: false,
      },
      "non-default",
    ],
  ] as const)(
    "fails closed on %s connection state",
    async (resolved, _description) => {
      const current = fixture();
      current.resolverCalls.mockResolvedValueOnce(resolved);

      await expectCode(
        () => client(current).execute(request()),
        "connection_unavailable"
      );
      expect(current.signerCalls).not.toHaveBeenCalled();
      expect(current.transportCalls).not.toHaveBeenCalled();
    }
  );

  it("does not expose whether a probed connection belongs to another owner", async () => {
    const current = fixture();
    current.resolverCalls.mockRejectedValueOnce(
      new Error(`database owner mismatch ${SECRET}`)
    );

    await expectCode(
      () => client(current).execute(request()),
      "gateway_unavailable"
    );
    await expect(client(current).execute(request())).resolves.toBeDefined();
  });

  it.each([
    "http://gateway.example.test",
    "https://user:pass@gateway.example.test",
    "https://gateway.example.test/evil",
    "https://gateway.example.test?next=https://evil.test",
    "https://gateway.example.test#evil",
    "https://gateway.example.test@evil.test",
    "https://gateway.example.test/",
  ])(
    "rejects noncanonical or injectable gateway origin %s",
    (gatewayOrigin) => {
      const current = fixture();
      expect(() => client(current, { gatewayOrigin })).toThrowError(
        "Gateway client request failed"
      );
    }
  );

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

  it("rejects runtime attempts to choose an arbitrary operation", async () => {
    const current = fixture();
    await expectCode(
      () =>
        client(current).execute(
          request({ operation: "shell" as GatewayClientRequest["operation"] })
        ),
      "gateway_client_configuration_invalid"
    );
    expect(current.resolverCalls).not.toHaveBeenCalled();
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
          resolverTimeoutMs: 10,
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
    expect(current.resolverCalls).not.toHaveBeenCalled();
    expect(current.signerCalls).not.toHaveBeenCalled();
    expect(current.transportCalls).not.toHaveBeenCalled();
  });

  it("closes the abort race between resolver and signer handoff", async () => {
    const controller = new AbortController();
    const current = fixture();
    current.resolverCalls.mockImplementationOnce(async () => {
      controller.abort(new Error(SECRET));
      return {
        ownerId: "owner-1",
        connectionId: "connection-1",
        provider: "codex",
        status: "connected",
        isDefault: true,
      };
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
    const hostile = Object.defineProperty({}, "context", {
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

  it.each(["resolver", "signer"] as const)(
    "bounds a stalled %s and observes its late rejection",
    async (stage) => {
      let rejectLate: ((error: Error) => void) | undefined;
      const stalled = new Promise<never>((_resolve, reject) => {
        rejectLate = reject;
      });
      const current = fixture();
      if (stage === "resolver") {
        current.resolverCalls.mockReturnValueOnce(stalled);
      } else {
        current.signerCalls.mockReturnValueOnce(stalled);
      }

      await expectCode(
        () =>
          client(current, {
            resolverTimeoutMs: 10,
            signerTimeoutMs: 10,
          }).execute(request()),
        "gateway_unavailable"
      );
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
          resolverTimeoutMs: 10,
          signerTimeoutMs: 10,
        }).execute(request()),
      "request_timeout"
    );
    rejectLate?.(new Error(SECRET));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

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
    const malformed = fixture({
      status: 200,
      redirected: false,
      url: RESPONSE_URL,
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{not json"));
          controller.close();
        },
      }),
    });
    await expectCode(
      () => client(malformed).execute(request()),
      "gateway_response_invalid"
    );

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
    current.resolverCalls.mockResolvedValueOnce(null);
    const invocation = request();
    expect(Object.keys(invocation).sort()).toEqual([
      "connectionId",
      "context",
      "operation",
      "requestId",
    ]);
    expect(Object.keys(invocation.context).sort()).toEqual([
      "ownerId",
      "resource",
    ]);

    await expectCode(
      () => client(current).execute(invocation),
      "connection_unavailable"
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
