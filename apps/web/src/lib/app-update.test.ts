import * as Sentry from "@sentry/nextjs";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAppUpdateState,
  isVersionSkewError,
  markAppStale,
  resetAppUpdateState,
  SAVE_FAILED_MESSAGE,
  SAVE_FAILED_SKEW_MESSAGE,
  saveFailed,
} from "./app-update";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

afterEach(() => {
  resetAppUpdateState();
  vi.clearAllMocks();
});

describe("isVersionSkewError", () => {
  it("recognizes a server action the server no longer knows", () => {
    expect(isVersionSkewError(new UnrecognizedActionError("Server Action not found"))).toBe(true);
  });

  it("recognizes a missing lazy chunk", () => {
    const chunk = new Error("Loading chunk 42 failed.");
    chunk.name = "ChunkLoadError";
    expect(isVersionSkewError(chunk)).toBe(true);
    expect(isVersionSkewError(new Error("Failed to load chunk /_next/static/chunks/a.js"))).toBe(
      true,
    );
    expect(isVersionSkewError(new TypeError("Failed to fetch dynamically imported module"))).toBe(
      true,
    );
  });

  it("ignores other errors", () => {
    expect(isVersionSkewError(new Error("Job not found"))).toBe(false);
    expect(isVersionSkewError("Loading chunk 1 failed")).toBe(false);
    expect(isVersionSkewError(undefined)).toBe(false);
  });
});

describe("saveFailed", () => {
  it("raises the banner on version skew without reporting it", () => {
    expect(saveFailed(new UnrecognizedActionError("Server Action not found"))).toBe(
      SAVE_FAILED_SKEW_MESSAGE,
    );
    expect(getAppUpdateState()).toBe("failed");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("reports other failures and leaves the banner alone", () => {
    const error = new Error("An unexpected response was received from the server.");
    expect(saveFailed(error)).toBe(SAVE_FAILED_MESSAGE);
    expect(getAppUpdateState()).toBe("current");
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("doesn't report an error the server already reported", () => {
    const error = Object.assign(new Error("An error occurred in the Server Components render."), {
      digest: "123",
    });
    expect(saveFailed(error)).toBe(SAVE_FAILED_MESSAGE);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("keeps a failure over a later stale check", () => {
    saveFailed(new UnrecognizedActionError("x"));
    markAppStale();
    expect(getAppUpdateState()).toBe("failed");
  });
});
