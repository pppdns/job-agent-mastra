import { createClient } from "@libsql/client";
import { expect, type Page, test } from "@playwright/test";
import { e2eDb } from "../playwright.config";

// Durable chat runs: "Slow:" makes the mock stream for ~4.5 s.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });
const lastReply = (page: Page) => visible(page, '[data-role="assistant"]').last();
const FULL = `Mock reply: Slow: ${Array.from({ length: 30 }, (_, i) => `w${i + 1}`).join(" ")} end.`;

async function start(page: Page, text: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill(text);
  await input.press("Enter");
  await expect(lastReply(page)).toContainText("w3");
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

async function runStatus(threadId: string) {
  const db = createClient({ url: e2eDb });
  const { rows } = await db.execute({
    sql: "SELECT status FROM app_runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1",
    args: [threadId],
  });
  db.close();
  return rows[0]?.status;
}

test("a refresh mid-reply reconnects to the running reply", async ({ page }) => {
  const threadId = await start(page, "Slow: refresh me");
  expect(await runStatus(threadId)).toBe("running");
  await page.reload();
  await expect(lastReply(page)).toHaveText(FULL, { timeout: 15_000 });
  await expect.poll(() => runStatus(threadId)).toBe("completed");
  // And the stored history has it once, not twice.
  await page.reload();
  await expect(visible(page, '[data-role="assistant"]')).toHaveCount(1);
  await expect(lastReply(page)).toHaveText(FULL);
});

test("Stop ends the run on the server, not just the stream", async ({ page }) => {
  const threadId = await start(page, "Slow: stop me");
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect.poll(() => runStatus(threadId)).toBe("cancelled");
  await page.waitForTimeout(5000); // longer than the full reply would take
  await page.reload();
  await expect(visible(page, '[data-role="assistant"]').last()).not.toContainText("end.");
});

test("a second message while a reply is running is refused", async ({ request }) => {
  // The web proxy maps the agent's 409; a direct agent call shows the rule.
  const thread = crypto.randomUUID();
  const body = (text: string) => ({
    threadId: thread,
    message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] },
  });
  const first = request.post("/api/chat", { data: body("Slow: first") });
  await new Promise((r) => setTimeout(r, 800));
  const second = await request.post("/api/chat", { data: body("second") });
  expect(second.status()).toBe(409);
  await (await first).body();
});

test("the sidebar marks running chats and unseen replies", async ({ page }) => {
  const threadId = await start(page, "Slow: background me");
  const row = page
    .getByRole("list", { name: "Chats" })
    .getByRole("listitem")
    .filter({ has: page.locator(`a[href="/c/${threadId}"]`) });
  await expect(row.getByRole("status", { name: "Reply running" })).toBeVisible();

  // Leave while it runs: the spinner stays, then turns into a "new reply" dot.
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page).not.toHaveURL(new RegExp(threadId));
  await expect(row.getByRole("status", { name: "Reply running" })).toBeVisible();
  await expect(row.getByRole("status", { name: "New reply" })).toBeVisible({ timeout: 15_000 });

  // Opening the chat clears it, and it stays cleared after leaving again.
  await row.getByRole("link").click();
  await expect(row.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "New chat" }).click();
  await page.waitForTimeout(3500);
  await expect(row.getByRole("status")).toHaveCount(0);
});
