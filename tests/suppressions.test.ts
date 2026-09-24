import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../lib/db";
import { importSuppressions } from "../lib/suppressions";

test("suppression imports normalize, deduplicate and preserve existing rows", async (t) => {
  const original = db.suppression.createMany;
  db.suppression.createMany = (async ({ data }: any) => {
    assert.deepEqual(
      data.map((row: any) => row.email),
      ["one@example.com", "two@example.com"],
    );
    return { count: 1 };
  }) as typeof original;
  t.after(() => {
    db.suppression.createMany = original;
  });
  assert.deepEqual(
    await importSuppressions(
      [" ONE@example.com ", "one@example.com", "two@example.com"],
      "legacy.csv",
      "user-1",
    ),
    { submitted: 2, added: 1, existing: 1 },
  );
});
