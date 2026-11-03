import { expect, test } from "@playwright/test";

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

test("the agent API rejects requests without the shared secret", async ({ request }) => {
  const response = await request.post("http://127.0.0.1:4112/chat", { data: {} });
  expect(response.status()).toBe(401);
  const history = await request.get("http://127.0.0.1:4112/threads/any/ui-messages");
  expect(history.status()).toBe(401);
});
