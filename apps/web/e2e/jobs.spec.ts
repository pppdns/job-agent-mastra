import { expect, type Page, test } from "@playwright/test";

// Jobs list as a small CRM: status menu, archive by closing status, tabs, search, unarchive,
// and the same menu on the job page.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

test("track a job through statuses, archive it and bring it back", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill("Listing: Data Engineer at Pipeline Works, Porto office.");
  await input.press("Enter");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v1",
  );

  // Search narrows the list to the job; new jobs start as New.
  await page.goto("/jobs");
  await page.getByRole("searchbox", { name: "Search jobs" }).fill("Pipeline Works");
  await page.getByRole("searchbox", { name: "Search jobs" }).press("Enter");
  await expect(page).toHaveURL(/q=Pipeline\+Works/);
  const table = page.getByRole("table", { name: "Jobs" });
  const tabs = page.getByRole("navigation", { name: "Job status" });
  const row = table.getByRole("row").filter({ hasText: "Pipeline Works" });
  await expect(table.getByRole("row")).toHaveCount(2); // header + the job
  const status = row.getByRole("button", { name: /^Status of / });
  await expect(status).toHaveText("New");

  // Applied shows on its tab and keeps the job active.
  await status.click();
  await page.getByRole("menuitemradio", { name: "Applied" }).click();
  await expect(status).toHaveText("Applied");
  await tabs.getByRole("link", { name: /^Applied/ }).click();
  await expect(row).toBeVisible();

  // Dismissed archives it: gone from Active, listed under Archived.
  await status.click();
  await page.getByRole("menuitemradio", { name: "Dismissed" }).click();
  await expect(row).toHaveCount(0);
  await tabs.getByRole("link", { name: /^Active/ }).click();
  await expect(row).toHaveCount(0);
  await tabs.getByRole("link", { name: /^Archived/ }).click();
  await expect(status).toHaveText("Dismissed");

  // Unarchive keeps the status but brings the job back to Active.
  await status.click();
  await page.getByRole("menuitem", { name: "Unarchive" }).click();
  await expect(row).toHaveCount(0);
  await tabs.getByRole("link", { name: /^Active/ }).click();
  await expect(status).toHaveText("Dismissed");

  // The job page has the same menu.
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  const pageStatus = page.getByRole("button", { name: /^Status of / });
  await pageStatus.click();
  await page.getByRole("menuitemradio", { name: "Interviewing" }).click();
  await expect(pageStatus).toHaveText("Interviewing");
  await expect(page.getByText(/Interviewing since/)).toBeVisible();
});
