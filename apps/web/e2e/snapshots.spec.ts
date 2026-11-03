import { createClient } from "@libsql/client";
import { expect, type Page, test } from "@playwright/test";
import { e2eDb } from "../playwright.config";

// Brief steps 1–2 and 8–9 with the mock model: paste → draft saved automatically →
// propose → the user approves in the app → versioned snapshot.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

/** Sends a message and waits until the reply has finished streaming. */
async function send(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill(text);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(input).toHaveValue("");
}

test("a proposed snapshot is saved only after the user approves it", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const chatPath = new URL(page.url()).pathname;

  await send(page, "Listing: Staff Data Engineer at Globex Analytics, remote within the EU.");
  await expect(visible(page, '[aria-label="Assessment draft"]').last()).toContainText("Draft v1");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v1",
  );

  await send(page, "Propose snapshot");
  const card = page.locator('[aria-label="Snapshot approval"]').filter({ visible: true });
  await expect(card).toContainText("Save approved snapshot?");
  await expect(card).toContainText("draft v1");
  await expect(card).toContainText("Investigate further");

  const jobPath = await card.getByRole("link", { name: "Open job" }).getAttribute("href");
  expect(jobPath).toMatch(/^\/jobs\//);

  // Nothing is approved before the click.
  await page.goto("/jobs");
  const row = page.getByRole("list", { name: "Jobs" }).locator(`a[href="${jobPath}"]`);
  await expect(row).toContainText("Draft v1");
  await expect(row).toContainText("Awaiting approval");
  await expect(row).toContainText("Mock headline: listing read, pay unknown");
  await expect(row).toContainText("Investigate further");
  await expect(row).not.toContainText("Approved");

  await page.goto(chatPath);
  const reopened = page.locator('[aria-label="Snapshot approval"]').filter({ visible: true });
  await reopened.getByRole("button", { name: "Approve" }).click();
  await expect(reopened).toContainText("Approved · v1");

  // Status comes from the database, not from the chat transcript.
  await page.reload();
  await expect(
    page.locator('[aria-label="Snapshot approval"]').filter({ visible: true }),
  ).toContainText("Approved · v1");

  await page.goto("/jobs");
  await row.click();
  await expect(page.getByLabel("Current draft")).toContainText("Draft v1 · approved as v1");
  // Past versions stay hidden until asked for.
  const history = page.getByLabel("Version history");
  await expect(history).not.toContainText("Approved v1");
  await history.getByRole("button", { name: /Version history/ }).click();
  await expect(history).toContainText("Approved v1");
  await expect(page.getByLabel("Sources")).toContainText("Pasted text");

  // The approval is visible from its own chat only.
  const db = createClient({ url: e2eDb });
  const { rows } = await db.execute("SELECT id, thread_id FROM app_approvals");
  db.close();
  const approval = rows.find((r) => `/c/${r.thread_id}` === chatPath);
  expect(approval).toBeTruthy();
  const own = await request.get(`/api/approvals/${approval?.id}?threadId=${approval?.thread_id}`);
  expect(own.status()).toBe(200);
  const otherChat = "00000000-0000-4000-8000-000000000000";
  const other = await request.get(`/api/approvals/${approval?.id}?threadId=${otherChat}`);
  expect(other.status()).toBe(404);
});
