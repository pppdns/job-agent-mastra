import { SENTRY_DATA_COLLECTION } from "@copilot/shared";

/**
 * Shared Sentry options for the browser, Node and Edge runtimes. On only in production builds
 * with a DSN: the Fly image inlines NEXT_PUBLIC_SENTRY_DSN at build time, local `.env.local`
 * files never set it, so `pnpm dev`, e2e and `next build` on a laptop send nothing.
 */
export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "production",
  // Everything off: v11 would otherwise send headers, cookies, bodies and user info.
  dataCollection: SENTRY_DATA_COLLECTION,
  tracesSampleRate: 0.1,
  initialScope: { tags: { service: "web" } },
};
