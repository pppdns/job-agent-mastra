import { createClient } from "@libsql/client";
import { expect, type Page, test } from "@playwright/test";
import { e2eDb } from "../playwright.config";

// The mock model calls ingest_listing for a bare URL or a message starting with "Listing:".
// e2e uses fixture web pages (WEB_MODE=fixture) with no LinkedIn pages, so LinkedIn URLs end
// in the honest "paste it" fallback.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

async function send(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill(text);
  await input.press("Enter");
}

test("a URL that cannot be read falls back to asking for a paste", async ({ page }) => {
  await page.goto("/");
  await send(page, "https://www.linkedin.com/jobs/view/4479142839");
  await expect(visible(page, '[data-role="assistant"]')).toContainText(
    "Couldn't read the full listing",
  );
  await expect(visible(page, '[data-role="assistant"]')).toContainText(
    "Mock reply: ingest_listing needs_paste",
  );
});

test("a private-network URL is blocked before any fetch", async ({ page }) => {
  await page.goto("/");
  await send(page, "http://169.254.169.254/latest/meta-data");
  await expect(visible(page, '[data-role="assistant"]')).toContainText("Didn't open the link");
  await expect(visible(page, '[data-role="assistant"]')).toContainText(
    "Mock reply: ingest_listing blocked",
  );
});

test("pasted listing text is saved with the chat as provenance", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const threadId = new URL(page.url()).pathname.split("/").pop();
  await send(page, "Listing: Senior Platform Engineer at Northwind Robotics, Lisbon. Hybrid.");
  const reply = visible(page, '[data-role="assistant"]');
  await expect(reply).toContainText("Read your pasted text (may be incomplete)");
  // The mock then saves a draft automatically, like the real agent is instructed to.
  const card = visible(page, '[aria-label="Assessment draft"]');
  await expect(card).toContainText("Draft v1 · not approved");
  await expect(card).toContainText("Mock headline: listing read, pay unknown");
  await expect(card).toContainText("Investigate further");
  await expect(card).toContainText("Fit not judged");
  await expect(card.getByLabel("1 weaknesses")).toBeVisible();

  const db = createClient({ url: e2eDb });
  const { rows } = await db.execute({
    sql: "SELECT kind, provider, content FROM app_sources WHERE thread_id = ?",
    args: [threadId ?? ""],
  });
  db.close();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: "pasted", provider: "user" });
  expect(String(rows[0]?.content)).toContain("Northwind Robotics");

  // The trace row survives a reload (history comes back from Mastra memory).
  await page.reload();
  await expect(visible(page, '[data-role="assistant"]')).toContainText("Read your pasted text");
  await expect(visible(page, '[aria-label="Assessment draft"]')).toContainText("Mock headline");
});
