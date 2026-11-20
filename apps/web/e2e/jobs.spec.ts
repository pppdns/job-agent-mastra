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
  // A tab change remounts the list: wait until the new tab is current, or a menu opened on the
  // old list's rows is detached mid-click.
  const openTab = async (name: RegExp) => {
    const link = tabs.getByRole("link", { name });
    await link.click();
    await expect(link).toHaveAttribute("aria-current", "page");
  };
  await expect(table.getByRole("row")).toHaveCount(2); // header + the job
  const status = row.getByRole("button", { name: /^Status of / });
  await expect(status).toHaveText("New");

  // Applied shows on its tab and keeps the job active.
  await status.click();
  await page.getByRole("menuitemradio", { name: "Applied" }).click();
  await expect(status).toHaveText("Applied");
  await openTab(/^Applied/);
  await expect(row).toBeVisible();

  // Dismissed archives it: gone from Active, listed under Archived.
  await status.click();
  await page.getByRole("menuitemradio", { name: "Dismissed" }).click();
  await expect(row).toHaveCount(0);
  await openTab(/^Active/);
  await expect(row).toHaveCount(0);
  await openTab(/^Archived/);
  await expect(status).toHaveText("Dismissed");

  // Unarchive keeps the status but brings the job back to Active.
  await status.click();
  await page.getByRole("menuitem", { name: "Unarchive" }).click();
  await expect(row).toHaveCount(0);
  await openTab(/^Active/);
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

test("mark a job as top on its page, see the badge and filter by it", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill("Listing: Staff Engineer at Starling Forge, Lisbon office.");
  await input.press("Enter");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v1",
  );

  const table = page.getByRole("table", { name: "Jobs" });
  const row = table.getByRole("row").filter({ hasText: "Starling Forge" });
  await page.goto("/jobs");
  await expect(row).toBeVisible();
  await expect(row.getByText("Top", { exact: true })).toHaveCount(0);

  // The star on the job page marks it; the status stays New.
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  const star = page.getByRole("button", { name: "Mark top" });
  await star.click();
  await expect(page.getByRole("button", { name: "Top", pressed: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Status of / })).toHaveText("New");

  // The list shows the badge, and "Top only" keeps just top jobs.
  await page.goto("/jobs");
  await expect(row.getByText("Top", { exact: true })).toBeVisible();
  // Controlled checkbox: it turns checked once the filtered list has loaded.
  const topOnly = page.getByRole("checkbox", { name: "Top only" });
  await topOnly.click();
  await expect(page).toHaveURL(/top=1/);
  await expect(topOnly).toBeChecked();
  await expect(table.getByRole("row")).toHaveCount(2); // header + the top job
  await expect(row).toBeVisible();

  // The status menu removes the mark; the filtered list is then empty.
  await row.getByRole("button", { name: /^Status of / }).click();
  await page.getByRole("menuitem", { name: "Remove top mark" }).click();
  await expect(row).toHaveCount(0);
});

test("add your own labels, mark one important and edit them from the list", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill("Listing: Platform Engineer at Quillon Labs, Berlin office.");
  await input.press("Enter");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v1",
  );

  const table = page.getByRole("table", { name: "Jobs" });
  const row = table.getByRole("row").filter({ hasText: "Quillon Labs" });
  const rowLabels = row.getByRole("list", { name: "Your labels" }).getByRole("listitem");
  await page.goto("/jobs");
  await expect(row).toBeVisible();
  await expect(rowLabels).toHaveCount(0);

  // On the job page: add a label, then an important one, which goes first.
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Add label" }).click();
  const field = page.getByRole("textbox", { name: "New label" });
  await expect(field).toBeFocused();
  await field.fill("Referral");
  await field.press("Enter");
  await field.fill("Call Anna");
  await page.getByRole("button", { name: "Important", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const editorLabels = page.getByRole("list", { name: "Labels on this job" }).getByRole("listitem");
  await expect(editorLabels).toHaveText(["Call Anna", "Referral"]);
  await page.keyboard.press("Escape");

  // The list row shows both, the important one first; the row menu edits them.
  await page.goto("/jobs");
  await expect(rowLabels).toHaveText(["Call Anna (important)", "Referral"]);
  await expect(rowLabels.first()).toHaveAttribute("data-important", "true");
  await row.getByRole("button", { name: /^Status of / }).click();
  await page.getByRole("menuitem", { name: "Labels…" }).click();
  await page.getByRole("button", { name: "Important: Call Anna" }).click();
  await page.getByRole("button", { name: "Delete label Referral" }).click();
  await expect(rowLabels).toHaveText(["Call Anna"]);
  await expect(rowLabels.first()).not.toHaveAttribute("data-important");
});
