import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { db } from "../lib/db";
import {
  importSuppressions,
  salesforceMatches,
  salesforceOptOutQuery,
  salesforceOptOutRows,
} from "../lib/suppressions";
import { receiveResendWebhook } from "../lib/resend-webhooks";

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

test("signed Resend unsubscribe webhooks are immediate and idempotent", async (t) => {
  const now = Date.parse("2026-09-27T04:00:00.000Z");
  const key = Buffer.from("a secure webhook test key");
  const secret = `whsec_${key.toString("base64")}`;
  const payload = JSON.stringify({
    type: "contact.updated",
    data: {
      id: "contact-1",
      email: " Person@Example.org ",
      updated_at: "2026-09-27T03:59:59.000Z",
      unsubscribed: true,
    },
  });
  const id = "msg_1";
  const timestamp = String(now / 1000);
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  const headers = new Headers({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  });
  let suppression: any;
  let event: any;
  mockMethod(t, db.suppression, "upsert", async (args: any) => {
    suppression = args;
    return args.create;
  });
  mockMethod(t, db.suppressionEvent, "createMany", async (args: any) => {
    event = args;
    return { count: 1 };
  });
  mockMethod(t, db, "$transaction", async (operations: any[]) =>
    Promise.all(operations),
  );

  assert.deepEqual(await receiveResendWebhook(payload, headers, secret, now), {
    received: true,
    suppressed: true,
  });
  assert.equal(suppression.create.email, "person@example.org");
  assert.equal(event.data[0].dedupeKey, "resend:msg_1");
  assert.equal(event.data[0].direction, "resend_to_forcemultiplier");
  assert.equal(event.skipDuplicates, true);
  await assert.rejects(
    receiveResendWebhook(`${payload} `, headers, secret, now),
    /Invalid Resend webhook/,
  );
  await assert.rejects(
    receiveResendWebhook(payload, headers, secret, now + 301_000),
    /Invalid Resend webhook/,
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
