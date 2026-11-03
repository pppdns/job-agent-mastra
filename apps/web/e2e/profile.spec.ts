import { createClient } from "@libsql/client";
import { expect, type Page, test } from "@playwright/test";
import { e2eDb } from "../playwright.config";

// Brief steps 5–7 with the mock model: "Remember:" proposes a profile change, "For this
// chat:" writes thread-scoped working memory, "Profile?" / "Local?" echo what the chat sees.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });
const lastReply = (page: Page) => visible(page, '[data-role="assistant"]').last();

async function send(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill(text);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(input).toHaveValue("");
}

async function newChat(page: Page): Promise<string> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}

test("approved profile reaches new chats; local notes and drafts behave", async ({ page }) => {
  // About a dozen turns plus the profile page: slower when the suite runs in parallel.
  test.setTimeout(60_000);
  const chatA = await newChat(page);
  const threadA = chatA.split("/").pop();

  // A job assessed before the profile changes.
  await send(page, "Listing: Backend Engineer at Initrode, Berlin office.");
  await expect(lastReply(page)).toContainText("Mock reply: save_job_draft v1");

  // "Remember" → an exact proposal; nothing changes until approved.
  await send(page, "Remember: Prefers small teams");
  const card = visible(page, '[aria-label="Profile change approval"]');
  await expect(card).toContainText("Update your profile?");
  await expect(card.getByLabel("Proposed profile changes")).toContainText("AddPrefers small teams");
  await send(page, "Profile?");
  await expect(lastReply(page)).toContainText("Mock reply: profile v");
  await expect(lastReply(page)).not.toContainText("Prefers small teams");

  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toContainText("Approved · profile v");

  // Local note for this chat only.
  await send(page, "For this chat: include London roles");
  await expect(lastReply(page)).toContainText("Noted for this chat only");
  await send(page, "Local?");
  await expect(lastReply(page)).toContainText("Mock reply: local include London roles");

  // A new chat sees the approved profile but not chat A's local note.
  await newChat(page);
  await send(page, "Profile?");
  await expect(lastReply(page)).toContainText("Prefers small teams");
  await send(page, "Local?");
  await expect(lastReply(page)).toContainText("Mock reply: local none");

  // The job drafted before the change is flagged for review.
  const db = createClient({ url: e2eDb });
  const { rows } = await db.execute({
    sql: "SELECT job_id FROM app_sources WHERE thread_id = ?",
    args: [threadA ?? ""],
  });
  db.close();
  await page.goto("/jobs");
  await expect(
    page.getByRole("list", { name: "Jobs" }).locator(`a[href="/jobs/${rows[0]?.job_id}"]`),
  ).toContainText("Profile changed · review");

  // Profile page edits are proposals too.
  await page.goto("/profile");
  const approved = page.getByLabel("Approved profile");
  await expect(approved).toContainText("Prefers small teams");
  await page.getByLabel("Kind").last().selectOption("hard_requirement");
  await page.getByLabel("New fact").fill("Remote within the EU only");
  await page.getByRole("button", { name: "Propose", exact: true }).click();
  const pending = page.getByLabel("Pending changes");
  await expect(pending).toContainText("AddRemote within the EU only");
  await expect(approved).not.toContainText("Remote within the EU only");
  await pending.getByRole("button", { name: "Approve" }).click();
  await expect(approved).toContainText("Remote within the EU only");
  await expect(page.getByLabel("History")).toContainText("Added on the profile page");
});
