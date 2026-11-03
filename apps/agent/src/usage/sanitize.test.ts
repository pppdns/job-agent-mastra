import { describe, expect, it } from "vitest";
import { sanitizeForEvent } from "./sanitize";

describe("sanitizeForEvent", () => {
  it("redacts secrets, omits page text, truncates and bounds depth", () => {
    const out = sanitizeForEvent({
      url: "https://a.example/x",
      apiKey: "tvly-123",
      headers: { Authorization: "Bearer s3cret" },
      untrustedText: "x".repeat(5000),
      note: "y".repeat(400),
      list: Array.from({ length: 15 }, (_, i) => i),
      deep: { a: { b: { c: { d: 1 } } } },
    }) as Record<string, unknown>;
    expect(out.url).toBe("https://a.example/x");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.headers).toEqual({ Authorization: "[redacted]" });
    expect(out.untrustedText).toBe("[5000 chars omitted]");
    expect(String(out.note)).toMatch(/… \(400 chars\)$/);
    expect(out.list).toHaveLength(11);
    expect(JSON.stringify(out.deep)).toContain("{…}");
    expect(JSON.stringify(out)).not.toMatch(/tvly-123|s3cret/);
  });
});
