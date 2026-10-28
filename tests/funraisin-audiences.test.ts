import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { encrypt } from "../lib/security";
import { createAudience, startPull, pullStep } from "../lib/audiences";
import {
  FUNRAISIN_FIELDS,
  funraisinAudienceConnection,
  funraisinAudiencePage,
  parseFunraisinAudience,
} from "../lib/funraisin-audiences";

const id = "003ABCDEFGHIJKL";
const filters = JSON.stringify({
  type: "funraisin",
  people: "entrants",
  eventId: "42",
});
function mock(t: TestContext, target: any, key: string, fn: any) {
  const original = target[key];
  target[key] = fn;
  t.after(() => {
    target[key] = original;
  });
}
function setup(t: TestContext) {
  const env = { ...process.env };
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  t.after(() => {
    process.env = env;
  });
  const sync = {
    orgId: "org-1",
    baseUrl: "https://example.org/",
    lastCompletedAt: new Date(),
    scanUntil: null,
    error: null,
    updatedAt: new Date("2026-10-19T00:00:00Z"),
  };
  mock(t, db.connection, "findUnique", async () => ({
    externalId: "org-1",
    version: 1,
    instanceUrl: "https://example.my.salesforce.com",
    expiresAt: new Date(Date.now() + 3600000),
    tokens: encrypt(
      JSON.stringify({ accessToken: "test", refreshToken: "test" }),
    ),
  }));
  mock(t, db.funraisinSync, "findUnique", async () => sync);
  mock(t, db.funraisinEvent, "findUnique", async () => ({
    id: "42",
    name: "Walk",
  }));
  mock(t, globalThis, "fetch", async (url: string) => {
    assert.match(
      decodeURIComponent(String(url)),
      /SELECT Id, FirstName, LastName, Email, HasOptedOutOfEmail FROM Contact WHERE Id IN/,
    );
    assert.doesNotMatch(String(url), /FunraisinEventName/);
    return Response.json({
      done: true,
      totalSize: 1,
      records: [
        {
          Id: id,
          FirstName: "Sam",
          Email: "sam@example.org",
          HasOptedOutOfEmail: true,
        },
      ],
    });
  });
  return sync;
}
const row = {
  Id: id,
  total: 1n,
  count: 3n,
  amount: "75.50",
  donatedAt: new Date("2026-10-18Z"),
  target: "Alex",
  event: "Walk",
  username: "samwalker",
  eventKey: "autumn-walk",
  dateOfBirth: new Date("1990-02-28"),
};

test("Funraisin filters reject unsafe IDs, fractional counts and inverted ranges", () => {
  for (const patch of [
    { eventId: "42' OR TRUE" },
    { minDonations: 1.5 },
    { minDonations: 0 },
    { minDonations: 5, maxDonations: 2 },
    { people: "anything" },
  ]) {
    assert.throws(
      () =>
        parseFunraisinAudience(
          JSON.stringify({ type: "funraisin", people: "donors", ...patch }),
        ),
      /valid Funraisin/,
    );
  }
  assert.equal(parseFunraisinAudience(filters).paidOnly, true);
});

test("Funraisin pages retain event fields while enriching current Salesforce consent", async (t) => {
  setup(t);
  mock(t, db, "$queryRaw", async (sql: any) => {
    // Both audience membership and the event/URL lookup must use payment alone.
    assert.doesNotMatch(sql.sql, /r\.(?:active|complete|archived)/);
    assert.equal(sql.sql.match(/AND r\."isPaid"/g)?.length, 2);
    assert.match(sql.sql, /p\."dateOfBirth"/);
    assert.match(sql.sql, /entrant\."dateOfBirth"/);
    assert.ok(sql.values.includes("42"));
    return [row];
  });
  const page = await funraisinAudiencePage(filters);
  assert.equal(page.done, true);
  assert.equal(page.totalSize, 1);
  assert.deepEqual(page.records[0], {
    Id: id,
    FirstName: "Sam",
    Email: "sam@example.org",
    HasOptedOutOfEmail: true,
    FunraisinEventName: "Walk",
    FunraisinUsername: "samwalker",
    FunraisinEventKey: "autumn-walk",
    FunraisinFundraisingUrl:
      "https://example.org/fundraisers/samwalker/autumn-walk",
    FunraisinDateOfBirth: "1990-02-28",
    FunraisinDonationCount: 3,
    FunraisinDonationTotal: "75.50",
    FunraisinLastDonatedAt: "2026-10-18",
    FunraisinLastDonatedToName: "Alex",
  });
});

test("donors are counted after payment and refunds, within the selected event", async (t) => {
  setup(t);
  mock(t, db, "$queryRaw", async (sql: any) => {
    assert.match(sql.sql, /d.status = 'paid' AND d.amount > COALESCE/);
    assert.match(sql.sql, /HAVING COUNT\(\*\) >=/);
    assert.match(sql.sql, /AND COUNT\(\*\) <=/);
    assert.ok(sql.values.includes(2));
    assert.ok(sql.values.includes(4));
    assert.match(sql.sql, /ORDER BY d\."donatedAt" DESC NULLS LAST/);
    return [];
  });
  const page = await funraisinAudiencePage(
    JSON.stringify({
      type: "funraisin",
      people: "donors",
      eventId: "42",
      minDonations: 2,
      maxDonations: 4,
    }),
  );
  assert.equal(page.done, true);
  assert.deepEqual(page.records, []);
});

