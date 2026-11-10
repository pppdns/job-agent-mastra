import { afterEach, describe, expect, it, vi } from "vitest";
import { CooldownError } from "../types";
import { httpJson } from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("httpJson", () => {
  it("turns a Retry-After longer than it retries for into a cooldown, without retrying", async () => {
    const fetch = vi.fn(
      async () => new Response("{}", { status: 429, headers: { "retry-after": "120" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const call = httpJson(new URL("https://himalayas.app/jobs/api/search"));
    await expect(call).rejects.toBeInstanceOf(CooldownError);
    await expect(call).rejects.toThrow("himalayas.app is rate limiting (asked to wait 120 s)");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("names only the host and status on other errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret body", { status: 403 })),
    );
    await expect(httpJson(new URL("https://api.resend.com/emails"))).rejects.toThrow(
      "api.resend.com answered 403",
    );
  });
});
