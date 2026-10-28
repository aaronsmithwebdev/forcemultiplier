import { db } from "../lib/db";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  funraisinContactId,
  funraisinId,
  funraisinPageUrl,
  funraisinRow,
  funraisinFundraisingUrl,
  funraisinSyncStatus,
  setFunraisinCurrentYearOnly,
  runFunraisinSyncStep,
} from "../lib/funraisin";

test("Funraisin records keep event and Salesforce identities distinct", () => {
  assert.equal(
    funraisinPageUrl(new URL("https://example.org/"), "events", 0, null)
      .pathname,
    "/api/events",
  );
  assert.equal(
    funraisinPageUrl(
      new URL("https://example.org/site/"),
      "donations",
      1000,
      null,
    ).pathname,
    "/site/api/donations",
  );
  const contact = "003ABCDEFGHIJKL";
  const linked = funraisinContactId(contact);
  assert.equal(linked?.length, 18);
  assert.equal(funraisinContactId(linked), linked);
  assert.equal(funraisinContactId(`${contact}AAA`), null);
  assert.equal(funraisinContactId("00vABCDEFGHIJKL"), null);
  assert.equal(funraisinId(0), null);

  assert.deepEqual(
    funraisinRow("events", {
      event_id: "42",
      event_name: " Autumn Walk ",
      event_date: "2026-10-17",
    }),
    {
      id: "42",
      name: "Autumn Walk",
      eventDate: new Date("2026-10-17"),
      eventKey: null,
    },
  );
  assert.deepEqual(
    funraisinRow("registrations", {
      history_id: "9",
      member_id: "7",
      event_id: "42",
      is_active: "Y",
      is_complete: "Y",
      is_paid: "Y",
      is_archived: "N",
      crm_history_id: "00vABCDEFGHIJKL",
    }),
    {
      id: "9",
      memberId: "7",
      eventId: "42",
      active: true,
      complete: true,
      isPaid: true,
      archived: false,
    },
  );
  assert.equal(
    funraisinRow("registrations", {
      history_id: "10",
      member_id: "7",
      event_id: "42",
      is_active: "N",
      is_complete: "",
      is_paid: "N",
      is_archived: "Y",
    }).complete,
    false,
  );
  assert.throws(() =>
    funraisinRow("registrations", {
      history_id: "11",
      is_active: "N",
      is_complete: "Y",
      is_paid: "maybe",
      is_archived: "N",
    }),
  );
  assert.deepEqual(
    funraisinRow("participants", {
      member_id: "7",
      crm_member_id: contact,
      m_fname: " Mary Jane ",
      m_lname: "Smith",
      m_dob: "1990-02-28",
    }),
    {
      id: "7",
      salesforceId: linked,
      firstName: "Mary Jane",
      name: "Mary Jane Smith",
      email: null,
      username: null,
      dateOfBirth: new Date("1990-02-28"),
    },
  );
  for (const invalid of ["0000-00-00", "2001-02-29", "not a date"])
    assert.equal(
      funraisinRow("participants", { member_id: "7", m_dob: invalid })
        .dateOfBirth,
      null,
    );
  assert.deepEqual(
    funraisinRow("teams", {
      team_id: "8",
      event_id: "42",
      t_name: " The Walkers ",
    }),
    { id: "8", eventId: "42", name: "The Walkers" },
  );
  assert.deepEqual(
    funraisinRow("donations", {
      donation_id: "11",
      event_id: "42",
      member_id: "7",
      team_id: "8",
      date_paid: "2026-10-17 09:04:03",
      crm_donor_id: contact,
      d_fname: "Pat",
      d_lname: "Donor",
      d_email: "PAT@example.com",
      d_status: "paid",
      d_amount: "75.50",
      d_refund_amount: "10.00",
    }),
    {
      id: "11",
      eventId: "42",
      salesforceId: linked,
      memberId: "7",
      teamId: "8",
      donatedAt: new Date("2026-10-17T09:04:03.000Z"),
      name: "Pat Donor",
      email: "pat@example.com",
      status: "paid",
      amount: "75.50",
      refundAmount: "10.00",
    },
  );
  assert.equal(
    funraisinRow("donations", {
      donation_id: "13",
      date_paid: "0000-00-00 00:00:00",
      date_created: "2026-10-17 10:00:00",
      d_amount: "10.00",
      d_refund_amount: "0.00",
    }).donatedAt?.toISOString(),
    "2026-10-17T10:00:00.000Z",
  );
  assert.throws(() =>
    funraisinRow("donations", {
      donation_id: "12",
      d_amount: "not money",
      d_refund_amount: "0.00",
    }),
  );
});

