import { describe, expect, it } from "vitest";
import {
  createLoginThrottle,
  createSessionToken,
  loginConfig,
  passwordMatches,
  SESSION_MAX_AGE_S,
  safeNextPath,
  verifySessionToken,
} from "./session";

const config = { password: "correct horse battery", secret: "s".repeat(32) };

describe("loginConfig", () => {
  it("is off without APP_PASSWORD", () => {
    expect(loginConfig({})).toBeNull();
    expect(loginConfig({ APP_PASSWORD: "" })).toBeNull();
  });

  it("needs the shared secret to sign sessions", () => {
    expect(() => loginConfig({ APP_PASSWORD: "pw" })).toThrow(/AGENT_SHARED_SECRET/);
    expect(loginConfig({ APP_PASSWORD: "pw", AGENT_SHARED_SECRET: "x" })).toEqual({
      password: "pw",
      secret: "x",
    });
  });
});

describe("passwordMatches", () => {
  it("accepts only the exact password", () => {
    expect(passwordMatches(config, "correct horse battery")).toBe(true);
    expect(passwordMatches(config, "correct horse batter")).toBe(false);
    expect(passwordMatches(config, "")).toBe(false);
  });
});

describe("session tokens", () => {
  const now = 1_800_000_000_000;

  it("round-trips until expiry", () => {
    const token = createSessionToken(config, now);
    expect(verifySessionToken(config, token, now)).toBe(true);
    expect(verifySessionToken(config, token, now + SESSION_MAX_AGE_S * 1000 - 1)).toBe(true);
    expect(verifySessionToken(config, token, now + SESSION_MAX_AGE_S * 1000)).toBe(false);
  });

  it("rejects tampered, malformed and missing tokens", () => {
    const token = createSessionToken(config, now);
    const [expiry, signature] = token.split(".");
    expect(verifySessionToken(config, `${Number(expiry) + 1}.${signature}`, now)).toBe(false);
    expect(verifySessionToken(config, `${expiry}.${signature?.slice(1)}x`, now)).toBe(false);
    expect(verifySessionToken(config, `${token}.extra`, now)).toBe(false);
    expect(verifySessionToken(config, "nonsense", now)).toBe(false);
    expect(verifySessionToken(config, undefined, now)).toBe(false);
  });

  it("ends when the password or the secret changes", () => {
    const token = createSessionToken(config, now);
    expect(verifySessionToken({ ...config, password: "new password" }, token, now)).toBe(false);
    expect(verifySessionToken({ ...config, secret: "t".repeat(32) }, token, now)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths only", () => {
    expect(safeNextPath("/jobs?tab=active")).toBe("/jobs?tab=active");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("/\t/evil.example")).toBe("/");
    expect(safeNextPath("/\n/evil.example")).toBe("/");
    expect(safeNextPath("/%2F/evil.example")).toBe("/%2F/evil.example");
  });
});

describe("login throttle", () => {
  it("blocks a client after too many failures, for the rest of the window", () => {
    const throttle = createLoginThrottle(3, 60_000);
    for (let i = 0; i < 3; i++) throttle.fail("a", 1000);
    expect(throttle.blockedFor("a", 1000)).toBe(60_000);
    expect(throttle.blockedFor("b", 1000)).toBe(0);
    expect(throttle.blockedFor("a", 61_000)).toBe(0);
  });

  it("forgets failures after a successful login", () => {
    const throttle = createLoginThrottle(2, 60_000);
    throttle.fail("a", 0);
    throttle.reset("a");
    throttle.fail("a", 0);
    expect(throttle.blockedFor("a", 0)).toBe(0);
  });

  it("caps how many clients it tracks", () => {
    const throttle = createLoginThrottle(1, 60_000, 2);
    throttle.fail("a", 0);
    throttle.fail("b", 0);
    throttle.fail("c", 0);
    expect(throttle.blockedFor("a", 0)).toBe(0);
    expect(throttle.blockedFor("c", 0)).toBeGreaterThan(0);
  });
});
