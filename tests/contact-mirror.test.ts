import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../lib/db";
import { encrypt } from "../lib/security";
import {
  contactMirrorState,
  mirrorContactRow,
  runContactMirrorStep,
} from "../lib/contact-mirror";

function mock(t: TestContext, target: any, name: string, value: any) {
  const original = target[name];
  target[name] = value;
  t.after(() => {
    target[name] = original;
  });
}

test("Contact mirror checkpoints complete pages and covers changes and deletions", async (t) => {
  const oldKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  t.after(() => {
    process.env.APP_ENCRYPTION_KEY = oldKey;
  });
  const now = Date.now();
  let clock = now;
  mock(t, Date, "now", () => clock);
  const id1 = "003000000000000001";
  const id2 = "003000000000000002";
  const record = (Id: string) => ({
    Id,
    Email: `${Id}@example.org`,
    FirstName: "Test",
    LastName: "Contact",
    HasOptedOutOfEmail: false,
    SystemModstamp: new Date(now - 5 * 60_000).toISOString(),
  });
  const sync: any = {
    id: "salesforce",
    enabled: true,
    orgId: "org-1",
    phase: "bootstrap",
    cursor: null,
    deletedThrough: null,
    scanUntil: null,
    queryCursor: null,
    scanId: null,
    processed: 0,
    total: 0,
    leaseUntil: null,
    dueAt: new Date(0),
    error: null,
  };
  const queries: string[] = [];
  const writes: any[] = [];
  let failPage = true;
  let connectedOrg = "org-1";
  mock(t, db.connection, "findUnique", async () => ({
    provider: "salesforce",
    externalId: connectedOrg,
    version: 1,
    instanceUrl: "https://org.my.salesforce.com",
    tokens: encrypt(
      JSON.stringify({ accessToken: "test", refreshToken: "test" }),
    ),
    expiresAt: new Date(now + 3600_000),
  }));
  mock(t, db.contactMirrorSync, "findUniqueOrThrow", async () => ({ ...sync }));
  mock(t, db.contactMirrorSync, "findUnique", async () => ({ ...sync }));
  mock(t, db.contactMirrorSync, "update", async ({ data }: any) => {
    Object.assign(sync, data);
    return { ...sync };
  });
  mock(t, db.contactMirrorSync, "updateMany", async ({ where, data }: any) => {
    if (where.enabled && !sync.enabled) return { count: 0 };
    if (where.orgId && where.orgId !== sync.orgId) return { count: 0 };
    if (
      where.leaseUntil instanceof Date &&
      sync.leaseUntil?.getTime() !== where.leaseUntil.getTime()
    )
      return { count: 0 };
    if (where.OR && sync.leaseUntil && sync.leaseUntil > new Date())
      return { count: 0 };
    Object.assign(sync, data);
    return { count: 1 };
  });
  mock(t, db, "$transaction", async (fn: any) => fn(db));
  mock(t, db, "$executeRaw", async (sql: any) => {
    writes.push(sql);
    return 1;
  });
  mock(t, globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      "Bearer test",
    );
    queries.push(url);
    let data: any;
    if (url.includes("/deleted/")) {
      const end = new URL(url).searchParams.get("end")!;
      data = {
        latestDateCovered: end,
        earliestDateAvailable: new Date(now - 10 * 86_400_000).toISOString(),
        deletedRecords: [{ id: id1, deletedDate: end }],
      };
    } else if (url.includes("/query/locator")) {
      data = { done: true, totalSize: 2, records: [record(id2)] };
    } else if (url.includes("/query?q=")) {
      const soql = new URL(url).searchParams.get("q")!;
      data = soql.includes("SystemModstamp >=")
        ? { done: true, totalSize: 0, records: [] }
        : failPage
          ? { done: false, totalSize: 2, records: [record(id1)] }
          : {
              done: false,
              totalSize: 2,
              records: [record(id1)],
              nextRecordsUrl: "/services/data/v66.0/query/locator",
            };
    } else throw new Error(`Unexpected URL ${url}`);
    return new Response(JSON.stringify(data), { status: 200 });
  });

  await assert.rejects(runContactMirrorStep(), /incomplete Contact page/);
  assert.equal(sync.processed, 0);
  assert.equal(sync.queryCursor, null);
  assert.equal(writes.length, 0);
  failPage = false;
  await runContactMirrorStep();
  assert.equal(sync.processed, 1);
  assert.ok(sync.scanId);
  assert.equal(sync.queryCursor, "/services/data/v66.0/query/locator");
  await runContactMirrorStep();
  assert.equal(sync.phase, "changes");
  assert.equal(sync.scanId, null);
  assert.equal(sync.lastFullCount, 2);
  const sqlText = (sql: any) =>
    (Array.isArray(sql) ? sql : sql.strings).join("");
  assert.ok(writes.some((sql) => sqlText(sql).includes("IS DISTINCT FROM")));
  clock += 60_000;
  await runContactMirrorStep();
  assert.equal(sync.phase, "deletions");
  await runContactMirrorStep();
  assert.equal(sync.phase, "idle");
  assert.ok(sync.lastCompletedAt);
  assert.ok(
    writes.some((sql) => sqlText(sql).includes('"normalizedEmail" = NULL')),
  );
  const status = await contactMirrorState();
  assert.equal(status.phase, "idle");
  assert.equal(JSON.stringify(status).includes("example.org"), false);
  assert.equal(
    queries.filter((url) => url.includes("/query/locator")).length,
    1,
  );
  const staleCursor = new Date(now - 11 * 86_400_000);
  Object.assign(sync, {
    phase: "deletions",
    deletedThrough: staleCursor,
    scanUntil: new Date(now - 10 * 86_400_000),
    dueAt: new Date(0),
  });
  await assert.rejects(
    runContactMirrorStep(),
    /deletion history is incomplete/,
  );
  assert.equal(sync.deletedThrough, staleCursor);
  connectedOrg = "different-org";
  assert.deepEqual(await runContactMirrorStep(), { paused: true });
  assert.equal(sync.enabled, false);
  assert.equal(sync.deletedThrough, staleCursor);
});

test("Contact mirror refuses malformed identity and opt-out values", () => {
  assert.throws(() =>
    mirrorContactRow(
      {
        Id: "bad",
        HasOptedOutOfEmail: false,
        SystemModstamp: new Date().toISOString(),
      },
      "org-1",
    ),
  );
  assert.throws(() =>
    mirrorContactRow(
      {
        Id: "003000000000000001",
        HasOptedOutOfEmail: "false",
        SystemModstamp: new Date().toISOString(),
      },
      "org-1",
    ),
  );
  const contact = mirrorContactRow(
    {
      Id: "003000000000000001",
      Email: " Mixed.Case@Example.org ",
      HasOptedOutOfEmail: true,
      SystemModstamp: new Date().toISOString(),
    },
    "org-1",
  );
  assert.equal(contact.email, "Mixed.Case@Example.org");
  assert.equal(contact.normalizedEmail, "mixed.case@example.org");
});
