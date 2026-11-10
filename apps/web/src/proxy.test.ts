import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";
import { createSessionToken, SESSION_COOKIE } from "./server/session";

const secret = "s".repeat(32);
const request = (path: string, cookie?: string) =>
  new NextRequest(`http://app.test${path}`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });

afterEach(() => vi.unstubAllEnvs());

describe("proxy without APP_PASSWORD", () => {
  it("lets everything through and opens a fresh chat on /", () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect(proxy(request("/jobs")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/")).headers.get("location")).toMatch(
      /^http:\/\/app\.test\/c\/[\w-]{36}$/,
    );
  });
});

describe("proxy with APP_PASSWORD", () => {
  const password = "correct horse battery";
  const signIn = () => {
    vi.stubEnv("APP_PASSWORD", password);
    vi.stubEnv("AGENT_SHARED_SECRET", secret);
  };

  it("sends pages to /login and keeps where you were going", () => {
    signIn();
    const response = proxy(request("/jobs?tab=active"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/jobs?tab=active");
    expect(new URL(proxy(request("/")).headers.get("location") ?? "").search).toBe("");
  });

  it("answers API calls with 401", () => {
    signIn();
    expect(proxy(request("/api/run-status")).status).toBe(401);
  });

  it("rejects a forged cookie", () => {
    signIn();
    expect(proxy(request("/api/run-status", "1999999999999.forged")).status).toBe(401);
  });

  it("passes a valid session through", () => {
    signIn();
    const token = createSessionToken({ password, secret });
    expect(proxy(request("/jobs", token)).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/", token)).headers.get("location")).toMatch(/\/c\/[\w-]{36}$/);
  });
});
