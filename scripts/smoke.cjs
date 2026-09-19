// Browser smoke test. Set SUPABASE_SMOKE_EMAIL/PASSWORD to include protected pages.
require("@next/env").loadEnvConfig(process.cwd());
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const base = process.env.APP_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Smoke test is restricted to a local server.");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/login");
    await page.getByRole("heading", { name: "Welcome back" }).waitFor();
    await page.screenshot({
      path: path.join(os.tmpdir(), "forcemultiplier-login.png"),
      fullPage: true,
    });

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ) {
      await page.getByText(/Supabase Auth is not configured/).waitFor();
      console.log(
        "Browser passed: missing Supabase configuration is actionable",
      );
      return;
    }

    assert.equal(
      (await context.request.get(base + "/api/connections")).status(),
      401,
    );
    const email = process.env.SUPABASE_SMOKE_EMAIL;
    const password = process.env.SUPABASE_SMOKE_PASSWORD;
    if (!email || !password) {
      console.log(
        "Browser passed: login and protected API; set SUPABASE_SMOKE_EMAIL/PASSWORD to test signed-in pages",
      );
      return;
    }

    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/connections");
    const response = await context.request.get(base + "/api/connections");
    assert.equal(response.status(), 200);
    const data = await response.json();
    assert.ok(data.every((row) => !("tokens" in row) && !("secret" in row)));
    assert.equal(
      (
        await context.request.put(base + "/api/connections/salesforce", {
          headers: { Origin: "https://invalid.example" },
          data: { clientId: "must-not-save" },
        })
      ).status(),
      403,
    );
    for (const [route, title] of [
      ["/connections", "Make the connection."],
      ["/audiences", "Your audiences."],
      ["/audiences/new", "Start with the right people."],
      ["/lists", "Lists, all in one place."],
      ["/activity", "Every pull, accounted for."],
    ]) {
      await page.goto(base + route);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
        route + " overflows horizontally",
      );
      console.log("Browser passed:", route);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/connections");
    await page.getByRole("button", { name: "Sign out" }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
      "Mobile overflow",
    );
    assert.deepEqual(errors, []);
    console.log("Browser passed: mobile, protected API, CSRF, no page errors");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