test("participant username and event key are imported without guessing from names", () => {
  assert.equal(
    funraisinRow("participants", { member_id: "7", m_username: " samwalker " })
      .username,
    "samwalker",
  );
  assert.equal(
    funraisinRow("events", {
      event_id: "42",
      event_name: "Autumn Walk",
      event_key: " autumn-walk ",
    }).eventKey,
    "autumn-walk",
  );
  assert.equal(
    funraisinRow("participants", { member_id: "7", m_username: "" }).username,
    null,
  );
});

test("fundraising URLs combine a safe base, username and event key", () => {
  assert.equal(
    funraisinFundraisingUrl("https://example.org/", "samwalker", "autumn-walk"),
    "https://example.org/fundraisers/samwalker/autumn-walk",
  );
  assert.equal(
    funraisinFundraisingUrl(
      "https://example.org/site/api/",
      "samwalker",
      "autumn-walk",
    ),
    "https://example.org/site/fundraisers/samwalker/autumn-walk",
  );
  assert.equal(
    funraisinFundraisingUrl("https://example.org/", "José", "autumn-walk"),
    "https://example.org/fundraisers/Jos%C3%A9/autumn-walk",
  );
  for (const segment of [
    null,
    "",
    "..",
    ".",
    "/evil",
    "a/b",
    "a\\b",
    "bad?query",
    "bad#fragment",
    "a b",
  ]) {
    assert.equal(
      funraisinFundraisingUrl("https://example.org/", segment, "walk"),
      "",
    );
    assert.equal(
      funraisinFundraisingUrl("https://example.org/", "sam", segment),
      "",
    );
  }
  for (const base of [
    null,
    "",
    "broken",
    "http://example.org",
    "javascript:alert(1)",
    "https://user:pass@example.org/",
    "https://example.org/?key=secret",
    "https://example.org/#fragment",
  ]) {
    assert.equal(funraisinFundraisingUrl(base, "sam", "walk"), "");
  }
});

test("participant field rollout schedules a full backfill even after a recent full scan", async (t) => {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.FUNRAISIN_BASE_URL = "https://example.org/";
  process.env.FUNRAISIN_API_KEY = "test";
  function mock(target: any, name: string, fn: any) {
    const original = target[name];
    target[name] = fn;
    t.after(() => {
      target[name] = original;
    });
  }
  const sync = {
    id: "default",
    orgId: "org-1",
    baseUrl: "https://example.org/",
    participantUrlsVersion: 0,
    lastFullAt: new Date(),
    lastCompletedAt: new Date(),
    scanUntil: null,
    phase: "events",
    offset: 0,
    mode: "incremental",
  };
  mock(db.connection, "findUnique", async () => ({
    externalId: "org-1",
    tokens: "test",
  }));
  mock(db.funraisinSync, "upsert", async () => sync);
  mock(db.funraisinSync, "updateMany", async () => ({ count: 1 }));
  mock(db.funraisinSync, "findUniqueOrThrow", async () => sync);
  const starts: any[] = [];
  mock(db.funraisinSync, "update", async ({ data }: any) => {
    starts.push(data);
    return { ...sync, ...data };
  });
  mock(globalThis, "fetch", async () => {
    throw new Error("Stop before fetching data");
  });
  await assert.rejects(runFunraisinSyncStep(), /events could not be reached/);
  assert.equal(starts[0].mode, "full");
  assert.equal(starts[0].participantUrlsVersion, 2);
  sync.participantUrlsVersion = 1;
  starts.length = 0;
  await assert.rejects(runFunraisinSyncStep(), /events could not be reached/);
  assert.equal(starts[0].mode, "full");
  sync.participantUrlsVersion = 2;
  starts.length = 0;
  await assert.rejects(runFunraisinSyncStep(), /events could not be reached/);
  assert.equal(starts[0].mode, "incremental");
});

