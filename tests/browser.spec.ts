import { test, expect } from "@playwright/test";
async function login(page: any, role: string) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(role + "@veridict.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page.getByRole("main")).toBeVisible();
  // First-login "Connect your AI provider" modal appears when no key is set;
  // dismiss it so manual-review flows proceed (no key is required for them).
  await page
    .getByRole("button", { name: "Set up later" })
    .click({ timeout: 5000 })
    .catch(() => {});
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
  await expect(
    m.getByRole("heading", { name: "Review with context." }),
  ).toBeVisible();
  await expect(m.getByText("ready for review", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await m.getByRole("button", { name: "Claim case", exact: true }).click();
  await m.getByLabel("Resulting action").selectOption("REMOVE");
  await m.getByLabel("LINKS", { exact: true }).check();
  await m
    .getByLabel("Decision rationale")
    .fill("The prohibited domain is explicitly present in this content.");
  await m.getByRole("button", { name: "Record decision" }).click();
  await m
    .getByRole("dialog")
    .getByRole("button", { name: "Remove content", exact: true })
    .click();
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
  const retry = r.getByRole("button", { name: "Re-run appeal analysis" });
  await expect(retry).toBeEnabled({ timeout: 20000 });
  const retried = r.waitForResponse(
    (res) =>
      res.url().includes("/appeals/") &&
      res.url().endsWith("/analyze") &&
      res.request().method() === "POST",
  );
  await retry.click();
  expect((await retried).status()).toBe(202);
  const appealPath = new URL(r.url()).pathname;
  await expect
    .poll(
      async () => {
        const response = await r.request.get("/api/v1" + appealPath);
        return (await response.json()).data.analysisJob.status;
      },
      { timeout: 20000 },
    )
    .toBe("SUCCEEDED");
  await r.reload();
  await expect(retry).toBeEnabled();

  await r
    .getByRole("combobox", { name: /^Outcome/ })
    .selectOption("OVERTURNED");
  await r
    .getByLabel("Reasoning, including policy basis")
    .fill("The independent reviewer accepts the educational explanation.");
  await r.getByLabel("I have manually reviewed").check();
  await r.getByRole("button", { name: "Record final outcome" }).click();
  await r
    .getByRole("dialog")
    .getByRole("button", { name: "Record outcome", exact: true })
    .click();
  await expect(r.getByText("Final action: ALLOW")).toBeVisible();
  await p.goto("/content");
  await expect(p.getByText("visible", { exact: true })).toBeVisible();
  await author.close();
  await mod.close();
  await reviewer.close();
});
test("public about page introduces the product and routes to sign-in", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/about");
  await expect(
    page.getByRole("heading", { name: /Context before/i }),
  ).toBeVisible();
  // anchor navigation to the workflow section (scope to the primary nav)
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Workflow", exact: true })
    .click();
  await expect(page.locator("#workflow")).toBeVisible();
  // primary CTA leads to the existing sign-in entry
  await page
    .getByRole("link", { name: "Open review workspace", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in to workspace" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
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

test("About reveals remain readable on mobile with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/about");
  const reveal = page.locator("[data-reveal]");
  await expect(reveal.first()).toBeVisible();
  for (const item of await reveal.all()) {
    await item.scrollIntoViewIfNeeded();
    await expect(item).toHaveCSS("opacity", "1");
    await expect(item).toHaveCSS("transform", "none");
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: /Independent reviewer/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText(
    "Cannot be the original decision maker",
  );
  const icon = await page.request.get("/favicon.svg");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  await page.goto("/about");
  await expect(
    page.getByRole("heading", { name: /Context before/i }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/about-mobile.png",
    fullPage: true,
  });
});

test("About paired entrances settle at the center without overflow", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/about");
  const copy = page.locator(".hero-copy");
  const visual = page.locator(".hero-visual");
  await expect(copy).toHaveCSS("opacity", "1");
  await expect(visual).toHaveCSS("opacity", "1");
  await expect(copy).toHaveCSS("transform", "none");
  await expect(visual).toHaveCSS("transform", "none");
  for (const item of await page.locator("[data-reveal]").all()) {
    await item.scrollIntoViewIfNeeded();
    await expect(item).toHaveCSS("opacity", "1");
  }
  await page.evaluate(() => scrollTo(0, 0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/about-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("author signup persists after refresh, signs out, and demo has no staff controls", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Browser New Author");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("browser-new@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-signup-password");
  await page
    .getByRole("button", { name: "Create author account", exact: true })
    .click();
  await page.getByRole("button", { name: "Set up later", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Publish content", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Publish content", exact: true }),
  ).toBeVisible();
  await page.locator('button[title="Sign out"]').click();
  await expect(
    page.getByRole("button", { name: "Sign in to workspace", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in to workspace", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Try author demo", exact: true })
    .click();
  // The setup dismissal is scoped to the browser session.
  const later = page.getByRole("button", { name: "Set up later", exact: true });
  if (await later.isVisible()) await later.click();
  await expect(
    page.getByRole("button", { name: "Publish content", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Moderation queue", exact: true }),
  ).toHaveCount(0);
});
