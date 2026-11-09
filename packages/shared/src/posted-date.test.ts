import { describe, expect, it } from "vitest";
import { listingPostedDate } from "./posted-date";

// Shapes of fixtures/listings/linkedin-complete.md (sign-in chrome above the title) and
// linkedin-login.md (no job card).
const linkedInGuestPage = `### Senior Platform Engineer

[Northwind Robotics](https://www.linkedin.com/company/northwind-robotics "Northwind Robotics") Lisbon, Portugal

## Join or sign in to find your next job

# Senior Platform Engineer

#### [Northwind Robotics](https://www.linkedin.com/company/northwind-robotics?trk=public_jobs_topcard-org-name) Lisbon, Portugal 3 weeks ago 41 applicants [See who Northwind Robotics has hired for this role](https://www.linkedin.com/login?session_redirect=x)

Body`;
const linkedInLogin = "## 0 Benachrichtigungen\n\n# Einloggen\n\nE-Mail oder Telefon\n";

const readAt = new Date("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
const card = (age: string) =>
  `# Platform Engineer\n\n#### [Acme](https://www.linkedin.com/company/acme) London ${age} 41 applicants\n\nBody`;

describe("listingPostedDate: LinkedIn", () => {
  it("reads the job card's relative age, anchored to when the page was read", () => {
    const posted = listingPostedDate("linkedin", linkedInGuestPage, readAt);
    expect(posted).toEqual({ postedAt: new Date(readAt.getTime() - 21 * DAY), basis: "relative" });
  });

  it("marks reposted jobs and handles each unit", () => {
    expect(listingPostedDate("linkedin", card("Reposted 2 days ago"), readAt)).toEqual({
      postedAt: new Date(readAt.getTime() - 2 * DAY),
      basis: "reposted",
    });
    expect(listingPostedDate("linkedin", card("11 hours ago"), readAt)?.postedAt).toEqual(
      new Date(readAt.getTime() - 11 * 3_600_000),
    );
    expect(listingPostedDate("linkedin", card("1 month ago"), readAt)?.postedAt).toEqual(
      new Date(readAt.getTime() - 30 * DAY),
    );
  });

  it("ignores ages outside the job card (similar jobs) and non-listing pages", () => {
    const similar = `# Platform Engineer\n\n#### [Acme](https://www.linkedin.com/company/acme) London\n\nBody\n\nLondon, United Kingdom 5 days ago`;
    expect(listingPostedDate("linkedin", similar, readAt)).toBeNull();
    expect(listingPostedDate("linkedin", linkedInLogin, readAt)).toBeNull();
  });
});

describe("listingPostedDate: employer pages", () => {
  it("reads explicit dates in common formats", () => {
    const exact = (text: string) => listingPostedDate("ats", `# Job\n\n${text}\n\nBody`, readAt);
    const march2 = { postedAt: new Date(Date.UTC(2026, 2, 2)), basis: "exact" };
    expect(exact("Date posted: 2026-03-02")).toEqual(march2);
    expect(exact("**Posted on** 2 March 2026")).toEqual(march2);
    expect(exact("* Published: Mar 2, 2026")).toEqual(march2);
    expect(exact("Posted 4 days ago")).toEqual({
      postedAt: new Date(readAt.getTime() - 4 * DAY),
      basis: "relative",
    });
  });

  it("returns null without a stated date, for impossible dates and for future dates", () => {
    const plain =
      "# Senior Platform Engineer\n\nLisbon, Portugal (Hybrid)\n\n## What you will do\n";
    expect(listingPostedDate("ats", plain, readAt)).toBeNull();
    expect(listingPostedDate("ats", "Posted: 2026-02-31", readAt)).toBeNull();
    expect(listingPostedDate("pasted", "Posted: 2027-01-05", readAt)).toBeNull();
    expect(listingPostedDate("ats", "Posted: 1999-12-31", readAt)).toBeNull();
  });
});
