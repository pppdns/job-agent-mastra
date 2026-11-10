import type { ContextWithMastra } from "@mastra/core/server";
import * as Sentry from "@sentry/node";

/**
 * Sentry error reporting, on only in the production image (NODE_ENV=production with a DSN, both
 * set on Fly). Local dev, tests, e2e and evals never send anything. See docs/deploy.md#sentry.
 */
export const sentryEnabled =
  process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_DSN?.trim());

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || "production",
    release: process.env.SENTRY_RELEASE || undefined,
    // No dataCollection: the SDK's conservative defaults (no headers, cookies, bodies or user info).
    // Agent traces stay in Mastra's own observability; Sentry gets errors only.
    tracesSampleRate: 0,
    initialScope: { tags: { service: "agent" } },
  });
}

/** Reports an error the app handles itself (a failed run, a failed workflow step). No-op when off. */
export function reportError(error: unknown, tags?: Record<string, string>): void {
  if (sentryEnabled) Sentry.captureException(error, tags ? { tags } : undefined);
}

/** Duck-typed Hono HTTPException: an expected 4xx/5xx the route chose to return. */
function httpStatus(error: Error): number | undefined {
  const { status, getResponse } = error as Error & { status?: unknown; getResponse?: unknown };
  return typeof status === "number" && typeof getResponse === "function" ? status : undefined;
}

/**
 * `server.onError` for Mastra: reports unhandled route errors, then answers like Mastra's default
 * handler (HTTP exceptions keep their status and message; anything else is a bare 500).
 */
export function onServerError(error: Error, c: ContextWithMastra): Response {
  const status = httpStatus(error);
  if (status !== undefined) {
    if (status >= 500) reportError(error);
    return c.json({ error: error.message }, status as 400);
  }
  reportError(error);
  c.get("mastra").getLogger()?.error("unhandled server error", { error });
  return c.json({ error: "Internal Server Error" }, 500);
}
