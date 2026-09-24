import assert from "node:assert/strict";
import test from "node:test";
import { prepareBroadcastHtml, uniqueEmails } from "../lib/campaign-sends";

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
