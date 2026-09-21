import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { updateAudienceQuery } from "../lib/audiences";

function mockMethod(t: any, target: any, name: string, fn: any) {
  const original = target[name];
  target[name] = fn;
  t.after(() => {
    target[name] = original;
  });
}

test("editing a source-derived audience converts it to independent SOQL", async (t) => {
  const audience: any = {
    id: "audience-one",
    orgId: "org-one",
    sourceType: "report",
    sourceId: "00O000000000001",
    query: "SELECT Id FROM Contact",
  };
  mockMethod(t, db.audience, "findUnique", async () => audience);
  mockMethod(t, db.connection, "findUnique", async () => ({
    provider: "salesforce",
    tokens: "encrypted",
    externalId: "org-one",
  }));
  mockMethod(t, db.audience, "update", async ({ data }: any) => ({
    ...audience,
    ...data,
  }));
  const updated = await updateAudienceQuery(
    audience.id,
    "SELECT Id FROM Contact WHERE Email != null",
  );
  assert.equal(updated.sourceType, "soql");
  assert.equal(updated.sourceId, null);
  assert.equal(updated.query, "SELECT Id FROM Contact WHERE Email != null");
});

test("editing rejects unsafe SOQL before writing", async (t) => {
  mockMethod(t, db.audience, "update", async () => {
    throw new Error("Unexpected write");
  });
  await assert.rejects(
    updateAudienceQuery("audience-one", "SELECT Name FROM Account"),
    /select from Contact/i,
  );
});