function syncSetup(t: TestContext, overrides: Record<string, unknown> = {}) {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.FUNRAISIN_BASE_URL = "https://example.org/";
  process.env.FUNRAISIN_API_KEY = "test";
  const sync = {
    id: "default",
    orgId: "org-1",
    baseUrl: "https://example.org/",
    participantUrlsVersion: 2,
    currentYearOnly: true,
    lastFullAt: new Date("2020-01-01"),
    lastCompletedAt: new Date(),
    scanUntil: null,
    phase: "events",
    offset: 0,
    processed: 0,
    total: 0,
    skipped: 0,
    mode: "incremental",
    scanId: null,
    scanEventIds: [],
    eventIndex: 0,
    dueAt: new Date(),
    leaseUntil: null,
    error: null,
    ...overrides,
  } as any;
  function mock(target: any, key: string, fn: any) {
    const original = target[key];
    target[key] = fn;
    t.after(() => {
      target[key] = original;
    });
  }
  mock(db.connection, "findUnique", async () => ({
    externalId: "org-1",
    tokens: "test",
  }));
  mock(db.workspaceSettings, "findUnique", async () => ({
    timeZone: "Australia/Sydney",
  }));
  mock(db.funraisinSync, "upsert", async ({ update }: any) => {
    Object.assign(sync, update);
    return { ...sync };
  });
  mock(db.funraisinSync, "findUnique", async () => ({ ...sync }));
  mock(db.funraisinSync, "findUniqueOrThrow", async () => ({ ...sync }));
  mock(db.funraisinSync, "update", async ({ data }: any) => {
    Object.assign(sync, data);
    return { ...sync };
  });
  mock(db.funraisinSync, "updateMany", async ({ data }: any) => {
    Object.assign(sync, data);
    return { count: 1 };
  });
  const queries: any[] = [];
  mock(db, "$executeRaw", async (sql: any) => {
    queries.push(sql);
    return 1;
  });
  mock(db, "$queryRaw", async () => [{ count: 0n }]);
  mock(db, "$transaction", async (fn: any) => fn(db));
  mock(db.funraisinIssue, "deleteMany", async () => ({ count: 0 }));
  mock(db.funraisinParticipant, "findMany", async () => [{ memberId: "7" }]);
  const eventQueries: any[] = [];
  mock(db.funraisinEvent, "findMany", async (args: any) => {
    eventQueries.push(args);
    return [{ id: "42" }, { id: "43" }];
  });
  const requests: URL[] = [];
  mock(globalThis, "fetch", async (url: URL) => {
    requests.push(new URL(url));
    return Response.json({ total_records: 0, data: [] });
  });
  return { sync, mock, queries, eventQueries, requests };
}

