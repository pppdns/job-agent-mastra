import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { expect, type Page, test } from "@playwright/test";
import { e2eAgentUrl, e2eDb, e2eSecret } from "../playwright.config";

const chatLink = (page: Page, path: string) =>
  page.getByRole("list", { name: "Chats" }).locator(`a[href="${path}"]`);

// Next keeps previously visited pages mounted but hidden (React Activity): match visible ones only.
const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

async function send(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill(text);
  await input.press("Enter");
  await expect(visible(page, '[data-role="assistant"]').last()).toHaveText(`Mock reply: ${text}`);
}

async function newChat(page: Page, text: string): Promise<string> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  await send(page, text);
  await expect(chatLink(page, new URL(page.url()).pathname)).toBeVisible();
  return new URL(page.url()).pathname;
}

test("chats stay separate and reopen with their own history", async ({ page }) => {
  const alpha = await newChat(page, "Acme role ALPHA-7");
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page).not.toHaveURL(alpha);
  await send(page, "Globex role BETA-9");
  const beta = new URL(page.url()).pathname;

  await chatLink(page, alpha).click();
  await expect(page).toHaveURL(alpha);
  const conversation = page.getByLabel("Conversation").filter({ visible: true });
  await expect(conversation).toContainText("ALPHA-7");
  await expect(conversation).not.toContainText("BETA-9");

  await page.reload();
  await expect(visible(page, '[data-role="user"]')).toHaveText(["Acme role ALPHA-7"]);

  await page.goto(beta);
  await expect(visible(page, '[data-role="user"]')).toHaveText(["Globex role BETA-9"]);
});

test("a chat can be renamed and deleted", async ({ page }) => {
  const path = await newChat(page, "Initech role GAMMA-3");
  const row = page.getByRole("listitem").filter({ has: page.locator(`[href="${path}"]`) });

  await row.hover();
  await row.getByRole("button", { name: "Chat actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const title = page.getByRole("textbox", { name: "Chat title" });
  await title.fill("Initech backend");
  await title.press("Enter");
  await expect(chatLink(page, path)).toHaveText("Initech backend");

  await page.reload();
  await expect(chatLink(page, path)).toHaveText("Initech backend");

  await row.hover();
  await row.getByRole("button", { name: "Chat actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(chatLink(page, path)).toHaveCount(0);
  await expect(page).not.toHaveURL(path);

  await page.goto(path);
  await expect(visible(page, '[data-role="user"]')).toHaveCount(0);
});

test.describe("threads owned by another resource", () => {
  const foreignId = randomUUID();

  test.beforeAll(async () => {
    // Mastra tables exist once the agent has served a memory request.
    const response = await fetch(`${e2eAgentUrl}/api/memory/threads?agentId=copilot`, {
      headers: { authorization: `Bearer ${e2eSecret}` },
    });
    expect(response.ok).toBe(true);
    const db = createClient({ url: e2eDb });
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO mastra_threads (id, resourceId, title, metadata, createdAt, updatedAt)
            VALUES (?, 'intruder', 'Foreign secret chat', '{}', ?, ?)`,
      args: [foreignId, now, now],
    });
    db.close();
  });

  const agent = (path: string, init: RequestInit = {}) =>
    fetch(`${e2eAgentUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${e2eSecret}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });

  test("are hidden from listings even when the client asks for them", async () => {
    const response = await agent("/api/memory/threads?agentId=copilot&resourceId=intruder");
    expect(response.ok).toBe(true);
    const { threads } = (await response.json()) as { threads: { id: string }[] };
    expect(threads.map((t) => t.id)).not.toContain(foreignId);
  });

  test("cannot be read, renamed or deleted through the agent API", async () => {
    expect((await agent(`/api/memory/threads/${foreignId}?agentId=copilot`)).status).toBe(403);
    expect((await agent(`/threads/${foreignId}/ui-messages`)).status).toBe(404);
    const rename = await agent(`/api/memory/threads/${foreignId}?agentId=copilot`, {
      method: "PATCH",
      body: JSON.stringify({ title: "taken over" }),
    });
    expect(rename.status).toBe(403);
    const remove = await agent(`/api/memory/threads/${foreignId}?agentId=copilot`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(403);
  });

  test("cannot be continued through the web UI", async ({ page }) => {
    await page.goto(`/c/${foreignId}`);
    await expect(page.getByText("Foreign secret chat")).toHaveCount(0);
    const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
    await input.fill("Let me in");
    await input.press("Enter");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(visible(page, '[data-role="assistant"]')).toHaveCount(0);
  });
});
