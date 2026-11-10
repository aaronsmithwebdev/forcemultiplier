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
test("translates a Contact-rooted custom report type with optional joins", () => {
  const r = report();
  r.reportMetadata.reportType = { type: "Contacts_with_Mito_Connections__c" };
  Object.assign(r.reportTypeMetadata, {
    objects: [
      { apiName: "Contact", joinType: "ROOT" },
      { apiName: "Mito_Connection__c", joinType: "OUTER" },
    ],
  });
  assert.equal(
    translateReport(r, contact, account).query,
    "SELECT Id FROM Contact WHERE (MailingCountry = 'Australia')",
  );
});
test("translates related-record cross filters and relative date criteria", () => {
  const r = report();
  r.reportMetadata.reportFilters[0] = {
    column: "LAST_DONATION",
    operator: "equals",
    value: "LAST 24 MONTHS",
  };
  Object.assign(r.reportTypeMetadata.categories.contacts.columns, {
    LAST_DONATION: { entityColumnName: "Contact.Last_Donation_Date__c" },
  });
  const datedContact = {
    ...contact,
    fields: [
      ...contact.fields,
      {
        name: "Last_Donation_Date__c",
        label: "Last Donation Date",
        type: "date",
        filterable: true,
      },
    ],
  };
  const cross = {
    primaryEntityField: "CONTACT_ID",
    relatedEntity: "OCR-Opportunity",
    relatedEntityJoinField: "ContactId",
    includesObject: false,
    criteria: [
      {
        column: "RecordTypeId",
        operator: "equals",
        value: "Major Donor,Trust",
      },
      { column: "CloseDate", operator: "greaterThan", value: "2025-07-01" },
    ],
  };
  Object.assign(r.reportMetadata, { crossFilters: [cross] });
  const related: Record<string, ObjectMetadata> = {
    OpportunityContactRole: {
      name: "OpportunityContactRole",
      label: "Opportunity Contact Role",
      fields: [
        {
          name: "ContactId",
          label: "Contact",
          type: "reference",
          referenceTo: ["Contact"],
        },
        {
          name: "OpportunityId",
          label: "Opportunity",
          type: "reference",
          referenceTo: ["Opportunity"],
          relationshipName: "Opportunity",
        },
      ],
      childRelationships: [],
    },
    Opportunity: {
      name: "Opportunity",
      label: "Opportunity",
      fields: [
        { name: "RecordTypeId", label: "Record Type", type: "reference" },
        { name: "CloseDate", label: "Close Date", type: "date" },
      ],
      childRelationships: [],
    },
  };
  const recordTypes = [
    { Id: "012000000000001", Name: "Major Donor" },
    { Id: "012000000000002", Name: "Trust" },
  ];
  assert.equal(
    translateReport(r, datedContact, account, related, recordTypes).query,
    "SELECT Id FROM Contact WHERE (Last_Donation_Date__c = LAST_N_MONTHS:24) AND (Id NOT IN (SELECT ContactId FROM OpportunityContactRole WHERE (Opportunity.RecordTypeId IN ('012000000000001', '012000000000002')) AND (Opportunity.CloseDate > 2025-07-01)))",
  );
  assert.equal(translateReport(r, datedContact, account, related).query, null);
  cross.includesObject = true;
  cross.criteria = [];
  assert.equal(
    translateReport(r, datedContact, account, related).query,
    "SELECT Id FROM Contact WHERE (Last_Donation_Date__c = LAST_N_MONTHS:24) AND (Id IN (SELECT ContactId FROM OpportunityContactRole))",
  );
});
test("translates direct child cross filters on the same related record", () => {
  const r = report();
  Object.assign(r.reportMetadata, {
    crossFilters: [
      {
        primaryEntityField: "CONTACT_ID",
        relatedEntity: "CampaignMember",
        relatedEntityJoinField: "ContactId",
        includesObject: true,
        criteria: [
          { column: "Status", operator: "equals", value: "Sent" },
          { column: "HasResponded", operator: "equals", value: "false" },
        ],
      },
    ],
  });
  const related = {
    CampaignMember: {
      name: "CampaignMember",
      label: "Campaign Member",
      fields: [
        {
          name: "ContactId",
          label: "Contact",
          type: "reference",
          referenceTo: ["Contact"],
        },
        { name: "Status", label: "Status", type: "string" },
        { name: "HasResponded", label: "Responded", type: "boolean" },
      ],
      childRelationships: [],
    },
  };
  assert.equal(
    translateReport(r, contact, account, related).query,
    "SELECT Id FROM Contact WHERE (MailingCountry = 'Australia') AND (Id IN (SELECT ContactId FROM CampaignMember WHERE (Status = 'Sent') AND (HasResponded = false)))",
  );
  Object.assign(r.reportMetadata, { reportBooleanFilter: "1 OR 1" });
  assert.equal(translateReport(r, contact, account, related).query, null);
});
test("rejects custom report types with another root or required child joins", () => {
  for (const objects of [
    [{ apiName: "Account", joinType: "ROOT" }],
    [
      { apiName: "Contact", joinType: "ROOT" },
      { apiName: "Mito_Connection__c", joinType: "INNER" },
    ],
  ]) {
    const r = report();
    r.reportMetadata.reportType = { type: "CustomReport" };
    Object.assign(r.reportTypeMetadata, { objects });
    assert.equal(translateReport(r, contact, account).query, null);
  }
});
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
