import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The commit SHA in the Fly image (unset locally). An open page from an older deploy then
  // hard-reloads on navigation instead of breaking, and AppUpdateBanner compares it with
  // /api/version. See docs/deploy.md.
  deploymentId: process.env.SENTRY_RELEASE || undefined,
  cacheComponents: true,
  partialPrefetching: true,
  agentRules: false,
  // `pnpm ngrok` serves the dev app from an ngrok host.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.dev"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Uploads source maps to Sentry when SENTRY_AUTH_TOKEN is set (the Fly image build, from the
// GitHub deploy); without it nothing is uploaded and the build output is unchanged.
export default withSentryConfig(nextConfig, {
  org: "denes-43421",
  project: "job-copilot",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  release: { name: process.env.SENTRY_RELEASE || undefined },
  widenClientFileUpload: true,
  telemetry: false,
  silent: !process.env.SENTRY_AUTH_TOKEN,
});
