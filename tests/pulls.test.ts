import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { encrypt } from "../lib/security";
import { pullStep } from "../lib/audiences";
process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
function fixture(t: any, total: number) {
  let state: any = {
    id: "run",
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
  let failPage = -1;
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
        pullRun: {
          updateMany: update,
          findUniqueOrThrow: async () => ({ ...state }),
        },
        audienceMember: {
          createMany: async ({ data }: any) => {
            let count = 0;
            for (const r of data)
              if (!members.has(r.salesforceId)) {
                members.set(r.salesforceId, r);
                count++;
              }
            return { count };
          },
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
    failAt: (page: number) => {
      failPage = page;
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
