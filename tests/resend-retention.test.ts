import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../lib/db";
import {
  resendRetentionCutoff,
  runResendContactCleanup,
} from "../lib/resend-retention";

function mockMethod(t: any, target: any, name: string, fn: any) {
  const original = target[name];
  target[name] = fn;
  t.after(() => {
    target[name] = original;
  });
}

test("Resend retention uses exact calendar-day milliseconds", () => {
  assert.equal(
    resendRetentionCutoff(
      90,
      new Date("2026-09-27T03:00:00.000Z"),
    ).toISOString(),
    "2026-06-29T03:00:00.000Z",
  );
});

test("cleanup preserves an unsubscribe before deleting the Resend contact", async (t) => {
  const now = new Date("2026-09-27T03:00:00.000Z");
  const deleted: string[] = [];
  let suppression: any;
  let event: any;
  let tombstoned: any;

  mockMethod(t, db.workspaceSettings, "upsert", async () => ({
    resendContactRetentionDays: 90,
  }));
  mockMethod(t, db.workspaceSettings, "updateMany", async () => ({
    count: 1,
  }));
  mockMethod(t, db, "$queryRaw", async () => [
    {
      email: "person@example.org",
      lastActivityAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ]);
  mockMethod(t, db.suppression, "upsert", async (args: any) => {
    suppression = args;
    return args.create;
  });
  mockMethod(t, db.suppressionEvent, "createMany", async (args: any) => {
    event = args.data[0];
    return { count: 1 };
  });
  mockMethod(t, db, "$transaction", async (operations: any[]) =>
    Promise.all(operations),
  );
  mockMethod(t, db.campaignRecipient, "updateMany", async (args: any) => {
    tombstoned = args;
    return { count: 1 };
  });

  const result = await runResendContactCleanup(now, {
    get: async (email) => ({ id: "contact-1", email, unsubscribed: true }),
    delete: async (email) => {
      deleted.push(email);
    },
  });

  assert.deepEqual(result, { deleted: 1, remaining: false });
  assert.equal(suppression.create.email, "person@example.org");
  assert.equal(suppression.create.source, "resend");
  assert.equal(event.direction, "resend_to_forcemultiplier");
  assert.deepEqual(deleted, ["person@example.org"]);
  assert.deepEqual(tombstoned.data.providerContactDeletedAt, now);
});
