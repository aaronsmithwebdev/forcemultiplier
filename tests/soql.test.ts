import test from "node:test";
import assert from "node:assert/strict";
import {
  validateQuery,
  previewQuery,
  combineFilterLogic,
  quote,
} from "../lib/soql";
import { translateReport, type ObjectMetadata } from "../lib/salesforce";

test("contact queries preserve semijoins and related fields", () => {
  const result = validateQuery(
    "SELECT Id, Account.Name FROM Contact WHERE Id IN (SELECT ContactId FROM CampaignMember WHERE CampaignId = '701000000000000')",
  );
  assert.equal(result.sObject, "Contact");
  assert.ok(result.where);
});
for (const query of [
  "SELECT Name FROM Contact",
  "SELECT Id FROM Account",
  "SELECT COUNT() FROM Contact",
  "SELECT Id FROM Contact FOR UPDATE",
  "SELECT Id FROM Contact FOR VIEW",
  "SELECT Id FROM Contact FOR REFERENCE",
  "SELECT Id FROM Contact OFFSET 100",
  "SELECT Id FROM Contact LIMIT 20",
  "SELECT Id FROM Contact ORDER BY CreatedDate LIMIT 20",
  "SELECT Id FROM Contact WITH SYSTEM_MODE",
  "SELECT Id FROM Contact; DELETE FROM Contact",
])
  test("reject unsafe/incomplete audience: " + query, () =>
    assert.throws(() => validateQuery(query)),
  );
test("preview caps results without changing the source query", () => {
  const source = "SELECT Id FROM Contact ORDER BY Id LIMIT 5000";
  assert.match(previewQuery(source), /LIMIT 25/);
  assert.equal(validateQuery(source).limit, 5000);
});
test("preview respects intentional smaller audience limits", () =>
  assert.match(
    previewQuery("SELECT Id FROM Contact ORDER BY Id LIMIT 4"),
    /LIMIT 4/,
  ));
test("a limited audience requires Id as its final deterministic sort", () =>
  assert.equal(
    validateQuery(
      "SELECT Id FROM Contact ORDER BY CreatedDate DESC, Id LIMIT 20",
    ).limit,
    20,
  ));
test("filter logic preserves grouping and operator precedence", () =>
  assert.equal(
    combineFilterLogic("(1 OR 2) AND 3", ["A", "B", "C"]),
    "((A) OR (B)) AND (C)",
  ));
test("filter logic rejects missing, unknown, or injected conditions", () => {
  for (const logic of ["1", "1 OR 9", "1; DROP", "(1 AND 2"])
    assert.throws(() => combineFilterLogic(logic, ["A", "B"]));
});
test("SOQL quotes apostrophes and backslashes", () =>
  assert.equal(quote("O'Brien\\value"), "'O\\'Brien\\\\value'"));
const contact: ObjectMetadata = {
  name: "Contact",
  label: "Contact",
  fields: [
    { name: "Email", label: "Email", type: "email", filterable: true },
    {
      name: "MailingCountry",
      label: "Country",
      type: "string",
      filterable: true,
    },
  ],
  childRelationships: [],
};
const account: ObjectMetadata = {
  name: "Account",
  label: "Account",
  fields: [
    { name: "Industry", label: "Industry", type: "picklist", filterable: true },
  ],
  childRelationships: [],
};
function report() {
  return {
    reportMetadata: {
      reportType: { type: "ContactList" },
      reportFormat: "SUMMARY",
      scope: "organization",
      standardDateFilter: {
        durationValue: "CUSTOM",
        startDate: null,
        endDate: null,
      },
      reportFilters: [
        { column: "COUNTRY", operator: "equals", value: "Australia" },
      ],
    },
    reportTypeMetadata: {
      categories: {
        contacts: {
          columns: { COUNTRY: { entityColumnName: "Contact.MailingCountry" } },
        },
      },
    },
  };
}
test("translates supported saved report membership to query", () =>
  assert.equal(
    translateReport(report(), contact, account).query,
    "SELECT Id FROM Contact WHERE (MailingCountry = 'Australia')",
  ));
for (const patch of [
  { scope: "user" },
  { crossFilters: [{}] },
  { topRows: { rowLimit: 100 } },
  { standardFilters: [{}] },
  { aggregateFilters: [{}] },
  { reportType: { type: "CustomReport" } },
  { reportFormat: "MULTI_BLOCK" },
  { standardDateFilter: { durationValue: "LAST_MONTH" } },
])
  test(
    "unsupported report semantics block translation: " + JSON.stringify(patch),
    () => {
      const r = report();
      Object.assign(r.reportMetadata, patch);
      const result = translateReport(r, contact, account);
      assert.equal(result.query, null);
      assert.ok(result.notes.length);
    },
  );
test("ambiguous report field fails closed", () => {
  const r = report();
  r.reportTypeMetadata.categories.contacts.columns.COUNTRY.entityColumnName =
    "User.Name";
  assert.equal(translateReport(r, contact, account).query, null);
});
test("blank and multivalue report filters need review", () => {
  for (const value of ["", "Australia,Canada"]) {
    const r = report();
    r.reportMetadata.reportFilters[0].value = value;
    assert.equal(translateReport(r, contact, account).query, null);
  }
});
