import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// No `server-only` import: src/proxy.ts uses this module too.

type Env = Record<string, string | undefined>;

export const SESSION_COOKIE = "copilot_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export interface LoginConfig {
  password: string;
  secret: string;
}

/**
 * The login is on only when APP_PASSWORD is set (the deployment sets it; local dev, e2e and
 * the ngrok tunnel leave it unset). Sessions are signed with AGENT_SHARED_SECRET.
 */
export function loginConfig(env: Env = process.env): LoginConfig | null {
  const password = env.APP_PASSWORD;
  if (!password) return null;
  const secret = env.AGENT_SHARED_SECRET;
  if (!secret) throw new Error("APP_PASSWORD needs AGENT_SHARED_SECRET to sign sessions");
  return { password, secret };
}

export function loginEnabled(env: Env = process.env): boolean {
  return Boolean(env.APP_PASSWORD);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time check of a typed password (both sides hashed to the same length first). */
export function passwordMatches(config: LoginConfig, input: string): boolean {
  return timingSafeEqual(sha256(input), sha256(config.password));
}

/** The password's hash is part of the signature, so changing APP_PASSWORD ends every session. */
function sign(config: LoginConfig, expiresAt: number): string {
  return createHmac("sha256", config.secret)
    .update(`copilot-session|${expiresAt}|`)
    .update(sha256(config.password))
    .digest("base64url");
}

/** `<expiry ms>.<signature>`; there is one user, so the token carries nothing else. */
export function createSessionToken(config: LoginConfig, now: number = Date.now()): string {
  const expiresAt = now + SESSION_MAX_AGE_S * 1000;
  return `${expiresAt}.${sign(config, expiresAt)}`;
}

export function verifySessionToken(
  config: LoginConfig,
  token: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const [expiry, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !expiry || !signature || !/^\d+$/.test(expiry)) return false;
  const expiresAt = Number(expiry);
  if (expiresAt <= now) return false;
  const expected = Buffer.from(sign(config, expiresAt));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Only same-site paths, so `?next=` can't send the browser to another host after login. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  // URL parsing drops tabs/newlines and treats "\\" like "/", which could turn this into "//host".
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return "/";
  const base = "http://copilot.invalid";
  const url = new URL(next, base);
  if (url.origin !== base || url.pathname.startsWith("/login")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface LoginThrottle {
  /** Milliseconds until another attempt is allowed (0 = allowed). */
  blockedFor(key: string, now?: number): number;
  fail(key: string, now?: number): void;
  reset(key: string): void;
}

/** In-memory failure counter per client (one process, one user: no shared store needed). */
export function createLoginThrottle(
  maxFailures = 10,
  windowMs = 10 * 60 * 1000,
  maxKeys = 1000,
): LoginThrottle {
  const failures = new Map<string, { count: number; since: number }>();
  const current = (key: string, now: number) => {
    const entry = failures.get(key);
    if (entry && now - entry.since >= windowMs) {
      failures.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    blockedFor(key, now = Date.now()) {
      const entry = current(key, now);
      return entry && entry.count >= maxFailures ? entry.since + windowMs - now : 0;
    },
    fail(key, now = Date.now()) {
      const entry = current(key, now);
      if (entry) entry.count += 1;
      else {
        if (failures.size >= maxKeys) failures.delete(failures.keys().next().value as string);
        failures.set(key, { count: 1, since: now });
      }
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
