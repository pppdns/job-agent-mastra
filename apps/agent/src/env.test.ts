import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const secret = "x".repeat(24);

describe("loadEnv", () => {
  it("accepts mock mode without a gateway key", () => {
    expect(loadEnv({ LLM_MODE: "mock", AGENT_SHARED_SECRET: secret }).LLM_MODE).toBe("mock");
  });

  it("requires the gateway key in live mode", () => {
    expect(() => loadEnv({ AGENT_SHARED_SECRET: secret })).toThrow(/AI_GATEWAY_API_KEY/);
  });

  it("rejects a short shared secret and never echoes values", () => {
    const error = (() => {
      try {
        loadEnv({ LLM_MODE: "mock", AGENT_SHARED_SECRET: "short-secret-value" });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toMatch(/AGENT_SHARED_SECRET/);
    expect(error?.message).not.toContain("short-secret-value");
  });

  it("treats empty provider keys as unset", () => {
    const env = loadEnv({ LLM_MODE: "mock", AGENT_SHARED_SECRET: secret, TAVILY_API_KEY: "" });
    expect(env.TAVILY_API_KEY).toBeUndefined();
  });
});
