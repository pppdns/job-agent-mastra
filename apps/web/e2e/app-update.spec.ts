import { expect, type Page, test } from "@playwright/test";

// A page from an older deploy: its server actions are gone (the server answers like Next does
// for an unknown action id), or the server reports a newer deployment. The page must not crash;
// it keeps what was typed and shows the update banner.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

async function openNewJob(page: Page, company: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill(`Listing: Yard Planner at ${company}, Lisbon office.`);
  await input.press("Enter");
  await expect(visible(page, '[data-role="assistant"]').last()).toContainText(
    "Mock reply: save_job_draft v1",
  );
  await page.goto(`/jobs?q=${encodeURIComponent(company)}`);
  await page
    .getByRole("table", { name: "Jobs" })
    .getByRole("link", { name: /Yard Planner/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
}

test("a save after a deploy keeps the note and shows the update banner", async ({ page }) => {
  test.setTimeout(60_000);
  await openNewJob(page, "Saltmarsh Haulage");
  await page.getByRole("button", { name: "Add a note" }).filter({ visible: true }).click();
  const note = page.getByRole("textbox", { name: "Note" }).filter({ visible: true });
  await note.fill("Recruiter call on Monday.");

  // From now on every server action is unknown to the server.
  await page.route("**/*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.fulfill({ status: 404, headers: { "x-nextjs-action-not-found": "1" }, body: "" })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "Save" }).filter({ visible: true }).click();

  await expect(page.getByRole("alert").filter({ hasText: "new version" })).toContainText(
    "Your last change wasn't saved",
  );
  await expect(note).toHaveValue("Recruiter call on Monday.");
  await expect(note).toBeEnabled();
  await expect(page.getByText("Application error")).toHaveCount(0);
});

test("returning to a page from an older deploy shows the update banner", async ({ page }) => {
  await page.goto("/jobs");
  await page.route("**/api/version", (route) =>
    route.fulfill({ json: { deploymentId: "newer-deploy" } }),
  );
  await page.evaluate(() => {
    document.documentElement.dataset.dplId = "older-deploy";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("alert").filter({ hasText: "new version" })).toContainText(
    "is available",
  );
});
