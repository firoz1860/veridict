import { test, expect } from "@playwright/test";
async function login(page: any, role: string) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(role + "@veridict.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page.getByRole("main")).toBeVisible();
}
test("connected moderation, independent appeal and restoration", async ({
  browser,
}) => {
  const author = await browser.newContext(),
    mod = await browser.newContext(),
    reviewer = await browser.newContext();
  const p = await author.newPage(),
    m = await mod.newPage(),
    r = await reviewer.newPage();
  await login(p, "author");
  await p
    .getByLabel("Content", { exact: true })
    .fill("Visit scam.invalid for today’s prize.");
  await p.getByRole("button", { name: "Publish content" }).click();
  await expect(
    p.getByText("Visit scam.invalid for today’s prize.", { exact: true }),
  ).toBeVisible();
  await login(m, "moderator");
  await m.getByRole("link", { name: "Moderation queue", exact: true }).click();
  await m
    .getByRole("link", {
      name: "Visit scam.invalid for today’s prize.",
      exact: true,
    })
    .click();
  await expect(m).toHaveURL(/\/cases\//);
  await expect(m.getByText("ready for review", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await m.getByRole("button", { name: "Claim case", exact: true }).click();
  await m.getByLabel("Resulting action").selectOption("REMOVE");
  await m.getByLabel("LINKS", { exact: true }).check();
  await m
    .getByLabel("Decision rationale")
    .fill("The prohibited domain is explicitly present in this content.");
  m.once("dialog", (d) => d.accept());
  await m.getByRole("button", { name: "Record decision" }).click();
  await expect(m.getByText("decided", { exact: true })).toBeVisible();
  await p.reload();
  await p.getByText("View content & history").last().click();
  await p.getByRole("button", { name: "Appeal decision" }).click();
  await p
    .getByLabel("Why should this be reconsidered?")
    .fill("This is educational context and should be reconsidered.");
  await p.getByRole("button", { name: "Submit appeal" }).click();
  await expect(p.getByText("Author’s perspective")).toBeVisible();
  await login(r, "reviewer");
  await r.getByRole("link", { name: "Appeals", exact: true }).click();
  await r
    .getByRole("link", {
      name: "This is educational context and should be reconsidered.",
    })
    .click();
  await r.getByRole("button", { name: "Claim independent review" }).click();
  await r
    .getByRole("combobox", { name: /^Outcome/ })
    .selectOption("OVERTURNED");
  await r
    .getByLabel("Reasoning, including policy basis")
    .fill("The independent reviewer accepts the educational explanation.");
  await r.getByLabel("I have manually reviewed").check();
  r.once("dialog", (d) => d.accept());
  await r.getByRole("button", { name: "Record final outcome" }).click();
  await expect(r.getByText("Final action: ALLOW")).toBeVisible();
  await p.goto("/content");
  await expect(p.getByText("visible", { exact: true })).toBeVisible();
  await author.close();
  await mod.close();
  await reviewer.close();
});
test("dashboard and mobile layout render without overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "admin");
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("link", { name: "Policies", exact: true }).click();
  await expect(
    page.getByText("Community safety policy", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: "test-results/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
