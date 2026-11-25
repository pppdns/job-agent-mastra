import { expect, type Page, test } from "@playwright/test";

// The pipeline board: a job moves between columns through its status menu, interview rounds
// are tracked on the card, and the job page holds a note edited only through Edit → Save.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

test("track interview rounds on the board and keep a note on the job", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill("Listing: Routing Engineer at Orbit Freight, Lisbon office.");
  await input.press("Enter");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v1",
  );

  // New jobs stay off the board; shortlisting puts the job in its first column.
  await page.goto("/jobs/board");
  const column = (name: string) =>
    page.getByRole("region", { name, exact: true }).filter({ visible: true });
  // Cards only: the sidebar's chat list has an "Orbit Freight" item too.
  const card = page
    .locator('section[id^="column-"] li')
    .filter({ hasText: "Orbit Freight", visible: true });
  await expect(card).toHaveCount(0);
  await page.goto("/jobs?q=Orbit+Freight");
  const row = page.getByRole("table", { name: "Jobs" }).getByRole("row").filter({
    hasText: "Orbit Freight",
  });
  await row.getByRole("button", { name: /^Status of / }).click();
  await page.getByRole("menuitemradio", { name: "Shortlisted" }).click();
  await expect(row.getByRole("button", { name: /^Status of / })).toHaveText("Shortlisted");
  await page
    .getByRole("navigation", { name: "Jobs view" })
    .getByRole("link", { name: "Board" })
    .click();
  await expect(
    column("Shortlisted").getByRole("listitem").filter({ hasText: "Orbit Freight" }),
  ).toBeVisible();
  await expect(card).toContainText("today");

  // Decided to apply: the card moves to its own column.
  await card.getByRole("button", { name: /^Status of / }).click();
  await page.getByRole("menuitemradio", { name: "To apply" }).click();
  await expect(
    column("To apply").getByRole("listitem").filter({ hasText: "Orbit Freight" }),
  ).toBeVisible();
  await expect(card).toContainText("Marked to apply");

  // Interviewing starts at round 1; set the total, then mark a round done.
  await card.getByRole("button", { name: /^Status of / }).click();
  await page.getByRole("menuitemradio", { name: "Interviewing" }).click();
  await expect(
    column("Interviewing").getByRole("listitem").filter({ hasText: "Orbit Freight" }),
  ).toBeVisible();
  const rounds = card.getByRole("button", { name: /^Interview rounds of / });
  await expect(rounds).toContainText("Round 1");
  await rounds.click();
  await page.getByRole("menuitem", { name: /Total rounds/ }).click();
  await page.getByRole("menuitemradio", { name: "4", exact: true }).click();
  await expect(rounds).toContainText("Round 1/4");
  await rounds.click();
  await page.getByRole("menuitem", { name: "Round 1 done" }).click();
  await expect(rounds).toContainText("Round 2/4");
  await expect(card.getByRole("img", { name: "Round 2 of 4" })).toBeVisible();

  // The note: Cancel with changes asks first; Save persists it.
  await card.getByRole("link").click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("region", { name: "Progress" }).filter({ visible: true }),
  ).toContainText("Moved to round 2 today");
  await page.getByRole("button", { name: "Add a note" }).filter({ visible: true }).click();
  const note = page.getByRole("textbox", { name: "Note" }).filter({ visible: true });
  await note.fill("Round 1: recruiter call. Round 2: system design on Friday.");
  await page.getByRole("button", { name: "Cancel" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(note).toHaveCount(0);
  await page.getByRole("button", { name: "Add a note" }).filter({ visible: true }).click();
  await note.fill("Round 2: system design on Friday.");
  await page.getByRole("button", { name: "Save" }).filter({ visible: true }).click();
  await expect(note).toHaveCount(0);
  await page.reload();
  const notes = page.getByRole("region", { name: "Notes" }).filter({ visible: true });
  await expect(notes).toContainText("Round 2: system design on Friday.");
  await expect(notes.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("reorder cards within a column by their handle, and keep the order", async ({ page }) => {
  test.setTimeout(60_000);
  const companies = ["Quartzline Ferries", "Brambleworth Mills"];
  for (const company of companies) {
    await page.goto("/");
    await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
    const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
    await input.fill(`Listing: Dock Scheduler at ${company}, Porto office.`);
    await input.press("Enter");
    await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
      "Mock reply: save_job_draft v1",
    );
    await page.goto(`/jobs?q=${encodeURIComponent(company)}`);
    const row = page.getByRole("table", { name: "Jobs" }).getByRole("row").filter({
      hasText: company,
    });
    await row.getByRole("button", { name: /^Status of / }).click();
    await page.getByRole("menuitemradio", { name: "Shortlisted" }).click();
    await expect(row.getByRole("button", { name: /^Status of / })).toHaveText("Shortlisted");
  }

  // Shortlisted later sorts lower; other specs' cards may share the column.
  await page.goto("/jobs/board");
  const column = page.getByRole("region", { name: "Shortlisted", exact: true });
  const order = async () =>
    (await column.getByRole("listitem").allTextContents()).flatMap((text) =>
      companies.filter((c) => text.includes(c)),
    );
  await expect.poll(order).toEqual(companies);

  // Keyboard: Space picks the card up, an arrow moves it, Space drops it.
  const handle = column
    .getByRole("listitem")
    .filter({ hasText: companies[1] })
    .getByRole("button", {
      name: "Reorder Dock Scheduler",
    });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect.poll(order).toEqual([companies[1], companies[0]]);

  await page.reload();
  await expect.poll(order).toEqual([companies[1], companies[0]]);
});
