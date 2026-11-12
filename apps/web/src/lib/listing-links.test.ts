import { describe, expect, it } from "vitest";
import { listingLinks } from "./listing-links";

describe("listingLinks", () => {
  it("puts the canonical URL first and dedupes listing sources", () => {
    const links = listingLinks("https://www.linkedin.com/jobs/view/123/", [
      { kind: "linkedin", url: "https://www.linkedin.com/jobs/view/123/" },
      { kind: "ats", url: "https://jobs.acme.example/eng/42" },
      { kind: "web", url: "https://acme.example/about" },
      { kind: "pasted", url: null },
    ]);
    expect(links).toEqual([
      {
        url: "https://www.linkedin.com/jobs/view/123/",
        label: "LinkedIn listing",
        host: "linkedin.com",
      },
      {
        url: "https://jobs.acme.example/eng/42",
        label: "Employer posting",
        host: "jobs.acme.example",
      },
    ]);
  });

  it("labels a canonical URL without a matching source by host", () => {
    expect(listingLinks("https://boards.example/job/9", [])).toEqual([
      { url: "https://boards.example/job/9", label: "Listing", host: "boards.example" },
    ]);
  });

  it("never links non-http URLs", () => {
    expect(
      listingLinks("javascript:alert(1)", [{ kind: "ats", url: "data:text/html,hi" }]),
    ).toEqual([]);
  });

  it("falls back to discovery postings: apply page, then board listing", () => {
    const links = listingLinks(
      null,
      [],
      [
        {
          url: "https://himalayas.app/jobs/1",
          applyUrl: "https://jobs.ashbyhq.com/orbit/123",
          sourceLabel: "Himalayas",
        },
      ],
    );
    expect(links.map((l) => [l.label, l.host])).toEqual([
      ["Apply page", "jobs.ashbyhq.com"],
      ["Himalayas listing", "himalayas.app"],
    ]);
  });
});
