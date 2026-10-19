import { db } from "../lib/db";
import assert from "node:assert/strict";
import test from "node:test";
import {
  funraisinContactId,
  funraisinId,
  funraisinPageUrl,
  funraisinRow,
  funraisinFundraisingUrl,
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
    }),
    {
      id: "7",
      salesforceId: linked,
      firstName: "Mary Jane",
      name: "Mary Jane Smith",
      email: null,
      username: null,
    },
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

test("URL field rollout schedules a full backfill even after a recent full scan", async (t) => {
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
  await assert.rejects(runFunraisinSyncStep(), /Stop before fetching/);
  assert.equal(starts[0].mode, "full");
  assert.equal(starts[0].participantUrlsVersion, 1);
  sync.participantUrlsVersion = 1;
  starts.length = 0;
  await assert.rejects(runFunraisinSyncStep(), /Stop before fetching/);
  assert.equal(starts[0].mode, "incremental");
});