test("donor audiences do not contain participant birth dates", async (t) => {
  setup(t);
  mock(t, db, "$queryRaw", async () => [row]);
  const page = await funraisinAudiencePage(
    JSON.stringify({ type: "funraisin", people: "donors" }),
  );
  assert.equal(Object.hasOwn(page.records[0]!, "FunraisinDateOfBirth"), false);
  mock(t, db.audience, "create", async ({ data }: any) => data);
  const audience = await createAudience({
    name: "Donors",
    sourceType: "funraisin",
    query: JSON.stringify({ type: "funraisin", people: "donors" }),
    fields: [],
  });
  assert.deepEqual(
    audience.fields,
    FUNRAISIN_FIELDS.filter((field) => field !== "FunraisinDateOfBirth"),
  );
});

test("pagination uses a lookahead and rejects sync changes before publishing", async (t) => {
  const sync = setup(t);
  mock(t, db, "$queryRaw", async () => [
    row,
    { ...row, Id: "003ABCDEFGHIJKM", total: 2n },
  ]);
  const page = await funraisinAudiencePage(filters, null, 1);
  assert.equal(page.done, false);
  assert.equal(page.records.length, 1);
  assert.equal(JSON.parse(page.nextRecordsUrl!).after, id);
  sync.updatedAt = new Date("2026-10-19T01:00:00Z");
  await assert.rejects(
    funraisinAudiencePage(filters, page.nextRecordsUrl!),
    /changed during this pull/,
  );
  mock(t, db, "$queryRaw", async () => {
    sync.updatedAt = new Date("2026-10-19T02:00:00Z");
    return [];
  });
  await assert.rejects(
    funraisinAudiencePage(filters),
    /changed during extraction/,
  );
});

test("incomplete syncs and a different org cannot supply audiences", async (t) => {
  const sync = setup(t);
  sync.error = "Sync failed" as any;
  await assert.rejects(
    funraisinAudiencePage(filters),
    /successful Funraisin sync/,
  );
  sync.error = null;
  await assert.rejects(
    funraisinAudiencePage(filters, null, 25, "other-org"),
    /linked to the Funraisin sync/,
  );
});

test("event browsing allows incomplete syncs but still requires the linked Salesforce org", async (t) => {
  const sync = setup(t);
  for (const state of [
    { lastCompletedAt: null, scanUntil: new Date(), error: null },
    { lastCompletedAt: new Date(), scanUntil: new Date(), error: null },
    { lastCompletedAt: new Date(), scanUntil: null, error: "Sync failed" },
  ]) {
    Object.assign(sync, state);
    const config = await funraisinAudienceConnection(undefined, {
      requireCompletedSync: false,
    });
    assert.equal(config.orgId, "org-1");
    await assert.rejects(
      funraisinAudienceConnection(),
      /successful Funraisin sync/,
    );
  }
  sync.orgId = "other-org";
  await assert.rejects(
    funraisinAudienceConnection(undefined, { requireCompletedSync: false }),
    /linked to the Funraisin sync/,
  );
});

test("creating and starting a Funraisin audience preserves filters and fields", async (t) => {
  setup(t);
  mock(t, db.audience, "create", async ({ data }: any) => ({
    id: "aud-1",
    ...data,
  }));
  const audience = await createAudience({
    name: "Paid walkers",
    sourceType: "funraisin",
    query: filters,
    fields: [],
  });
  assert.deepEqual(audience.fields, [...FUNRAISIN_FIELDS]);
  mock(t, db.audience, "findUnique", async () => audience);
  mock(t, db.pullRun, "findFirst", async () => null);
  mock(t, db.pullRun, "create", async ({ data }: any) => data);
  const run = await startPull("aud-1");
  assert.equal(run.query, audience.query);
  assert.equal(run.orgId, "org-1");
});

test("a Funraisin pull publishes enriched members through the shared snapshot path", async (t) => {
  setup(t);
  const run = {
    id: "run-1",
    audienceId: "aud-1",
    query: filters,
    fields: [...FUNRAISIN_FIELDS],
    orgId: "org-1",
    cursor: null,
    processed: 0,
    total: 0,
  };
  mock(t, db.pullRun, "updateMany", async () => ({ count: 1 }));
  mock(t, db.pullRun, "findUnique", async () => run);
  mock(t, db, "$queryRaw", async () => [row]);
  let saved = false;
  mock(t, db, "$transaction", async (fn: any) =>
    fn({
      audience: { findUniqueOrThrow: async () => ({ manualVersion: 0 }) },
      pullRun: {
        updateMany: async ({ data }: any) => {
          assert.equal(data.status, "completed");
          assert.equal(data.processed, 1);
          return { count: 1 };
        },
        findUniqueOrThrow: async () => ({ ...run, status: "completed" }),
      },
      audienceMember: {
        createMany: async ({ data }: any) => {
          assert.equal(data[0].salesforceId, id);
          assert.equal(data[0].optedOut, true);
          assert.equal(data[0].data.FunraisinDateOfBirth, "1990-02-28");
          assert.equal(data[0].data.FunraisinLastDonatedToName, "Alex");
          saved = true;
          return { count: 1 };
        },
      },
      manualAudienceMember: {
        findMany: async () => [],
      },
    }),
  );
  const result = await pullStep(run.id);
  assert.equal(result.status, "completed");
  assert.equal(saved, true);
});

test("unchecking paid entrants includes registrations without status filters", async (t) => {
  setup(t);
  mock(t, db, "$queryRaw", async (sql: any) => {
    assert.doesNotMatch(sql.sql, /r\.(?:active|complete|archived|"isPaid")/);
    assert.equal(sql.sql.match(/AND r\."eventId" =/g)?.length, 2);
    assert.ok(sql.values.includes("42"));
    return [row];
  });
  const page = await funraisinAudiencePage(
    JSON.stringify({ ...JSON.parse(filters), paidOnly: false }),
  );
  assert.equal(page.records.length, 1);
  assert.equal(
    page.records[0]!.FunraisinFundraisingUrl,
    "https://example.org/fundraisers/samwalker/autumn-walk",
  );
});
