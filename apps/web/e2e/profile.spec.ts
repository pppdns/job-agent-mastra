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

test("approved profile reaches new chats; local notes and assessments behave", async ({
  page,
  request,
}) => {
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

  // The approval is visible from its own chat only.
  const approvals = createClient({ url: e2eDb });
  const { rows: own } = await approvals.execute({
    sql: "SELECT id FROM app_approvals WHERE thread_id = ?",
    args: [threadA ?? ""],
  });
  approvals.close();
  const approvalId = own[0]?.id;
  expect(approvalId).toBeTruthy();
  expect((await request.get(`/api/approvals/${approvalId}?threadId=${threadA}`)).status()).toBe(
    200,
  );
  const otherChat = "00000000-0000-4000-8000-000000000000";
  expect((await request.get(`/api/approvals/${approvalId}?threadId=${otherChat}`)).status()).toBe(
    404,
  );

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

  // The job assessed before the change is flagged for review.
  const db = createClient({ url: e2eDb });
  const { rows } = await db.execute({
    sql: "SELECT job_id FROM app_sources WHERE thread_id = ?",
    args: [threadA ?? ""],
  });
  db.close();
  await page.goto("/jobs");
  await expect(
    page
      .getByRole("table", { name: "Jobs" })
      .getByRole("row")
      .filter({ has: page.locator(`a[href="/jobs/${rows[0]?.job_id}"]`) }),
  ).toContainText("Profile changed · review");

  // The user's own edits on the profile page apply right away.
  await page.goto("/profile");
  const profile = page.getByLabel("Your profile");
  await expect(profile).toContainText("Prefers small teams");
  await page.getByLabel("Kind").last().selectOption("hard_requirement");
  await page.getByLabel("New fact").fill("Remote within the EU only");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(profile).toContainText("Remote within the EU only");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  // History starts collapsed.
  await page.getByRole("button", { name: /^History/ }).click();
  await expect(page.getByLabel("History")).toContainText("Added on the profile page");
});
