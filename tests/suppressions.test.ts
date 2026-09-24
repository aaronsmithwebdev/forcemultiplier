import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../lib/db";
import {
  importSuppressions,
  salesforceMatches,
  salesforceOptOutQuery,
  salesforceOptOutRows,
} from "../lib/suppressions";

function mockMethod(t: any, target: any, name: string, fn: any) {
  const original = target[name];
  target[name] = fn;
  t.after(() => {
    target[name] = original;
  });
}

test("suppression imports normalize, deduplicate and preserve existing rows", async (t) => {
  mockMethod(t, db.suppression, "createMany", async ({ data }: any) => {
    assert.deepEqual(
      data.map((row: any) => row.email),
      ["one@example.com", "two@example.com"],
    );
    return { count: 1 };
  });
  mockMethod(t, db.suppressionEvent, "createMany", async ({ data }: any) => {
    assert.equal(data.length, 2);
    assert.ok(
      data.every((row: any) => row.direction === "import_to_forcemultiplier"),
    );
    return { count: 2 };
  });
  mockMethod(t, db, "$transaction", async (operations: any[]) =>
    Promise.all(operations),
  );
  assert.deepEqual(
    await importSuppressions(
      [" ONE@example.com ", "one@example.com", "two@example.com"],
      "legacy.csv",
      "user-1",
    ),
    { submitted: 2, added: 1, existing: 1 },
  );
});

test("Salesforce opt-out scans use a bounded watermark", () => {
  const cursor = new Date("2026-09-24T00:00:00.000Z");
  const boundary = new Date("2026-09-25T00:00:00.000Z");
  const query = salesforceOptOutQuery(cursor, boundary);
  assert.match(query, /HasOptedOutOfEmail = true/);
  assert.match(query, /SystemModstamp > 2026-09-24T00:00:00.000Z/);
  assert.match(query, /SystemModstamp <= 2026-09-25T00:00:00.000Z/);
  assert.match(query, /ORDER BY SystemModstamp, Id$/);
});

test("Salesforce email matching exposes ambiguity", () => {
  const matches = salesforceMatches([
    {
      Id: "003000000000000001",
      Email: " ONE@example.com ",
      HasOptedOutOfEmail: false,
    },
    {
      Id: "003000000000000002",
      Email: "one@example.com",
      HasOptedOutOfEmail: true,
    },
    {
      Id: "003000000000000003",
      Email: "two@example.com",
      HasOptedOutOfEmail: false,
    },
  ]);
  assert.equal(matches.get("one@example.com")?.length, 2);
  assert.equal(matches.get("two@example.com")?.length, 1);
});

test("Salesforce opt-outs retain observed time and direction", () => {
  const recordedAt = new Date("2026-09-25T01:00:00.000Z");
  const rows = salesforceOptOutRows(
    [
      {
        Id: "003000000000000001",
        Email: "Person@Example.org",
        HasOptedOutOfEmail: true,
        SystemModstamp: "2026-09-24T23:59:00.000Z",
      },
      {
        Id: "003000000000000002",
        Email: null,
        HasOptedOutOfEmail: true,
        SystemModstamp: "2026-09-24T23:58:00.000Z",
      },
    ],
    "org-1",
    recordedAt,
  );
  assert.equal(rows.suppressions[0].email, "person@example.org");
  assert.equal(rows.events[0].direction, "salesforce_to_forcemultiplier");
  assert.deepEqual(
    rows.events[0].occurredAt,
    new Date("2026-09-24T23:59:00.000Z"),
  );
  assert.equal(rows.events[1].status, "invalid_email");
});
