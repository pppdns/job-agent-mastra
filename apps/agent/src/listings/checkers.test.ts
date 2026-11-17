import { describe, expect, it } from "vitest";
import { checkListing, classify, planProbe } from "./checkers";

// Synthetic pages that reproduce only the markup each rule reads (the real pages were checked
// live and in a browser; their URLs are in corpus.json). No third-party text beyond the marker.

const linkedinOpen = `<h2 class="top-card-layout__title">Engineer</h2><button class="top-card-layout__cta--primary">Apply</button>`;
const linkedinClosed = `<h2 class="top-card-layout__title">Engineer</h2><figure class="closed-job"><figcaption class="closed-job__flavor--closed">No longer accepting applications</figcaption></figure>`;
// Open, but the logged-out page shows no Apply button (seen on 28 live jobs).
const linkedinNoApply = `<h2 class="top-card-layout__title">Engineer</h2><a class="see-who-was-hired">See who was hired</a>`;
const nodeskReportMenu = `<div class="report-listing"><button>The job is expired</button><button>The link is broken</button></div>`;
const nodeskExpired = `<a>Job Expired</a><div class="bg-red-050"><p>Looks like this career opportunity is no longer available. We know</p></div>${nodeskReportMenu}`;
const jobgetherReportMenu = `<label>The offer is expired</label>`;

describe("planProbe", () => {
  it.each([
    [
      "https://www.linkedin.com/jobs/view/4490749570/",
      "linkedin",
      "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4490749570",
    ],
    [
      "https://de.linkedin.com/jobs/view/tech-lead-at-acme-4490749570?trk=x",
      "linkedin",
      "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4490749570",
    ],
    [
      "https://job-boards.greenhouse.io/acme/jobs/4748844005?gh_src=x",
      "greenhouse",
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4748844005",
    ],
    [
      "https://boards.greenhouse.io/embed/job_app?for=Acme&token=123456",
      "greenhouse",
      "https://boards-api.greenhouse.io/v1/boards/Acme/jobs/123456",
    ],
    [
      "https://jobs.lever.co/acme/439684e2-2efd-4c48-aa24-5d54c633fd9f/apply",
      "lever",
      "https://api.lever.co/v0/postings/acme/439684e2-2efd-4c48-aa24-5d54c633fd9f",
    ],
    [
      // Lever's API is case-sensitive: keep the company as the URL spells it.
      "https://jobs.lever.co/Clearer/b4fde148-be5a-45bb-ad28-b12c0c60a5db",
      "lever",
      "https://api.lever.co/v0/postings/Clearer/b4fde148-be5a-45bb-ad28-b12c0c60a5db",
    ],
    [
      "https://jobs.eu.lever.co/acme/439684e2-2efd-4c48-aa24-5d54c633fd9f",
      "lever",
      "https://api.eu.lever.co/v0/postings/acme/439684e2-2efd-4c48-aa24-5d54c633fd9f",
    ],
    [
      "https://jobs.ashbyhq.com/Acme/e9f8842c-3ed3-4b89-bd55-f59cff9773cb/application",
      "ashby",
      "https://jobs.ashbyhq.com/Acme/e9f8842c-3ed3-4b89-bd55-f59cff9773cb",
    ],
    [
      "https://jobs.workable.com/view/8WC5qCLvwaUSHdFMRt81Zd/remote-engineer?x=1",
      "workable",
      "https://jobs.workable.com/view/8WC5qCLvwaUSHdFMRt81Zd/remote-engineer",
    ],
    [
      "https://www.dice.com/job-detail/2b9ba774-840f-4fef-a1bf-e647c003406b",
      "dice",
      "https://www.dice.com/job-detail/2b9ba774-840f-4fef-a1bf-e647c003406b",
    ],
    [
      "https://jobgether.com/offer/6af2-solutions-engineer",
      "jobgether",
      "https://jobgether.com/offer/6af2-solutions-engineer",
    ],
    [
      "https://nodesk.co/remote-jobs/acme-analytics-engineer/",
      "nodesk",
      "https://nodesk.co/remote-jobs/acme-analytics-engineer/",
    ],
  ])("%s → %s", (url, site, fetchUrl) => {
    expect(planProbe(url)).toMatchObject({ site, fetchUrl });
  });

  it.each([
    "https://himalayas.app/companies/acme/jobs/engineer", // Cloudflare: skipped
    "https://weworkremotely.com/remote-jobs/acme-engineer",
    "https://hiringcafe.com/job/abc",
    "https://wellfound.com/company/acme/jobs/engineer", // redirects: no verified rule
    "https://apply.workable.com/acme/j/ABC123",
    "https://www.linkedin.com/company/acme",
    "https://example.com/jobs/1",
    "javascript:alert(1)",
    "not a url",
    "https://user:pw@jobs.lever.co/acme/439684e2-2efd-4c48-aa24-5d54c633fd9f",
  ])("no rule for %s", (url) => {
    expect(planProbe(url)).toBeNull();
  });
});

describe("classify", () => {
  it.each([
    ["linkedin", 200, linkedinClosed, "closed"],
    ["linkedin", 404, "", "closed"],
    ["linkedin", 200, linkedinOpen, "open"],
    ["linkedin", 200, linkedinNoApply, "open"],
    ["linkedin", 200, "<html>Sign in</html>", "unknown"],
    ["linkedin", 429, "", "unknown"],
    ["linkedin", 302, "", "unknown"],
    ["greenhouse", 404, "", "closed"],
    ["greenhouse", 200, "{}", "open"],
    ["greenhouse", 500, "", "unknown"],
    ["lever", 404, "", "closed"],
    ["lever", 200, "{}", "open"],
    ["ashby", 404, "", "closed"],
    ["ashby", 200, "<html></html>", "open"],
    ["ashby", 403, "", "unknown"],
    ["workable", 410, "", "closed"],
    ["workable", 200, "", "open"],
    ["workable", 404, "", "unknown"],
    ["dice", 410, "<div>Sorry this job is no longer available. The Similar Jobs</div>", "closed"],
    ["dice", 410, "<html>gone</html>", "unknown"],
    ["dice", 200, "", "open"],
    ["jobgether", 410, "<p> This job has expired on Jobgether </p>", "closed"],
    ["jobgether", 200, jobgetherReportMenu, "open"],
    ["jobgether", 403, "", "unknown"],
    ["nodesk", 200, nodeskExpired, "closed"],
    ["nodesk", 200, nodeskReportMenu, "open"],
    ["nodesk", 404, "", "unknown"],
  ] as const)("%s %i → %s", (site, status, body, verdict) => {
    expect(classify(site, { status, body }).verdict).toBe(verdict);
  });
});

describe("checkListing", () => {
  const probe = planProbe("https://www.linkedin.com/jobs/view/4490749570/");
  if (!probe) throw new Error("expected a probe");

  it("fetches the probe URL and classifies the answer", async () => {
    const fetched: string[] = [];
    const check = await checkListing(probe, async (url) => {
      fetched.push(url);
      return { status: 200, body: linkedinClosed };
    });
    expect(fetched).toEqual(["https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4490749570"]);
    expect(check).toMatchObject({ site: "linkedin", verdict: "closed", status: 200 });
  });

  it("turns a network failure into unknown", async () => {
    const check = await checkListing(probe, async () => {
      throw new Error("ECONNRESET");
    });
    expect(check).toMatchObject({ verdict: "unknown", signal: "could not be reached" });
  });
});
