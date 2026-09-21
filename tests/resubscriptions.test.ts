import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesResubscribeFilters,
  parseResubscribeCsv,
  resubscribePayload,
} from "../lib/resubscribe-input";

test("resubscription CSV handles quoting, invalid rows and duplicates", () => {
  const parsed = parseResubscribeCsv(
    'Email,Name\n"ONE@example.com","Doe, Jane"\none@example.com,Duplicate\nbad,Invalid\ntwo@example.com,Two\n',
  );
  assert.deepEqual(parsed.emails, ["one@example.com", "two@example.com"]);
  assert.equal(parsed.duplicates, 1);
  assert.equal(parsed.invalid, 1);
});

test("resubscription CSV accepts valid email addresses longer than 50 characters", () => {
  const email = `${"a".repeat(60)}@example.com`;
  assert.deepEqual(parseResubscribeCsv(`Email\n${email}\n`).emails, [email]);
});

test("Salesforce resubscription filters require a value and strict amount threshold", () => {
  const filters = {
    presentField: "All_Mito_Connections__c",
    amountField: "Total_Donations__c",
    minimumAmount: 100,
  };
  assert.equal(
    matchesResubscribeFilters(
      { All_Mito_Connections__c: "Connection", Total_Donations__c: 101 },
      filters,
    ),
    true,
  );
  assert.equal(
    matchesResubscribeFilters(
      { All_Mito_Connections__c: "Connection", Total_Donations__c: 100 },
      filters,
    ),
    false,
  );
});

test("resubscribe PUT preserves core values and memberships", () => {
  const payload = resubscribePayload(
    {
      first_name: "Jane",
      last_name: "Doe",
      company_name: "Example",
      create_source: "Account",
      email_address: {
        address: "jane@example.com",
        permission_to_send: "unsubscribed",
      },
      list_memberships: ["11111111-1111-4111-8111-111111111111"],
    },
    "22222222-2222-4222-8222-222222222222",
  );
  assert.deepEqual(payload, {
    first_name: "Jane",
    last_name: "Doe",
    company_name: "Example",
    create_source: "Account",
    email_address: {
      address: "jane@example.com",
      permission_to_send: "explicit",
    },
    update_source: "Contact",
    lists: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
  });
});
