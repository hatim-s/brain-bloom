import { beforeEach, describe, expect, it, vi } from "vitest";

import { getFreshConvexAuthToken } from "./convex-server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getToken: vi.fn(),
  sessionsGetToken: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: async () => ({
    sessions: { getToken: mocks.sessionsGetToken },
  }),
}));

/** Builds an unsigned JWT carrying exactly the claims a test cares about. */
function createJwt(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
}

const convexJwt = createJwt({ aud: "convex", sub: "user_1" });
const templateJwt = createJwt({ aud: "convex", sub: "user_1", tpl: true });
const foreignJwt = createJwt({ aud: "https://example.com", sub: "user_1" });

/** Signs the request in, so only the token chain is under test. */
function signIn() {
  mocks.auth.mockResolvedValue({
    getToken: mocks.getToken,
    sessionId: "sess_1",
    userId: "user_1",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getToken.mockResolvedValue(null);
});

describe("getFreshConvexAuthToken", () => {
  it("refuses to guess a token for a signed-out request", async () => {
    mocks.auth.mockResolvedValue({
      getToken: mocks.getToken,
      sessionId: null,
      userId: null,
    });

    await expect(getFreshConvexAuthToken()).rejects.toThrow(
      "You must be signed in"
    );
  });

  it("prefers the convex JWT template when the instance has one", async () => {
    signIn();
    mocks.sessionsGetToken.mockResolvedValue({ jwt: templateJwt });

    expect(await getFreshConvexAuthToken()).toBe(templateJwt);
    expect(mocks.sessionsGetToken).toHaveBeenCalledWith("sess_1", "convex");
  });

  it("mints a plain session token when no template exists", async () => {
    signIn();
    mocks.sessionsGetToken
      .mockRejectedValueOnce(new Error("Not Found"))
      .mockResolvedValueOnce({ jwt: convexJwt });

    expect(await getFreshConvexAuthToken()).toBe(convexJwt);
    expect(mocks.sessionsGetToken).toHaveBeenLastCalledWith("sess_1");
  });

  it("rejects a plain token that Convex would not accept", async () => {
    signIn();
    mocks.sessionsGetToken
      .mockRejectedValueOnce(new Error("Not Found"))
      .mockResolvedValueOnce({ jwt: foreignJwt });
    mocks.getToken.mockResolvedValue(convexJwt);

    expect(await getFreshConvexAuthToken()).toBe(convexJwt);
  });

  it("falls back to the request's own token when the session id is stale", async () => {
    signIn();
    mocks.sessionsGetToken.mockRejectedValue(new Error("Not Found"));
    mocks.getToken.mockResolvedValue(convexJwt);

    expect(await getFreshConvexAuthToken()).toBe(convexJwt);
    expect(mocks.sessionsGetToken).toHaveBeenCalledTimes(2);
  });

  it("returns null rather than a token Convex will reject", async () => {
    signIn();
    mocks.sessionsGetToken.mockRejectedValue(new Error("Not Found"));
    mocks.getToken.mockResolvedValue(foreignJwt);

    expect(await getFreshConvexAuthToken()).toBeNull();
  });

  it("returns null when every rung of the chain fails", async () => {
    signIn();
    mocks.sessionsGetToken.mockRejectedValue(new Error("Not Found"));
    mocks.getToken.mockRejectedValue(new Error("no cookie"));

    expect(await getFreshConvexAuthToken()).toBeNull();
  });

  it("survives a token whose payload is not decodable", async () => {
    signIn();
    mocks.sessionsGetToken
      .mockRejectedValueOnce(new Error("Not Found"))
      .mockResolvedValueOnce({ jwt: "not-a-jwt" });

    expect(await getFreshConvexAuthToken()).toBeNull();
  });
});
