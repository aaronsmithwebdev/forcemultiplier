import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { deliveryStep, importContact } from "../lib/deliveries";
import { encrypt } from "../lib/security";

process.env.APP_ENCRYPTION_KEY = "a".repeat(64);

test("Constant Contact import excludes opt-outs and maps safe names and email", () => {
  assert.deepEqual(
    importContact({
      email: " person@example.com ",
      optedOut: false,
      data: { FirstName: "Ada", LastName: "Lovelace" },
    }),
    {
      email: "person@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
    },
  );
  assert.equal(
    importContact({
      email: "opted-out@example.com",
      optedOut: true,
      data: {},
    }),
    null,
  );
  assert.equal(
    importContact({ email: "not-an-email", optedOut: false, data: {} }),
    null,
  );
});

test("Constant Contact import maps scalar and related Salesforce values", () => {
  assert.deepEqual(
    importContact(
      {
        email: "ada@example.com",
        optedOut: false,
        data: {
          Donation__c: 125.5,
          Account: { Member_Since__c: "2024-03-02T12:00:00.000Z" },
          Empty__c: null,
        },
      },
      [
        {
          source: "Donation__c",
          targetId: "one",
          targetName: "donation_amount",
          targetLabel: "Donation amount",
          targetType: "number",
        },
        {
          source: "Account.Member_Since__c",
          targetId: "two",
          targetName: "member_since",
          targetLabel: "Member since",
          targetType: "date",
        },
        {
          source: "Empty__c",
          targetId: "three",
          targetName: "empty",
          targetLabel: "Empty",
          targetType: "string",
        },
      ],
    ),
    {
      email: "ada@example.com",
      "cf:donation_amount": "125.5",
      "cf:member_since": "2024-03-02",
    },
  );
});

test("a delivery waits for Constant Contact and commits exclusions once", async (t) => {
  let state: any = {
    id: "delivery",
    sourceRunId: "pull",
    accountId: "account",
    listId: "11111111-1111-4111-8111-111111111111",
    listName: "Members",
    status: "pending",
    cursor: null,
    activityId: null,
    activityProgress: 0,
    batch: null,
    mappings: [],
    total: 2,
    processed: 0,
    submitted: 0,
    skipped: 0,
    failed: 0,
    leaseUntil: null,
  };
  const update = async ({ where, data }: any) => {
    if (
      where.leaseUntil &&
      state.leaseUntil?.getTime() !== where.leaseUntil.getTime()
    )
      return { count: 0 };
    if (where.status?.in && !where.status.in.includes(state.status))
      return { count: 0 };
    if (where.activityId === null && state.activityId !== null)
      return { count: 0 };
    for (const [key, value] of Object.entries(data))
      state[key] =
        value && typeof value === "object" && "increment" in value
          ? state[key] + value.increment
          : value;
    return { count: 1 };
  };
  mockMethod(t, db.deliveryRun, "updateMany", update);
  mockMethod(t, db.deliveryRun, "findUnique", async () => ({ ...state }));
  mockMethod(t, db.deliveryRun, "findUniqueOrThrow", async () => ({
    ...state,
  }));
  mockMethod(t, db.audienceMember, "findMany", async () => [
    {
      salesforceId: "003000000000000001",
      email: "ada@example.com",
      optedOut: false,
      data: { FirstName: "Ada", LastName: "Lovelace" },
    },
    {
      salesforceId: "003000000000000002",
      email: "no@example.com",
      optedOut: true,
      data: { FirstName: "No" },
    },
  ]);
  mockMethod(t, db.connection, "findUnique", async () => ({
    provider: "constant-contact",
    version: 1,
    externalId: "account",
    instanceUrl: "https://api.cc.email",
    tokens: encrypt(
      JSON.stringify({ accessToken: "access", refreshToken: "refresh" }),
    ),
    expiresAt: new Date(Date.now() + 3600000),
  }));
  let payload: any;
  mockMethod(t, globalThis, "fetch", async (_url: any, init: any) => {
    if (init?.method === "POST") {
      payload = JSON.parse(init.body);
      return Response.json({
        activity_id: "22222222-2222-4222-8222-222222222222",
        state: "initialized",
        percent_done: 1,
      });
    }
    return Response.json({
      state: "completed",
      percent_done: 100,
      activity_errors: [],
      status: { error_count: 0 },
    });
  });

  const waiting = await deliveryStep("delivery");
  assert.equal(waiting.activityId, "22222222-2222-4222-8222-222222222222");
  assert.deepEqual(payload.import_data, [
    {
      email: "ada@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
    },
  ]);
  const completed = await deliveryStep("delivery");
  assert.equal(completed.status, "completed");
  assert.equal(completed.processed, 2);
  assert.equal(completed.submitted, 1);
  assert.equal(completed.skipped, 1);
});

function mockMethod(t: any, target: any, name: string, fn: any) {
  const original = target[name];
  target[name] = fn;
  t.after(() => {
    target[name] = original;
  });
}
