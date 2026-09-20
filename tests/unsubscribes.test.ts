import test from "node:test";
import assert from "node:assert/strict";
import { uniqueLinks } from "../lib/unsubscribes";

test("unsubscribe links deduplicate safe matches and expose ambiguity", () => {
  const links = uniqueLinks([
    { contactId: "cc-one", salesforceId: "003000000000000001" },
    { contactId: "cc-one", salesforceId: "003000000000000001" },
    { contactId: "cc-two", salesforceId: "003000000000000002" },
    { contactId: "cc-two", salesforceId: "003000000000000003" },
  ]);
  assert.deepEqual(links.get("cc-one"), ["003000000000000001"]);
  assert.deepEqual(links.get("cc-two"), [
    "003000000000000002",
    "003000000000000003",
  ]);
});
