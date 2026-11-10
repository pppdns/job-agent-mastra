import { describe, expect, it } from "vitest";
import { atsKey } from "./ats";

const uuid = "9f47da32-dd07-46ea-94ea-1e77d661af92";

describe("atsKey", () => {
  it("reads the same key from every way a job URL is written", () => {
    for (const url of [
      "https://boards.greenhouse.io/acme/jobs/5290677007",
      "https://job-boards.greenhouse.io/acme/jobs/5290677007?gh_src=x",
      "https://job-boards.eu.greenhouse.io/Acme/jobs/5290677007#app",
      "https://boards.greenhouse.io/embed/job_app?for=acme&token=5290677007",
    ]) {
      expect(atsKey(url)).toBe("greenhouse:acme:5290677007");
    }
    expect(atsKey(`https://jobs.lever.co/acme/${uuid}/apply`)).toBe(`lever:acme:${uuid}`);
    expect(atsKey(`https://jobs.eu.lever.co/acme/${uuid.toUpperCase()}`)).toBe(
      `lever:acme:${uuid}`,
    );
    expect(atsKey(`https://jobs.ashbyhq.com/xero/${uuid}/application`)).toBe(`ashby:xero:${uuid}`);
    expect(atsKey("https://apply.workable.com/acme/j/9B1C2D3E4F/apply")).toBe(
      "workable:acme:9b1c2d3e4f",
    );
    expect(atsKey("https://acme.workable.com/j/9B1C2D3E4F")).toBe("workable:acme:9b1c2d3e4f");
  });

  it("returns null for anything that isn't one job on a known ATS", () => {
    for (const url of [
      null,
      "",
      "not a url",
      "https://boards.greenhouse.io/acme",
      "https://boards.greenhouse.io/acme/jobs/abc",
      "https://jobs.lever.co/acme",
      "https://jobs.lever.co/acme/not-a-uuid",
      "https://jobs.ashbyhq.com/acme",
      "https://apply.workable.com/acme/",
      "https://greenhouse.io.evil.example/acme/jobs/1",
      `javascript://jobs.lever.co/acme/${uuid}`,
      "https://remoteok.com/remote-jobs/1",
    ]) {
      expect(atsKey(url)).toBeNull();
    }
  });
});
