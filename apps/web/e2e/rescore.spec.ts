import { expect, type Page, test } from "@playwright/test";

// Batch re-score with the mock model: a profile change makes a job stale, the /jobs button
// re-scores it in a new chat, and "Approve all" approves exactly the drafts shown.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

test("re-score stale jobs from /jobs and approve them all", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill("Listing: Staff Engineer at Rescore Labs, Lisbon office.");
  await input.press("Enter");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v1",
  );

  // A profile change makes the draft stale.
  await page.goto("/profile");
  await page.getByLabel("Kind").last().selectOption("soft_preference");
  await page.getByLabel("New fact").fill("Prefers Lisbon");
  await page.getByRole("button", { name: "Propose", exact: true }).click();
  await page.getByLabel("Pending changes").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByLabel("Approved profile")).toContainText("Prefers Lisbon");

  await page.goto("/jobs");
  const row = page
    .getByRole("table", { name: "Jobs" })
    .getByRole("row")
    .filter({ hasText: "Rescore Labs" });
  await expect(row).toContainText("Profile changed · review");
  await page.getByRole("button", { name: /^Re-score \d+$/ }).click();

  // The batch runs in a new chat; the page reconnects to it.
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const progress = visible(page, '[aria-label="Re-score progress"]');
  await expect(progress).toContainText("Re-score finished");
  await expect(progress).toContainText("Staff Engineer · Rescore Labs");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    /Mock reply: rescore_jobs \d+ saved/,
  );
  const results = visible(page, '[aria-label="Re-scored jobs"]');
  const job = results.getByRole("listitem").filter({ hasText: "Rescore Labs" });
  await expect(job).toContainText("Draft v2 · not approved");
  await results.getByRole("button", { name: /^Approve all \d+$/ }).click();
  await expect(job).toContainText("Approved");
  // Approval state comes from the database after a reload.
  await page.reload();
  await expect(job).toContainText("Approved");
  await expect(results.getByRole("button", { name: /^Approve all/ })).toHaveCount(0);

  await page.goto("/jobs");
  await expect(row).toContainText("Approved v1");
  await expect(row).not.toContainText("not approved");
  await expect(row).not.toContainText("Profile changed · review");
});
