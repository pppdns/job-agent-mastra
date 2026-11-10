import { expect, test } from "@playwright/test";
import { e2eAgentUrl } from "../playwright.config";

test("streams an agent reply through the web proxy", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message" });
  await input.fill("Hello from Playwright");
  await input.press("Enter");

  await expect(page.locator('[data-role="user"]')).toHaveText("Hello from Playwright");
  await expect(page.locator('[data-role="assistant"]')).toHaveText(
    "Mock reply: Hello from Playwright",
  );
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("a new chat focuses the message input", async ({ page }) => {
  await page.goto("/");
  const input = () => page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await expect(input()).toBeFocused();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page).toHaveURL(/\/c\//);
  await expect(input()).toBeFocused();
});

test("the agent API rejects requests without the shared secret", async ({ request }) => {
  const response = await request.post(`${e2eAgentUrl}/chat`, { data: {} });
  expect(response.status()).toBe(401);
  const history = await request.get(`${e2eAgentUrl}/threads/any/ui-messages`);
  expect(history.status()).toBe(401);
});
