import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db, getJobDetail, migrateDb, setJobStatus, upsertJob } from "@copilot/db";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProbeFetch, ProbeResponse } from "./checkers";
import { buildClosedEmail, sendClosedEmail } from "./report";
import { runListingCheck } from "./run";

let db: Db;
beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "listings-run-")), "test.db")}`);
  await migrateDb(db);
});

const CLOSED_LI = `<h2 class="top-card-layout__title">x</h2><figcaption class="closed-job__flavor--closed">No longer accepting applications</figcaption>`;
const OPEN_LI = `<h2 class="top-card-layout__title">x</h2>`;

/** Chat jobs are always in scope; status set as given. */
async function job(url: string, status: "new" | "shortlisted" | "to_apply" | "applied" = "new") {
  const { job } = await upsertJob(db, { canonicalUrl: url, title: `Job ${url}`, company: "Acme" });
  if (status !== "new") await setJobStatus(db, job.id, status);
  return job.id;
}

const fake = (answers: Record<string, ProbeResponse>) => {
  const calls: string[] = [];
  const fetchProbe: ProbeFetch = async (url) => {
    calls.push(url);
    const answer = answers[url];
    if (!answer) throw new Error(`unexpected fetch ${url}`);
    return answer;
  };
  return { calls, fetchProbe };
};

const statusOf = async (id: string) => (await getJobDetail(db, id))?.job.status;

const guest = (id: string) => `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
const noWait = async () => {};

describe("runListingCheck", () => {
  it("dismisses closed new, shortlisted and to-apply jobs, keeps open, unknown and applied ones", async () => {
    const closedNew = await job("https://www.linkedin.com/jobs/view/1000001/");
    const closedShortlisted = await job(
      "https://www.linkedin.com/jobs/view/1000002/",
      "shortlisted",
    );
    const open = await job("https://www.linkedin.com/jobs/view/1000003/");
    const unknown = await job("https://jobs.ashbyhq.com/acme/e9f8842c-3ed3-4b89-bd55-f59cff9773cb");
    const applied = await job("https://www.linkedin.com/jobs/view/1000005/", "applied");
    const unsupported = await job("https://himalayas.app/companies/acme/jobs/x");
    const closedToApply = await job("https://www.linkedin.com/jobs/view/1000006/", "to_apply");
    const { calls, fetchProbe } = fake({
      [guest("1000006")]: { status: 404, body: "" },
      [guest("1000001")]: { status: 200, body: CLOSED_LI },
      [guest("1000002")]: { status: 404, body: "" },
      [guest("1000003")]: { status: 200, body: OPEN_LI },
      "https://jobs.ashbyhq.com/acme/e9f8842c-3ed3-4b89-bd55-f59cff9773cb": {
        status: 503,
        body: "",
      },
    });

    const result = await runListingCheck(db, { fetchProbe, wait: noWait });

    expect(calls).not.toContain(guest("1000005"));
    expect(result).toMatchObject({ jobs: 6, checks: 5, open: 1, unknown: 1, unsupported: 1 });
    expect(result.closed.map((c) => [c.id, c.previousStatus]).sort()).toEqual(
      [
        [closedNew, "new"],
        [closedShortlisted, "shortlisted"],
        [closedToApply, "to_apply"],
      ].sort(),
    );
    expect(await statusOf(closedNew)).toBe("dismissed");
    expect(await statusOf(closedShortlisted)).toBe("dismissed");
    expect(await statusOf(closedToApply)).toBe("dismissed");
    for (const id of [open, unknown, unsupported]) expect(await statusOf(id)).toBe("new");
    expect(await statusOf(applied)).toBe("applied");
  });

  it("changes nothing in a dry run", async () => {
    const id = await job("https://www.linkedin.com/jobs/view/1000001/");
    const { fetchProbe } = fake({ [guest("1000001")]: { status: 200, body: CLOSED_LI } });
    const result = await runListingCheck(db, { fetchProbe, wait: noWait, dryRun: true });
    expect(result.closed).toHaveLength(1);
    expect(await statusOf(id)).toBe("new");
  });

  it("stops asking a site for the rest of the run once it rate-limits", async () => {
    await job("https://www.linkedin.com/jobs/view/1000001/");
    await job("https://www.linkedin.com/jobs/view/1000002/");
    const { calls, fetchProbe } = fake({
      [guest("1000001")]: { status: 429, body: "" },
      [guest("1000002")]: { status: 429, body: "" },
    });
    const result = await runListingCheck(db, { fetchProbe, wait: noWait });
    expect(calls).toHaveLength(1);
    expect(result.rateLimited).toEqual(["linkedin"]);
    expect(result.unknown).toBe(2);
  });

  it("paces requests to the same site", async () => {
    await job("https://www.linkedin.com/jobs/view/1000001/");
    await job("https://www.linkedin.com/jobs/view/1000002/");
    const waits: number[] = [];
    const { fetchProbe } = fake({
      [guest("1000001")]: { status: 200, body: OPEN_LI },
      [guest("1000002")]: { status: 200, body: OPEN_LI },
    });
    await runListingCheck(db, { fetchProbe, wait: async (ms) => void waits.push(ms) });
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(1_000);
  });
});

describe("closed email", () => {
  const closed = [
    {
      id: "a",
      title: "Engineer <script>",
      company: "Acme & Co",
      previousStatus: "new",
      url: "https://www.linkedin.com/jobs/view/1/",
      site: "linkedin" as const,
      signal: "LinkedIn: No longer accepting applications",
    },
    {
      id: "b",
      title: "Lead",
      company: null,
      previousStatus: "shortlisted",
      url: "https://jobs.lever.co/x/y",
      site: "lever" as const,
      signal: "Lever API: job not found (404)",
    },
    {
      id: "c",
      title: "Staff",
      company: "Initech",
      previousStatus: "to_apply",
      url: "https://jobs.lever.co/x/z",
      site: "lever" as const,
      signal: "Lever API: job not found (404)",
    },
  ];

  it("lists to-apply then shortlisted jobs first, escapes values and links to the app", () => {
    const email = buildClosedEmail(closed, "https://app.example/");
    expect(email.subject).toBe("🧹 3 jobs no longer available (1 to apply, 1 shortlisted)");
    expect(email.text.indexOf("[To apply] Staff")).toBeLessThan(
      email.text.indexOf("[Shortlisted] Lead"),
    );
    expect(email.text.indexOf("[Shortlisted] Lead")).toBeLessThan(email.text.indexOf("Engineer"));
    expect(email.html).toContain("Engineer &lt;script&gt;");
    expect(email.html).toContain("Acme &amp; Co");
    expect(email.html).toContain('href="https://app.example/jobs/a"');
  });

  it("sends nothing without closed jobs or without configuration", async () => {
    const http = async () => {
      throw new Error("must not send");
    };
    const config = { apiKey: "k", to: "me@example.com", from: "f", baseUrl: "https://app" };
    expect((await sendClosedEmail(http, config, [])).status).toBe("skipped");
    expect((await sendClosedEmail(http, { ...config, apiKey: undefined }, closed)).status).toBe(
      "skipped",
    );
  });

  it("posts one email to Resend", async () => {
    const sent: unknown[] = [];
    const http = async (_url: URL, init?: { body?: unknown }) => void sent.push(init?.body);
    const config = { apiKey: "k", to: "me@example.com", from: "f", baseUrl: "https://app" };
    expect(await sendClosedEmail(http, config, closed)).toMatchObject({ status: "sent" });
    expect(sent).toEqual([expect.objectContaining({ to: ["me@example.com"] })]);
  });
});
