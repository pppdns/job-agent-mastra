import { expect, type Page, test } from "@playwright/test";

// Brief steps 3–4 offline: mock model + fixture web pages (fixtures/web). "Research: <topics>"
// makes the mock call research_company for the latest job.

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });
const lastReply = (page: Page) => visible(page, '[data-role="assistant"]').last();

async function send(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Message" }).filter({ visible: true });
  await input.fill(text);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(input).toHaveValue("");
}

test("research streams real progress and shows cited findings", async ({ page }) => {
  await page.goto("/");
  await send(page, "Listing: Platform Engineer at Northwind Robotics, Lisbon. Hybrid.");
  await expect(lastReply(page)).toContainText("Mock reply: save_job_draft v1");

  await send(page, "Research: business");
  const progress = lastReply(page).getByLabel("Research progress");
  await expect(progress).toContainText("Researching Northwind Robotics");
  await expect(progress).toContainText("Searched “Northwind Robotics company”");
  await expect(progress).toContainText("Read https://northwind-robotics.example/about");
  await expect(progress).toContainText("Recorded a finding");
  await expect(progress).toContainText("Research finished1 findings kept");

  const findings = lastReply(page).getByLabel("Research findings");
  await expect(findings).toContainText("1 findings");
  await expect(findings).toContainText("(estimate)");
  await expect(findings).toContainText("Listing / official");
  await expect(findings.getByRole("link", { name: "northwind-robotics.example" })).toHaveAttribute(
    "href",
    "https://northwind-robotics.example/about",
  );
  await expect(lastReply(page)).toContainText("Mock reply: research_company completed 1 claims");

  // Technical panel: one search + one extraction, model calls from both agents, estimates labelled.
  await page.getByRole("button", { name: "Technical details" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toContainText("Costs are estimates");
  const latest = panel.getByLabel("Run").first();
  await expect(latest).toContainText("completed");
  await expect(latest).toContainText("search 1 · extraction 1 · browser 0");
  await expect(latest.getByLabel("LLM calls")).toContainText(
    "copilot · anthropic/claude-sonnet-5.5",
  );
  await expect(latest.getByLabel("LLM calls")).toContainText(
    "researcher · anthropic/claude-sonnet-5.5",
  );
  await expect(latest.getByLabel("Search")).toContainText("Northwind Robotics company");
  await expect(latest.getByLabel("Tools")).toContainText("research_company");
  await expect(panel.getByLabel("Chat totals")).toContainText("2 runs");
  await page.keyboard.press("Escape");

  // Progress and findings come back from stored history after a reload.
  await page.reload();
  await expect(lastReply(page).getByLabel("Research progress")).toContainText("Research finished");

  await page.goto("/jobs");
  await page
    .getByRole("table", { name: "Jobs" })
    .getByRole("link", { name: /^Platform Engineer/ })
    .click();
  const evidence = page.getByLabel("Evidence");
  await expect(evidence).toContainText(
    "Mock finding read from https://northwind-robotics.example/about",
  );
  await expect(page.getByLabel("Sources")).toContainText("Web page (research)");
});
