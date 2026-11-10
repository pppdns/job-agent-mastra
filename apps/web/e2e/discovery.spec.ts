import { expect, test } from "@playwright/test";

// Discovery on the fixture sources (fixtures/sources): a manual run stores screened jobs from
// both boards (the cross-board duplicate merged), shows per-source results and what the screen
// dropped; loosening the settings re-screens and lets a dropped posting through.

test("run discovery, see screened jobs, loosen the screen", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/discovery");
  await page.getByRole("button", { name: "Run now" }).click();
  const runs = page.getByRole("table", { name: "Discovery runs" });
  await expect(runs.getByText("completed")).toBeVisible({ timeout: 30_000 });
  await expect(runs).toContainText("Himalayas");
  await expect(runs).toContainText("1 merged");

  const screened = page.getByRole("region", { name: "Screened out" });
  await expect(screened).toContainText("Software Engineering Intern");
  await expect(screened).toContainText('title contains "intern"');
  await expect(screened).toContainText("remote only from India, Philippines");

  // One job for the posting found on both boards, with both source badges.
  await page.goto("/jobs?q=Quillfeather");
  const table = page.getByRole("table", { name: "Jobs" });
  const row = table.getByRole("row").filter({ hasText: "Quillfeather Health" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Himalayas");
  await expect(row).toContainText("LinkedIn");
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
  await expect(page.getByRole("status")).toContainText("1 new job let through");
  await page.goto("/jobs?q=Pebblework");
  await expect(
    page.getByRole("table", { name: "Jobs" }).getByText("Software Engineering Intern"),
  ).toBeVisible();
});
