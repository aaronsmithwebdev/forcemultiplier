import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignExclusionSql,
  prepareBroadcastHtml,
  uniqueEmails,
} from "../lib/campaign-sends";

test("broadcast HTML translates Templatical delivery tags", () => {
  const html = prepareBroadcastHtml(
    '<html><body>Hello {{contact.FirstName}} {{contact.LastName}} ({{contact.Email}}). <a href="{{unsubscribe_url}}">Leave</a></body></html>',
  );
  assert.match(html, /\{\{\{contact\.first_name\|there\}\}\}/);
  assert.match(html, /\{\{\{contact\.last_name\}\}\}/);
  assert.match(html, /\{\{\{contact\.email\}\}\}/);
  assert.match(html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  assert.equal(html.match(/RESEND_UNSUBSCRIBE_URL/g)?.length, 1);
});

test("broadcast HTML adds an unsubscribe footer and rejects unsupported fields", () => {
  assert.match(
    prepareBroadcastHtml("<html><body>Hello</body></html>"),
    /Unsubscribe.*<\/body>/,
  );
  assert.throws(
    () => prepareBroadcastHtml("Hello {{contact.Account.Name}}"),
    /Account\.Name/,
  );
});

test("manual exclusions are normalized and deduplicated", () => {
  assert.deepEqual(uniqueEmails([" A@Example.org ", "a@example.org", ""]), [
    "a@example.org",
  ]);
});

test("campaign field exclusions preserve nested AND and OR logic", () => {
  const query = campaignExclusionSql({
    conjunction: "AND",
    items: [
      {
        field: "Status__c",
        type: "string",
        operator: "eq",
        value: "Inactive",
        conjunction: "AND",
      },
      {
        conjunction: "OR",
        items: [
          {
            field: "Lifetime_Value__c",
            type: "currency",
            operator: "lt",
            value: "50",
            conjunction: "AND",
          },
          {
            field: "Email",
            type: "email",
            operator: "contains",
            value: "@example.org",
            conjunction: "AND",
          },
        ],
      },
    ],
  });
  assert.match(query.sql, / AND /);
  assert.match(query.sql, / OR /);
  assert.deepEqual(query.values, [
    "Status__c",
    "Inactive",
    "Lifetime_Value__c",
    "Lifetime_Value__c",
    50,
    "Email",
    "%@example.org%",
  ]);
});
