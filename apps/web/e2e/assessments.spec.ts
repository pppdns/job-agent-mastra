import { expect, type Page, test } from "@playwright/test";

// Brief steps 1–2 with the mock model: paste → assessment saved automatically as the job's
// current version (no approval); a re-assessment becomes v2 and v1 stays as history.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

/** Sends a message and waits until the reply has finished streaming. */
async function send(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill(text);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(input).toHaveValue("");
}

test("assessments save without approval and keep earlier versions", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);

  const listing = "Listing: Staff Data Engineer at Globex Analytics, remote within the EU.";
  await send(page, listing);
  const card = visible(page, '[aria-label="Saved assessment"]').last();
  await expect(card).toContainText("Saved · v1");
  await expect(card).not.toContainText("approved");
  const jobPath = await card.getByRole("link", { name: "Open job" }).getAttribute("href");
  expect(jobPath).toMatch(/^\/jobs\//);

  // The same listing again re-assesses the same job.
  await send(page, listing);
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v2",
  );

  await page.goto("/jobs");
  const row = page
    .getByRole("table", { name: "Jobs" })
    .getByRole("row")
    .filter({ has: page.locator(`a[href="${jobPath}"]`) });
  await expect(row).toContainText("Mock headline: listing read, pay unknown");
  await expect(row).toContainText("Investigate further");
  await expect(row).not.toContainText("approv");

  await row.getByRole("link").click();
  await expect(page.getByLabel("Current assessment")).toContainText("Assessment v2");
  await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
  // Past versions stay hidden until asked for.
  const history = page.getByLabel("Version history");
  await expect(history).toContainText("1 earlier");
  await expect(history).not.toContainText("profile v0");
  await history.getByRole("button", { name: /Version history/ }).click();
  await expect(history).toContainText("v1");
  await expect(history).toContainText("profile v0");
  await expect(page.getByLabel("Sources")).toContainText("Pasted text");
});
