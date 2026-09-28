import assert from "node:assert/strict";
import test from "node:test";
import { contactFieldValues, displayContactValue } from "../lib/contacts";

test("contact fields use the newest captured Salesforce value", () => {
  const audience = { id: "audience-1", name: "Supporters" };
  const fields = contactFieldValues([
    {
      data: { Level__c: "Gold", Account: { Name: "New account" } },
      run: {
        fields: ["Level__c", "Account.Name"],
        createdAt: new Date("2026-09-28T02:00:00Z"),
        finishedAt: new Date("2026-09-28T02:01:00Z"),
        audience,
      },
    },
    {
      data: { Level__c: "Silver", Legacy__c: true },
      run: {
        fields: ["Level__c", "Legacy__c"],
        createdAt: new Date("2026-09-27T02:00:00Z"),
        finishedAt: null,
        audience,
      },
    },
  ]);

  assert.deepEqual(
    fields.map(({ field, value }) => [field, value]),
    [
      ["Account.Name", "New account"],
      ["Legacy__c", true],
      ["Level__c", "Gold"],
    ],
  );
  assert.equal(displayContactValue(true), "Yes");
  assert.equal(displayContactValue(null), "—");
});
