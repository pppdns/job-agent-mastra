import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkListing, type ListingCheck, planProbe } from "./checkers";

// Re-checks the hand-verified corpus live. A `closed` listing must still read closed: if not,
// a site changed its pages and its rule needs a look. An `open` control that now reads closed
// has probably just closed: reported, not failed (replace it with a fresh open listing).

type Entry = { url: string; expect: "open" | "closed"; note?: string };
const corpus: { listings: Entry[] } = JSON.parse(
  readFileSync(new URL("./corpus.json", import.meta.url), "utf8"),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("listing corpus (live)", () => {
  it("classifies every verified listing as expected", async () => {
    const results: (Entry & { got: ListingCheck })[] = [];
    for (const entry of corpus.listings) {
      const probe = planProbe(entry.url);
      expect(probe, `no rule for ${entry.url}`).not.toBeNull();
      if (!probe) continue;
      results.push({ ...entry, got: await checkListing(probe) });
      await sleep(probe.site === "linkedin" ? 1_500 : 500);
    }
    for (const r of results) {
      console.log(`${r.expect.padEnd(6)} → ${r.got.verdict.padEnd(7)} ${r.got.signal} · ${r.url}`);
    }
    const nowClosed = results.filter((r) => r.expect === "open" && r.got.verdict === "closed");
    if (nowClosed.length > 0) {
      console.warn(
        `open controls that closed since (replace them):\n${nowClosed.map((r) => `  ${r.url}`).join("\n")}`,
      );
    }
    const broken = results.filter(
      (r) =>
        (r.expect === "closed" && r.got.verdict !== "closed") ||
        (r.expect === "open" && r.got.verdict === "unknown"),
    );
    expect(broken.map((r) => `${r.expect} → ${r.got.verdict} (${r.got.signal}): ${r.url}`)).toEqual(
      [],
    );
  });
});
