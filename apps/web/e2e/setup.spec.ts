import { expect, test } from "@playwright/test";

// Runs before every other spec (project "setup"): the person lives in Berlin, and office work is
// fine only in Budapest, so the discovery screen drops remote roles limited to places outside
// Germany and office roles elsewhere (fixtures/sources). Set once here, so no spec changes home
// under another one running in parallel.

test("set the structured preferences the specs assume", async ({ page }) => {
  await page.goto("/profile");
  const form = page.getByRole("form", { name: "Structured preferences" });
  await form.getByRole("textbox", { name: "Home city" }).fill("Berlin");
  await form.getByRole("textbox", { name: "Home country" }).fill("Germany");
  await form.getByRole("button", { name: "Add hybrid place" }).click();
  await form.getByRole("textbox", { name: "Hybrid place 1" }).fill("Budapest");
  await form.getByLabel("Hybrid elsewhere").selectOption("no");
  await form.getByLabel("On-site elsewhere").selectOption("no");
  await form.getByRole("button", { name: "Save preferences" }).click();
  await expect(form.getByText(/^Saved\. Re-screened/)).toBeVisible();
});
