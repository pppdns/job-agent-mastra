import { describe, expect, it } from "vitest";
import { checkUrl, isBlockedAddress, type Resolver } from "./url-guard";

const dns =
  (table: Record<string, string[]>): Resolver =>
  async (host) => {
    const answer = table[host];
    if (!answer) throw new Error("ENOTFOUND");
    return answer;
  };

const publicDns = dns({
  "www.linkedin.com": ["13.107.42.14", "2620:1ec:21::14"],
  "rebind.example.com": ["93.184.216.34", "10.0.0.5"],
  "internal.example.com": ["192.168.1.10"],
  "metadata.example.com": ["169.254.169.254"],
  "mapped.example.com": ["::ffff:127.0.0.1"],
});

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "13.107.42.14", "2620:1ec:21::14"])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("checkUrl", () => {
  it("accepts a public https URL", async () => {
    const result = await checkUrl("https://www.linkedin.com/jobs/view/123", publicDns);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["file:///etc/passwd", /scheme/],
    ["javascript:alert(1)", /scheme/],
    ["ftp://www.linkedin.com/x", /scheme/],
    ["https://user:pw@www.linkedin.com/", /credentials/],
    ["https://www.linkedin.com:8443/", /port/],
    ["http://localhost/admin", /local/],
    ["http://printer.local/", /local/],
    ["http://intranet/", /fully qualified/],
    ["http://127.0.0.1/", /private/],
    ["http://[::1]/", /private/],
    ["http://169.254.169.254/latest/meta-data", /private/],
    ["https://internal.example.com/", /private/],
    ["https://metadata.example.com/", /private/],
    ["https://mapped.example.com/", /private/],
    ["https://rebind.example.com/", /private/],
    ["https://nxdomain.example.com/", /resolve/],
    ["not a url", /valid/],
    [`https://www.linkedin.com/${"a".repeat(3000)}`, /too long/],
  ])("rejects %s", async (raw, reason) => {
    const result = await checkUrl(raw, publicDns);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });
});
