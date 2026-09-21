import test from "node:test";
import assert from "node:assert/strict";
import { buildContactQuery, QueryFilter } from "../lib/query-builder";
import { validateQuery } from "../lib/soql";

test("query builder creates grouped AND and OR filters safely", () => {
  const query = buildContactQuery([
    {
      field: "MailingState",
      type: "string",
      operator: "eq",
      value: "NSW",
      conjunction: "AND",
    },
    {
      field: "All_Mito_Connections__c",
      type: "double",
      operator: "gt",
      value: "0",
      conjunction: "AND",
    },
    {
      field: "LastName",
      type: "string",
      operator: "starts",
      value: "O'Neil",
      conjunction: "OR",
    },
  ]);
  assert.equal(
    query,
    "SELECT Id FROM Contact\nWHERE Email != null\nAND (((MailingState = 'NSW' AND All_Mito_Connections__c > 0) OR LastName LIKE 'O\\'Neil%'))",
  );
  assert.doesNotThrow(() => validateQuery(query));
});

test("query builder rejects invalid numeric values", () => {
  assert.throws(
    () =>
      buildContactQuery([
        {
          field: "Total_Donations__c",
          type: "currency",
          operator: "gt",
          value: "100 OR Name != null",
          conjunction: "AND",
        },
      ]),
    /number/,
  );
});

test("query builder supports multi-select picklists", () => {
  assert.equal(
    buildContactQuery([
      {
        field: "Interests__c",
        type: "multipicklist",
        operator: "includes",
        value: "Research",
        conjunction: "AND",
      },
    ]),
    "SELECT Id FROM Contact\nWHERE Email != null\nAND (Interests__c INCLUDES ('Research'))",
  );
});

test("query builder preserves nested AND and OR groups", () => {
  const filter = (
    field: string,
    value: string,
    operator = "eq",
  ): QueryFilter => ({
    field,
    type: field === "All_Mito_Connections__c" ? "double" : "string",
    operator,
    value,
    conjunction: "AND",
  });
  const query = buildContactQuery({
    conjunction: "AND",
    items: [
      filter("MailingState", "NSW"),
      {
        conjunction: "OR",
        items: [
          filter("All_Mito_Connections__c", "0", "gt"),
          filter("LastName", "Smith"),
        ],
      },
    ],
  });
  assert.equal(
    query,
    "SELECT Id FROM Contact\nWHERE Email != null\nAND (MailingState = 'NSW' AND (All_Mito_Connections__c > 0 OR LastName = 'Smith'))",
  );
  assert.doesNotThrow(() => validateQuery(query));
});
