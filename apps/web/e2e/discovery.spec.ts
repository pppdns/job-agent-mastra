import { expect, test } from "@playwright/test";

// Discovery on the fixture sources (fixtures/sources): a manual run stores screened jobs from
// every board with a fixture (cross-board duplicates merged), shows per-source results and what the screen
// dropped; loosening the settings re-screens and lets a dropped posting through; then the inbox
// tools: unseen filter, Keep anyway, the company page and bulk dismiss.

test("run discovery, see screened jobs, loosen the screen", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/discovery");
  await page.getByRole("button", { name: "Run now" }).click();
  const runs = page.getByRole("table", { name: "Discovery runs" });
  await expect(runs.getByText("completed")).toBeVisible({ timeout: 30_000 });
  await expect(runs).toContainText("Himalayas");
  await expect(runs).toContainText("1 merged");
  // Mock triage scores every new job; the best get a full (mock) assessment; no email in e2e.
  await expect(runs).toContainText("We Work Remotely");
  await expect(runs).toContainText("YC Work at a Startup");
  await expect(runs).toContainText("7 triaged");
  await expect(runs).toContainText("7 assessed");
  await expect(runs).toContainText("no email: email not configured");

  const screened = page.getByRole("region", { name: "Screened out" });
  await expect(screened).toContainText("Software Engineering Intern");
  await expect(screened).toContainText('title contains "intern"');
  await expect(screened).toContainText("remote only from India, Philippines");
  await expect(screened).toContainText("remote only from Latin America");
  await expect(screened).toContainText("not remote, in San Francisco, CA, US");

  // One job for the posting found on both boards, with both source badges.
  await page.goto("/jobs?q=Quillfeather");
  const table = page.getByRole("table", { name: "Jobs" });
  const row = table.getByRole("row").filter({ hasText: "Quillfeather Health" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Himalayas");
  await expect(row).toContainText("LinkedIn");
  await expect(row).toContainText("We Work Remotely");
  await expect(row).toContainText("New");

  // New matches count on the Jobs nav item until opened.
  const badge = page.getByLabel(/^\d+ new match/).filter({ visible: true });
  await expect(badge).toHaveText("7");
  await row.getByRole("link").first().click();
  await expect(page.getByText("Triage 88")).toBeVisible();
  await expect(badge).toHaveText("6");
  await page.goto("/jobs?q=Pebblework");
  await expect(page.getByText(/No active jobs match/)).toBeVisible();

  // A second run while nothing is new: everything is "seen before", no new jobs.
  await page.goto("/discovery");
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(runs.getByRole("row")).toHaveCount(3, { timeout: 30_000 });
  await expect(runs.getByRole("row").nth(1)).toContainText("seen before");

  // Dropping "intern" from the excludes re-screens at once and lets the intern posting in.
  await page.goto("/settings/search");
  const excludes = page.locator('textarea[name="titleExclude"]');
  const kept = (await excludes.inputValue())
    .split("\n")
    .filter((l) => l !== "intern")
    .join("\n");
  await excludes.fill(kept);
  await page.getByRole("button", { name: "Save and re-screen" }).click();
  await expect(
    page.getByRole("form", { name: "Search settings" }).getByRole("status"),
  ).toContainText("1 new job let through");
  await page.goto("/jobs?q=Pebblework");
  const intern = page.getByRole("table", { name: "Jobs" }).getByRole("row").filter({
    hasText: "Software Engineering Intern",
  });
  // Let through by the settings change: triaged on the next run.
  await expect(intern).toContainText("Triage pending");

  // Inbox tools: the unseen filter, keeping a dropped posting, the company page, bulk dismiss.
  await page.goto("/jobs?tab=new&unseen=1");
  const inbox = page.getByRole("table", { name: "Jobs" });
  await expect(inbox.getByRole("row").filter({ hasText: "Lanternfish" })).toHaveCount(1);
  await expect(inbox.getByRole("row").filter({ hasText: "Quillfeather" })).toHaveCount(0);

  await page.goto("/jobs?tab=screened");
  const dropped = page.getByRole("region", { name: "Dropped by the screen" });
  const executive = dropped.getByRole("listitem").filter({ hasText: "Account Executive" });
  await expect(executive).toContainText('title contains "account executive"');
  await executive.getByRole("button", { name: "Keep anyway" }).click();
  await expect(executive).toHaveCount(0);

  await page.goto("/jobs?q=Tidewater");
  const tidewater = page.getByRole("table", { name: "Jobs" });
  await expect(tidewater.getByRole("row")).toHaveCount(3); // header + both roles
  await tidewater.getByRole("link", { name: "+1 more role here" }).first().click();
  await expect(page.getByRole("heading", { name: "Tidewater Robotics" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Roles" }).getByRole("listitem")).toHaveCount(2);

  await page.goto("/jobs?q=Tidewater");
  await page.getByRole("checkbox", { name: "Select all jobs on this page" }).check();
  const bar = page.getByRole("toolbar", { name: "Selected jobs" });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText(/No active jobs match/)).toBeVisible();
  await page.goto("/jobs?q=Tidewater&tab=archived");
  await expect(page.getByRole("table", { name: "Jobs" }).getByRole("row")).toHaveCount(3);
});
