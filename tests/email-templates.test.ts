import assert from "node:assert/strict";
import test from "node:test";
import { mergeTagCatalog } from "../lib/template-merge-tags";

test("merge tags expose core and saved Salesforce fields as inline Liquid tokens", () => {
  const tags = mergeTagCatalog([
    "FirstName",
    "Account.Name",
    "Account.Name",
    "bad field",
  ]);
  assert.deepEqual(
    tags.map(({ label, value, group }) => ({ label, value, group })),
    [
      {
        label: "First Name",
        value: "{{contact.FirstName}}",
        group: "Contact fields",
      },
      {
        label: "Account › Name",
        value: "{{contact.Account.Name}}",
        group: "Related Salesforce fields",
      },
      {
        label: "Unsubscribe URL",
        value: "{{unsubscribe_url}}",
        group: "Delivery",
      },
    ],
  );
});
