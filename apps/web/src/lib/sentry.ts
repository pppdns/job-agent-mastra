/**
 * Shared Sentry options for the browser, Node and Edge runtimes. On only in production builds
 * with a DSN: the Fly image inlines NEXT_PUBLIC_SENTRY_DSN at build time, local `.env.local`
 * files never set it, so `pnpm dev`, e2e and `next build` on a laptop send nothing.
 */
export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "production",
  // No dataCollection: the SDK's conservative defaults (no headers, cookies, bodies or user info).
  tracesSampleRate: 0.1,
  initialScope: { tags: { service: "web" } },
};
