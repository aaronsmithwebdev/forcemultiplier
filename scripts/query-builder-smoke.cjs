// Run against a local server; protected pages use the existing smoke credentials.
// QUERY_BUILDER_PATH may point to a local component preview during UI development.
require("@next/env").loadEnvConfig(process.cwd());
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const base = process.env.APP_URL || "http://127.0.0.1:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Browser check is restricted to a local server.");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fields = [
      { name: "MailingState", label: "Mailing State", type: "string" },
      {
        name: "Total_Donations__c",
        label: "Total Donations",
        type: "currency",
      },
      { name: "HasOptedOutOfEmail", label: "Email Opt Out", type: "boolean" },
      { name: "Birthdate", label: "Birthdate", type: "date" },
      { name: "MailingAddress", label: "Mailing Address", type: "address" },
      { name: "Hidden__c", label: "Hidden", type: "string", filterable: false },
      {
        name: "LeadSource",
        label: "Lead Source",
        type: "picklist",
        picklistValues: [
          { label: "Web", value: "Web", active: true },
          { label: "Referral", value: "Referral", active: true },
          { label: "Retired", value: "Retired", active: false },
        ],
      },
    ];
    await page.route("**/api/salesforce/metadata?object=Contact", (route) =>
      route.fulfill({ json: { fields } }),
    );
    await page.route("**/api/salesforce/preview", (route) =>
      route.fulfill({
        json: {
          records: [
            {
              Id: "preview",
              FirstName: "Sample",
              LastName: "Contact",
              Email: "sample@example.test",
            },
          ],
        },
      }),
    );
    await page.goto(
      base + (process.env.QUERY_BUILDER_PATH || "/audiences/new"),
    );
    if (new URL(page.url()).pathname === "/login") {
      if (
        !process.env.SUPABASE_SMOKE_EMAIL ||
        !process.env.SUPABASE_SMOKE_PASSWORD
      )
        throw Error(
          "Set SUPABASE_SMOKE_EMAIL/PASSWORD to check the signed-in builder.",
        );
      await page
        .getByLabel("Email address")
        .fill(process.env.SUPABASE_SMOKE_EMAIL);
      await page
        .getByLabel("Password")
        .fill(process.env.SUPABASE_SMOKE_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL("**/connections");
      await page.goto(base + "/audiences/new");
    }
    await page.getByRole("button", { name: "Query Builder" }).click();
    await page
      .getByLabel("Audience name", { exact: true })
      .fill("Supporters in New South Wales");
    const root = page.getByRole("group", {
      name: "Audience conditions",
      exact: true,
    });
    const addRoot = root
      .getByRole("button", { name: "Add condition", exact: true })
      .last();
    const picker = page.locator(".query-field-picker");
    const search = page.getByRole("textbox", { name: "Find a Contact field" });
    const query = page.locator(".builder-query-details textarea");
    await expect(query).toBeHidden();
    await addRoot.click();
    await expect(search).toBeFocused();
    await expect(
      picker.getByRole("button", { name: /Mailing Address|Hidden/ }),
    ).toHaveCount(0);
    await search.fill("does not exist");
    await expect(picker.getByRole("status")).toContainText(
      "No matching fields",
    );
    await search.press("Escape");
    await expect(addRoot).toBeFocused();
    await expect(picker).toHaveCount(0);

    async function choose(searchText, fieldLabel) {
      await search.fill(searchText);
      await picker
        .getByRole("button", { name: new RegExp(fieldLabel) })
        .click();
    }
    await addRoot.click();
    await choose("MailingState", "Mailing State");
    await expect(page.getByLabel("Mailing State value")).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Save audience" }),
    ).toBeDisabled();
    await page.getByLabel("Mailing State value").fill("NSW");
    await addRoot.click();
    await choose("Donations", "Total Donations");
    await page.getByLabel("Total Donations operator").selectOption("gt");
    await page.getByLabel("Total Donations value").fill("100");
    await root
      .getByRole("button", { name: "Add group", exact: true })
      .last()
      .click();
    await choose("LeadSource", "Lead Source");
    const nested = page.getByRole("group", {
      name: "Condition group 3",
      exact: true,
    });
    await nested.getByRole("radio", { name: "OR", exact: true }).check();
    await expect(nested.getByText("Match any conditions")).toBeVisible();
    await nested.getByLabel("Lead Source value").selectOption("Web");
    await expect(nested.getByRole("option", { name: "Retired" })).toHaveCount(
      0,
    );
    await nested
      .getByRole("button", { name: "Add condition", exact: true })
      .click();
    await choose("LeadSource", "Lead Source");
    await nested
      .getByLabel("Lead Source value")
      .last()
      .selectOption("Referral");
    await expect(query).toHaveValue(
      "SELECT Id FROM Contact\nWHERE Email != null\nAND (MailingState = 'NSW' AND Total_Donations__c > 100 AND (LeadSource = 'Web' OR LeadSource = 'Referral'))",
    );
    await page.screenshot({
      path: path.join(os.tmpdir(), "forcemultiplier-query-desktop.png"),
      fullPage: true,
    });

    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `Page overflow at ${width}px`,
      );
      assert.equal(
        await root.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
        false,
        `Builder overflow at ${width}px`,
      );
      await expect(
        nested.getByRole("radio", { name: "OR", exact: true }),
      ).toBeVisible();
      if (width === 390)
        await page.screenshot({
          path: path.join(os.tmpdir(), "forcemultiplier-query-mobile.png"),
          fullPage: true,
        });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByText("View generated SOQL", { exact: true }).click();
    await expect(query).toBeVisible();
    await page.getByRole("button", { name: "Preview contacts" }).click();
    await expect(
      page.getByRole("heading", { name: "Contact preview" }),
    ).toBeVisible();
    await page.getByLabel("Mailing State operator").selectOption("is_null");
    await expect(page.getByLabel("Mailing State value")).toHaveCount(0);
    await expect(query).toHaveValue(/MailingState = null/);
    await expect(
      page.getByRole("heading", { name: "Contact preview" }),
    ).toHaveCount(0);
    await addRoot.click();
    await choose("Email Opt Out", "Email Opt Out");
    await page.getByLabel("Email Opt Out value").selectOption("false");
    await expect(query).toHaveValue(/HasOptedOutOfEmail = false/);
    await addRoot.click();
    await choose("Birthdate", "Birthdate");
    await page.getByLabel("Birthdate value").fill("1990-01-01");
    await expect(query).toHaveValue(/Birthdate = 1990-01-01/);
    await page
      .getByRole("button", { name: "Remove group 3", exact: true })
      .click();
    await expect(query).not.toHaveValue(/LeadSource/);
    await root.getByRole("radio", { name: "AND", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      root.getByRole("radio", { name: "OR", exact: true }),
    ).toBeChecked();
    await expect(query).toHaveValue(/MailingState = null OR Total_Donations/);
    await page.getByRole("button", { name: "Copy to editable SOQL" }).click();
    await expect(
      page.getByRole("textbox", { name: "Audience query", exact: true }),
    ).toBeEditable();
    await expect(
      page.getByRole("textbox", { name: "Audience query", exact: true }),
    ).toHaveValue(/MailingState = null OR Total_Donations/);
    assert.deepEqual(errors, []);
    console.log(
      "Query builder passed: scoped field search, keyboard controls, nested AND/OR, typed values, null operators, preview invalidation, SOQL handoff, desktop and mobile layouts.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
