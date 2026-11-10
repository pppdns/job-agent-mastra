import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

export function register() {
  // Same options in the Node and Edge runtimes (proxy.ts runs on Edge).
  Sentry.init(sentryOptions);
}

/** Reports errors from server components, route handlers, server actions and the proxy. */
export const onRequestError = Sentry.captureRequestError;
