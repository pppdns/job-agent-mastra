import { SensitiveDataFilter } from "@mastra/observability";
import { describe, expect, it } from "vitest";
import { TRACE_SENSITIVE_FIELDS } from "./index";

describe("trace redaction", () => {
  it("redacts keys, auth headers and cookies but keeps ordinary fields", () => {
    const filter = new SensitiveDataFilter({ sensitiveFields: TRACE_SENSITIVE_FIELDS });
    const span = {
      id: "s",
      attributes: { headers: { Authorization: "Bearer s3cret", Cookie: "sid=abc" } },
      input: { apiKey: "tvly-123", url: "https://a.example", jobId: "j1" },
      output: '{"access_token":"tok-9","status":"ok"}',
    };
    const out = JSON.stringify(filter.process(span as never));
    expect(out).not.toMatch(/s3cret|sid=abc|tvly-123|tok-9/);
    expect(out).toContain("https://a.example");
    expect(out).toContain("j1");
  });
});