test("daily event scope uses the workspace year and preserves older data", async (t) => {
  const { sync, eventQueries, queries, mock } = syncSetup(t, {
    mode: "current-year",
    scanUntil: new Date("2026-12-31T14:00:00Z"),
    scanId: "scan-1",
  });
  const requests: URL[] = [];
  mock(globalThis, "fetch", async (url: URL) => {
    requests.push(new URL(url));
    return Response.json({ total_records: 0, data: [] });
  });
  await runFunraisinSyncStep();
  const scope = eventQueries.find((query) => query.where.eventDate);
  assert.equal(
    scope.where.eventDate.gte.toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
  assert.equal(
    scope.where.eventDate.lt.toISOString(),
    "2028-01-01T00:00:00.000Z",
  );
  assert.equal(scope.where.lastSeenScan, "scan-1");
  await runFunraisinSyncStep();
  assert.equal(sync.scanUntil, null);
  assert.ok(sync.dueAt.getTime() >= Date.now() + 23.9 * 3_600_000);
  assert.equal(
    requests.filter((url) => url.pathname.endsWith("/participants")).length,
    1,
  );
  assert.ok(
    requests
      .find((url) => url.pathname.endsWith("/participants"))!
      .searchParams.has("date_from"),
  );
  for (const phase of ["participantsevents", "teams", "donations"]) {
    const urls = requests.filter((url) => url.pathname.endsWith(`/${phase}`));
    assert.deepEqual(
      urls.map((url) =>
        url.searchParams.get(
          phase === "teams" ? "filter[event_id]" : "event_id",
        ),
      ),
      ["42", "43"],
    );
    assert.ok(urls.every((url) => !url.searchParams.has("date_from")));
  }
  const deletes = queries.filter((sql) => /DELETE FROM/.test(sql.sql));
  assert.equal(deletes.length, 3);
  for (const sql of deletes) {
    assert.match(sql.sql, /"eventId" IN/);
    assert.ok(sql.values.includes("42") && sql.values.includes("43"));
    assert.doesNotMatch(
      sql.sql,
      /FunraisinEvent|FunraisinParticipant"|FunraisinIssue/,
    );
  }
});

test("history completes before scoped refreshes, and disabling the setting restores all-years reconciliation", async (t) => {
  const { sync, mock } = syncSetup(t, { lastFullAt: null });
  mock(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  await assert.rejects(runFunraisinSyncStep(), /events could not be reached/);
  assert.equal(sync.mode, "full");
  sync.lastFullAt = new Date("2020-01-01");
  sync.scanUntil = null;
  await assert.rejects(runFunraisinSyncStep(), /events could not be reached/);
  assert.equal(sync.mode, "current-year");
  sync.currentYearOnly = false;
  sync.scanUntil = null;
  await assert.rejects(runFunraisinSyncStep(), /events could not be reached/);
  assert.equal(sync.mode, "full");
});

test("scoped retries resume at the failed event without resetting successful event work", async (t) => {
  const { sync, mock } = syncSetup(t, {
    mode: "current-year",
    phase: "registrations",
    scanUntil: new Date(),
    scanId: "scan-1",
    scanEventIds: ["42", "43"],
  });
  const requests: URL[] = [];
  let fail = true;
  mock(globalThis, "fetch", async (url: URL) => {
    const next = new URL(url);
    requests.push(next);
    if (next.searchParams.get("event_id") === "43" && fail)
      throw new Error("offline");
    return Response.json({ total_records: 0, data: [] });
  });
  await assert.rejects(
    runFunraisinSyncStep(),
    /participantsevents could not be reached/,
  );
  assert.equal(sync.phase, "registrations");
  assert.equal(sync.eventIndex, 1);
  assert.equal(sync.offset, 0);
  fail = false;
  await runFunraisinSyncStep();
  assert.equal(requests[2]!.searchParams.get("event_id"), "43");
  assert.equal(sync.scanUntil, null);
});

test("scoped responses cannot silently ignore the event filter", async (t) => {
  const { mock, queries } = syncSetup(t, {
    mode: "current-year",
    phase: "teams",
    scanUntil: new Date(),
    scanId: "scan-1",
    scanEventIds: ["42"],
  });
  mock(globalThis, "fetch", async () =>
    Response.json({
      total_records: 1,
      data: [{ team_id: "1", event_id: "99", t_name: "Wrong event" }],
    }),
  );
  await assert.rejects(runFunraisinSyncStep(), /outside the selected event/);
  assert.equal(queries.length, 0);
});

test("a failed page resumes its offset and reconciles only after every selected event finishes", async (t) => {
  const { sync, mock, queries } = syncSetup(t, {
    mode: "current-year",
    phase: "donations",
    scanUntil: new Date(),
    scanId: "scan-1",
    scanEventIds: ["42", "43"],
  });
  let fail = true;
  const offsets: string[] = [];
  mock(globalThis, "fetch", async (url: URL) => {
    const next = new URL(url);
    const offset = next.searchParams.get("offset")!;
    const eventId = next.searchParams.get("event_id");
    offsets.push(`${eventId}:${offset}`);
    if (offset === "1000" && fail)
      throw new DOMException("timeout", "TimeoutError");
    const data =
      eventId === "43"
        ? []
        : Array.from({ length: offset === "0" ? 1000 : 1 }, (_, index) => ({
            donation_id: String(Number(offset) + index + 1),
            event_id: "42",
            crm_donor_id: "003ABCDEFGHIJKL",
            d_amount: "10.00",
            d_refund_amount: "0.00",
          }));
    return Response.json({ total_records: eventId === "43" ? 0 : 1001, data });
  });
  await assert.rejects(runFunraisinSyncStep(), /donations request timed out/);
  assert.equal(sync.offset, 1000);
  assert.equal(sync.eventIndex, 0);
  assert.ok(queries.every((sql) => !/DELETE FROM/.test(sql.sql)));
  fail = false;
  await runFunraisinSyncStep();
  assert.deepEqual(offsets, ["42:0", "42:1000", "42:1000", "43:0"]);
  assert.equal(sync.scanUntil, null);
  assert.equal(queries.filter((sql) => /DELETE FROM/.test(sql.sql)).length, 1);
});

test("a year without dated events never falls back to unfiltered activity feeds", async (t) => {
  const { mock, requests, sync } = syncSetup(t);
  mock(db.funraisinEvent, "findMany", async () => []);
  await runFunraisinSyncStep();
  assert.equal(sync.scanUntil, null);
  assert.deepEqual(
    requests.map((url) => url.pathname),
    ["/api/events", "/api/participants"],
  );
});

test("changing the daily setting does not reset an active import", async (t) => {
  const { sync } = syncSetup(t, {
    phase: "donations",
    offset: 2000,
    scanUntil: new Date(),
  });
  const state = await setFunraisinCurrentYearOnly(false);
  assert.equal(state.currentYearOnly, false);
  assert.equal(sync.offset, 2000);
  assert.equal(sync.phase, "donations");
  assert.ok(sync.scanUntil);
});

test("status distinguishes an active worker, queued retry, between batches and daily schedule", async (t) => {
  const now = new Date("2026-10-28T03:00:00Z");
  const { sync } = syncSetup(t, {
    scanUntil: now,
    error: "Server unavailable",
    dueAt: new Date(now.getTime() + 300_000),
  });
  assert.match(
    funraisinSyncStatus(sync, "Australia/Sydney", now),
    /Retry scheduled/,
  );
  sync.dueAt = now;
  assert.match(
    funraisinSyncStatus(sync, "Australia/Sydney", now),
    /Waiting for the scheduled worker to retry/,
  );
  sync.leaseUntil = new Date(now.getTime() + 60_000);
  assert.match(
    funraisinSyncStatus(sync, "Australia/Sydney", now),
    /worker is running/,
  );
  sync.leaseUntil = null;
  sync.error = null;
  assert.match(
    funraisinSyncStatus(sync, "Australia/Sydney", now),
    /between batches/,
  );
  sync.scanUntil = null;
  assert.match(
    funraisinSyncStatus(sync, "Australia/Sydney", now),
    /Next daily sync/,
  );
});
