import { salesforcePeopleFixture } from "./people-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { encrypt } from "../lib/security";
import { pullStep } from "../lib/audiences";
import { retryablePullError } from "../lib/errors";
process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
function fixture(t: any, total: number) {
  let state: any = {
    id: "run",
    audienceId: "audience",
    orgId: "org",
    status: "pending",
    query: "SELECT Id FROM Contact",
    fields: [],
    cursor: null,
    total: 0,
    processed: 0,
    leaseUntil: null,
  };
  const members = new Map<string, any>();
  const manualEmails: string[] = [];
  mockMethod(t, db.contactMirrorSync, "findUnique", async () => null);
  mockMethod(t, db.person, "updateMany", async () => ({ count: 1 }));
  mockMethod(t, db.audience, "findUniqueOrThrow", async () => ({
    manualVersion: 0,
  }));
  mockMethod(
    t,
    db.manualAudienceMember,
    "count",
    async () => manualEmails.length,
  );
  mockMethod(
    t,
    db.manualAudienceMember,
    "findMany",
    async ({ where, take }: any) =>
      manualEmails
        .filter((email) => !where.email?.gt || email > where.email.gt)
        .sort()
        .slice(0, take || manualEmails.length)
        .map((email) => ({
          email,
          personId: `local:${email}`,
          person: {
            id:
              email === "fixture@example.test" && total
                ? "person:003000000000000000"
                : `local:${email}`,
            orgId: "org",
            salesforceId:
              email === "fixture@example.test" && total
                ? "003000000000000000"
                : null,
            email,
            firstName: null,
            lastName: null,
            optedOut: false,
            unavailable: false,
          },
        })),
  );
  let failPage = -1;
  let failDatabaseOnce = false;
  let failPeopleOnce = false;
  let malformed = false;
  const config: any = {
    provider: "salesforce",
    version: 1,
    externalId: "org",
    instanceUrl: "https://org.my.salesforce.com",
    tokens: encrypt(
      JSON.stringify({ accessToken: "access", refreshToken: "refresh" }),
    ),
    expiresAt: new Date(Date.now() + 3600000),
  };
  mockMethod(t, db.connection, "findUnique", async () => config);
  const update = async ({ where, data }: any) => {
    if (
      where.leaseUntil &&
      state.leaseUntil?.getTime() !== where.leaseUntil.getTime()
    )
      return { count: 0 };
    if (typeof where.status === "string" && where.status !== state.status)
      return { count: 0 };
    if (where.status?.in && !where.status.in.includes(state.status))
      return { count: 0 };
    Object.assign(state, data);
    return { count: 1 };
  };
  mockMethod(t, db.pullRun, "updateMany", update);
  mockMethod(t, db.pullRun, "findUnique", async () => ({ ...state }));
  mockMethod(t, db, "$transaction", async (fn: any) => {
    const before = { ...state },
      saved = new Map(members);
    try {
      return await fn({
        $executeRaw: async () => 0,
        $queryRaw: async (sql: any) => {
          if (failPeopleOnce) {
            failPeopleOnce = false;
            throw Object.assign(new Error("Transaction expired"), {
              code: "P2028",
            });
          }
          return salesforcePeopleFixture(sql);
        },
        personEmail: { createMany: async () => ({ count: 0 }) },
        audience: { findUniqueOrThrow: async () => ({ manualVersion: 0 }) },
        pullRun: {
          updateMany: update,
          findUniqueOrThrow: async () => ({ ...state }),
        },
        audienceMember: {
          count: async () => members.size,
          findMany: async ({ where }: any) =>
            [...members.values()].filter(
              (member) =>
                member.runId === where.runId &&
                (!where.normalizedEmail ||
                  where.normalizedEmail.in.includes(member.normalizedEmail)),
            ),
          createMany: async ({ data }: any) => {
            if (failDatabaseOnce) {
              failDatabaseOnce = false;
              throw Object.assign(new Error("Connection pool timed out"), {
                code: "P2024",
              });
            }
            let count = 0;
            for (const r of data)
              if (!members.has(r.personId)) {
                members.set(r.personId, r);
                count++;
              }
            return { count };
          },
        },
        manualAudienceMember: {
          findMany: async () => manualEmails.map((email) => ({ email })),
        },
      });
    } catch (e) {
      state = before;
      members.clear();
      for (const [k, v] of saved) members.set(k, v);
      throw e;
    }
  });
  mockMethod(t, globalThis, "fetch", async (url: any) => {
    const u = new URL(url);
    const query = u.searchParams.get("q") || "";
    if (query.includes("WHERE Id IN")) {
      const ids = [...query.matchAll(/'(003\d{15})'/g)].map((m) => m[1]);
      return Response.json({
        done: true,
        totalSize: ids.length,
        records: ids.map((Id) => ({
          Id,
          FirstName: "Test",
          LastName: Id,
          Email: "fixture@example.test",
          HasOptedOutOfEmail: false,
        })),
      });
    }
    const offset = u.pathname.includes("/query/page-")
      ? Number(u.pathname.split("page-")[1])
      : 0;
    if (offset === failPage) return Response.json({}, { status: 429 });
    const count = Math.min(200, total - offset);
    const done = offset + count >= total;
    return Response.json({
      done,
      totalSize: malformed ? total + 1 : total,
      records: Array.from({ length: count }, (_, i) => ({
        Id: "003" + String(offset + i).padStart(15, "0"),
      })),
      ...(done
        ? {}
        : {
            nextRecordsUrl:
              "/services/data/v66.0/query/page-" + (offset + count),
          }),
    });
  });
  return {
    get state() {
      return state;
    },
    members,
    manualEmails,
    failAt: (page: number) => {
      failPage = page;
    },
    failDatabaseOnce: () => {
      failDatabaseOnce = true;
    },
    failPeopleOnce: () => {
      failPeopleOnce = true;
    },
    malform: () => {
      malformed = true;
    },
  };
}
test("a full pull paginates beyond 2,000 and publishes every unique contact", async (t) => {
  const f = fixture(t, 2105);
  let result: any;
  do {
    result = await pullStep("run");
  } while (result.status !== "completed");
  assert.equal(result.processed, 2105);
  assert.equal(f.members.size, 2105);
  assert.equal(result.cursor, null);
  assert.equal((await pullStep("run")).status, "completed");
});
test("an oversized Salesforce query stops before saving its first page", async (t) => {
  const f = fixture(t, 150001);
  await assert.rejects(pullStep("run"), /150,000-record manual pull limit/);
  assert.equal(f.state.status, "paused");
  assert.equal(f.state.processed, 0);
  assert.equal(f.members.size, 0);
});
test("a report page applies its third cross-filter before publishing the snapshot", async (t) => {
  const f = fixture(t, 3);
  f.state.query =
    "report:" +
    JSON.stringify({
      query: "SELECT Id FROM Contact",
      postFilter: {
        object: "Opportunity",
        joinField: "Donor__c",
        criteria: ["CloseDate > 2026-10-20"],
        includesObject: false,
      },
    });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) => {
    const query = new URL(url).searchParams.get("q") || "";
    return query.startsWith("SELECT Donor__c FROM Opportunity")
      ? Response.json({
          done: true,
          totalSize: 1,
          records: [{ Donor__c: "003000000000000001" }],
        })
      : originalFetch(url, options);
  }) as any;
  try {
    const run = await pullStep("run");
    assert.equal(run.status, "completed");
    assert.equal(run.processed, 2);
    assert.equal(run.total, 2);
    assert.equal(f.members.size, 2);
    assert.ok(!f.members.has("person:003000000000000001"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("manual emails join each completed snapshot without duplicating pulled emails", async (t) => {
  const f = fixture(t, 1);
  f.manualEmails.push("manager@example.test", "fixture@example.test");
  const source = await pullStep("run");
  assert.equal(source.status, "running");
  const result = await pullStep("run");
  assert.equal(result.status, "completed");
  assert.equal(result.processed, 2);
  assert.equal(f.members.size, 2);
  assert.deepEqual(f.members.get("local:manager@example.test"), {
    runId: "run",
    salesforceId: null,
    personId: "local:manager@example.test",
    deliveryKey: "local:local:manager@example.test",
    email: "manager@example.test",
    normalizedEmail: "manager@example.test",
    name: null,
    optedOut: false,
    data: {
      PersonId: "local:manager@example.test",
      Id: null,
      Email: "manager@example.test",
      FirstName: null,
      LastName: null,
      HasOptedOutOfEmail: false,
    },
  });
});
test("provider failure preserves cursor and successful pages; resume completes without duplicates", async (t) => {
  const f = fixture(t, 450);
  await pullStep("run");
  f.failAt(200);
  await assert.rejects(pullStep("run"), /rate limit/);
  assert.equal(f.state.status, "paused");
  assert.equal(f.state.processed, 200);
  assert.equal(f.members.size, 200);
  assert.equal(f.state.cursor, "/services/data/v66.0/query/page-200");
  f.failAt(-1);
  await pullStep("run");
  await pullStep("run");
  assert.equal(f.state.status, "completed");
  assert.equal(f.members.size, 450);
});
test("a temporary database timeout is retried without pausing or duplicating a page", async (t) => {
  const f = fixture(t, 200);
  let logged: any[] = [];
  mockMethod(t, console, "error", (...values: any[]) => (logged = values));
  f.failDatabaseOnce();
  const result = await pullStep("run");
  assert.equal(result.status, "completed");
  assert.equal(result.processed, 200);
  assert.equal(f.members.size, 200);
  assert.equal(logged[1].stage, "save page");
  assert.equal(logged[1].retry, true);
});
test("a timed-out person save retries without losing the pull cursor", async (t) => {
  const f = fixture(t, 200);
  let logged: any[] = [];
  mockMethod(t, console, "error", (...values: any[]) => (logged = values));
  f.failPeopleOnce();
  const result = await pullStep("run");
  assert.equal(result.status, "completed");
  assert.equal(result.processed, 200);
  assert.equal(f.members.size, 200);
  assert.equal(logged[1].stage, "save Salesforce people");
  assert.equal(logged[1].retry, true);
});
test("pull retries temporary request failures but stops on permanent errors", () => {
  assert.equal(retryablePullError({ status: 500 }, 1), true);
  assert.equal(retryablePullError({ status: 503 }, 1), true);
  assert.equal(retryablePullError({ status: 429 }, 1), true);
  assert.equal(retryablePullError(new TypeError("Failed to fetch"), 1), true);
  assert.equal(
    retryablePullError(
      { status: 409, message: "This pull is busy or has been cancelled." },
      1,
    ),
    true,
  );
  assert.equal(retryablePullError({ status: 403 }, 1), false);
  assert.equal(retryablePullError({ status: 422 }, 1), false);
  assert.equal(retryablePullError({ status: 500 }, 8), false);
});
test("truncated extraction pauses instead of publishing a partial snapshot", async (t) => {
  const f = fixture(t, 25);
  f.malform();
  await assert.rejects(pullStep("run"), /record count/);
  assert.equal(f.state.status, "paused");
  assert.equal(f.state.processed, 0);
  assert.equal(f.members.size, 0);
});

function mockMethod(t: any, target: any, name: string, fn: any) {
  const original = target[name];
  target[name] = fn;
  t.after(() => {
    target[name] = original;
  });
}

test("an imported list publishes local people without a Salesforce Contact lookup", async (t) => {
  const f = fixture(t, 0);
  f.state.query = "import";
  f.manualEmails.push("first@example.org", "second@example.org");
  mockMethod(t, globalThis, "fetch", async () =>
    assert.fail("Local members must not require CRM Contact enrichment"),
  );
  const run = await pullStep("run");
  assert.equal(run.status, "completed");
  assert.equal(run.total, 2);
  assert.equal(run.processed, 2);
  assert.equal(f.members.size, 2);
  for (const person of f.members.values()) {
    assert.equal(person.salesforceId, null);
    assert.ok(person.personId);
    assert.equal(person.data.Id, null);
  }
});

test("different people sharing an email retain separate audience memberships", async (t) => {
  const f = fixture(t, 1);
  mockMethod(t, db.manualAudienceMember, "findMany", async () => [
    {
      email: "fixture@example.test",
      personId: "shared-local",
      person: {
        id: "shared-local",
        orgId: "org",
        salesforceId: null,
        email: "fixture@example.test",
        firstName: "Another",
        lastName: "Person",
        optedOut: false,
        unavailable: false,
      },
    },
  ]);
  mockMethod(t, db.manualAudienceMember, "count", async () => 1);
  await pullStep("run");
  await pullStep("run");
  assert.equal(f.members.size, 2);
  assert.ok(f.members.has("shared-local"));
  assert.ok(f.members.has("person:003000000000000000"));
});

test("a 50,000-person imported audience publishes only after all bounded pages finish", async (t) => {
  const f = fixture(t, 0);
  f.state.query = "import";
  for (let index = 0; index < 50000; index++)
    f.manualEmails.push(`p${String(index).padStart(5, "0")}@example.org`);
  mockMethod(t, globalThis, "fetch", async () =>
    assert.fail("Local people must not require Salesforce lookup"),
  );
  let pages = 0;
  let run;
  do {
    run = await pullStep("run");
    pages++;
    if (pages < 100) assert.equal(run.status, "running");
  } while (run.status !== "completed");
  assert.equal(pages, 100);
  assert.equal(run.total, 50000);
  assert.equal(run.processed, 50000);
  assert.equal(f.members.size, 50000);
  assert.equal(run.cursor, null);
});
