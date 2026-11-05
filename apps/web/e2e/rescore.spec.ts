import { expect, type Page, test } from "@playwright/test";

// Batch re-score with the mock model: a profile change makes a job stale, the /jobs button
// re-scores it in a new chat, and each result becomes the job's current assessment.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

test("re-score stale jobs from /jobs", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill("Listing: Staff Engineer at Rescore Labs, Lisbon office.");
  await input.press("Enter");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v1",
  );

  // A profile change makes the assessment stale.
  await page.goto("/profile");
  await page.getByLabel("Kind").last().selectOption("soft_preference");
  await page.getByLabel("New fact").fill("Prefers Lisbon");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByLabel("Your profile")).toContainText("Prefers Lisbon");

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
  await expect(job).toContainText("Saved · v2");
  await expect(results.getByRole("button", { name: /^Approve/ })).toHaveCount(0);

  await page.goto("/jobs");
  await expect(row).not.toContainText("Profile changed · review");
});

test("re-score all active jobs from /jobs after confirming", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill("Listing: Platform Engineer at Rescore All Inc, remote.");
  await input.press("Enter");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v1",
  );

  await page.goto("/jobs");
  await page.getByRole("button", { name: "Re-score all" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Re-score all active jobs?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/jobs/);

  await page.getByRole("button", { name: "Re-score all" }).click();
  await dialog.getByRole("button", { name: /^Re-score \d+$/ }).click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const progress = visible(page, '[aria-label="Re-score progress"]');
  await expect(progress).toContainText("Re-score finished");
  await expect(progress).toContainText("Platform Engineer · Rescore All Inc");
});
