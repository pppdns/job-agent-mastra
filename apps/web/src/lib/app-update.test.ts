import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { afterEach, describe, expect, it } from "vitest";
import {
  getAppUpdateState,
  guardAction,
  isVersionSkewError,
  markAppStale,
  resetAppUpdateState,
} from "./app-update";

afterEach(resetAppUpdateState);

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

describe("guardAction", () => {
  it("passes results through", async () => {
    await expect(guardAction(async (a: number) => a + 1)(1)).resolves.toBe(2);
    expect(getAppUpdateState()).toBe("current");
  });

  it("rethrows other errors", async () => {
    const action = guardAction(async () => {
      throw new Error("boom");
    });
    await expect(action()).rejects.toThrow("boom");
    expect(getAppUpdateState()).toBe("current");
  });

  it("marks the app outdated and never settles on version skew", async () => {
    const action = guardAction(async () => {
      throw new UnrecognizedActionError("Server Action not found");
    });
    const outcome = await Promise.race([
      action().then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((done) => setTimeout(() => done("pending"), 20)),
    ]);
    expect(outcome).toBe("pending");
    expect(getAppUpdateState()).toBe("failed");
  });

  it("keeps a failure over a later stale check", async () => {
    void guardAction(async () => {
      throw new UnrecognizedActionError("x");
    })();
    await new Promise((done) => setTimeout(done, 0));
    markAppStale();
    expect(getAppUpdateState()).toBe("failed");
  });
});
