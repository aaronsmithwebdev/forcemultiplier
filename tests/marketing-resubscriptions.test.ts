import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { encrypt } from "../lib/security";
import {
  createMarketingResubscription,
  marketingResubscriptionInput,
  verifyMarketingResubscription,
  retryMarketingResubscription,
} from "../lib/marketing-resubscriptions";

function mock(t: TestContext, target: any, name: string, fn: any) {
  const original = target[name];
  target[name] = fn;
  t.after(() => {
    target[name] = original;
  });
}
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === "OR") return value.some((item: any) => matches(row, item));
    if (key === "AND") return value.every((item: any) => matches(row, item));
    const actual = row[key];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.entries(value).every(([op, expected]: [string, any]) => {
        if (op === "not") return actual !== expected;
        if (op === "in") return expected.includes(actual);
        if (op === "gte") return actual != null && actual >= expected;
        if (op === "lt") return actual != null && actual < expected;
        if (op === "equals")
          return (
            String(actual).toLowerCase() === String(expected).toLowerCase()
          );
        if (op === "mode") return true;
        throw new Error(`Unsupported predicate ${op}`);
      });
    }
    return value instanceof Date
      ? actual?.getTime() === value.getTime()
      : actual === value;
  });
}
function setup(t: TestContext) {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  process.env.CRON_SECRET = "test-only";
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from("test-only-signing-secret").toString("base64")}`;
  process.env.RESEND_API_KEY = "test-only-resend";
  const now = Date.now();
  const state: any = {
    sync: {
      id: "salesforce",
      enabled: true,
      orgId: "org-1",
      baselineConfirmedAt: new Date(now - 86400000),
      cursor: new Date(now - 60000),
      lastCompletedAt: new Date(now - 50000),
      error: null,
      leaseUntil: null,
    },
    workspace: { id: "workspace", resendCleanupLeaseUntil: null },
    legacy: null,
    account: {
      externalId: "org-1",
      instanceUrl: "https://org.my.salesforce.com",
      tokens: encrypt(
        JSON.stringify({ accessToken: "test", refreshToken: "test" }),
      ),
      expiresAt: new Date(now + 3600000),
    },
    block: {
      email: "person@example.org",
      kind: "global_unsubscribe",
      source: "resend",
      occurredAt: new Date(now - 7200000),
      createdAt: new Date(now - 7200000),
      revision: 0,
    },
    jobs: [] as any[],
    events: [] as any[],
    legacyEvents: [] as any[],
    sf: {
      Id: "003000000000000001",
      Email: "person@example.org",
      HasOptedOutOfEmail: true,
      LastModifiedDate: new Date(now - 7200000).toISOString(),
    },
    contact: {
      id: "resend-1",
      email: "person@example.org",
      unsubscribed: true,
    },
    providerBlock: false,
    duplicate: false,
    sfFailure: false,
    resendFailure: false,
    finalRace: false,
    requests: [] as { path: string; method: string; body?: any }[],
    hook: (_path: string, _method: string) => {},
  };
  for (const [model, field] of [
    [db.salesforceSuppressionSync, "sync"],
    [db.workspaceSettings, "workspace"],
  ] as const) {
    mock(t, model, "findUnique", async () => ({ ...state[field] }));
    mock(t, model, "updateMany", async ({ where, data }: any) => {
      if (!matches(state[field], where)) return { count: 0 };
      Object.assign(state[field], data);
      return { count: 1 };
    });
  }
  mock(t, db.workspaceSettings, "upsert", async () => state.workspace);
  mock(t, db.unsubscribeSync, "findUnique", async () => state.legacy);
  mock(t, db.connection, "findUnique", async () => ({ ...state.account }));
  mock(
    t,
    db.suppression,
    "findUnique",
    async () => state.block && { ...state.block },
  );
  mock(
    t,
    db.suppression,
    "upsert",
    async ({ create }: any) =>
      (state.block ??= {
        ...create,
        kind: "global_unsubscribe",
        revision: 0,
        createdAt: new Date(),
      }),
  );
  mock(t, db.suppression, "deleteMany", async ({ where }: any) => {
    if (state.finalRace) state.block.revision++;
    if (!state.block || !matches(state.block, where)) return { count: 0 };
    state.block = null;
    return { count: 1 };
  });
  mock(
    t,
    db.suppressionEvent,
    "findFirst",
    async ({ where }: any) =>
      state.events.find((e: any) => matches(e, where)) ?? null,
  );
  mock(t, db.suppressionEvent, "updateMany", async ({ where, data }: any) => {
    const rows = state.events.filter((e: any) => matches(e, where));
    rows.forEach((e: any) => Object.assign(e, data));
    return { count: rows.length };
  });
  mock(
    t,
    db.unsubscribeEvent,
    "findFirst",
    async ({ where }: any) =>
      state.legacyEvents.find((e: any) => matches(e, where)) ?? null,
  );
  mock(
    t,
    db.marketingResubscription,
    "findUnique",
    async ({ where }: any) =>
      state.jobs.find((j: any) => matches(j, where)) ?? null,
  );
  mock(
    t,
    db.marketingResubscription,
    "findUniqueOrThrow",
    async ({ where }: any) => ({
      ...state.jobs.find((j: any) => matches(j, where)),
    }),
  );
  mock(
    t,
    db.marketingResubscription,
    "findFirst",
    async ({ where, orderBy }: any) => {
      const rows = state.jobs.filter((j: any) => matches(j, where));
      return (orderBy ? rows.at(-1) : rows[0]) ?? null;
    },
  );
  mock(t, db.marketingResubscription, "create", async ({ data }: any) => {
    const row = {
      ...data,
      createdAt: new Date(),
      suppressionRevision: 0,
      status: "processing",
      completedAt: null,
    };
    state.jobs.push(row);
    return { ...row };
  });
  mock(
    t,
    db.marketingResubscription,
    "update",
    async ({ where, data, omit }: any) => {
      const row = state.jobs.find((j: any) => j.id === where.id);
      Object.assign(row, data);
      const result = { ...row };
      if (omit?.resendKeyHash) delete result.resendKeyHash;
      return result;
    },
  );
  mock(t, db, "$transaction", async (operation: any) => {
    if (Array.isArray(operation)) return Promise.all(operation);
    const before = structuredClone({
      sync: state.sync,
      workspace: state.workspace,
      block: state.block,
      jobs: state.jobs,
      events: state.events,
    });
    try {
      return await operation(db);
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  });
  mock(t, globalThis, "fetch", async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    state.requests.push({ path, method, body });
    state.hook(path, method);
    if (path.endsWith("/query"))
      return Response.json({
        done: true,
        records: state.duplicate
          ? [state.sf, state.sf]
          : state.sf
            ? [state.sf]
            : [],
      });
    if (path.includes("/sobjects/Contact/")) {
      assert.equal(method, "PATCH");
      assert.deepEqual(body, { HasOptedOutOfEmail: false });
      assert.equal(
        (init.headers as any)["If-Unmodified-Since"],
        new Date(state.sf.LastModifiedDate).toUTCString(),
      );
      if (state.sfFailure) return Response.json([], { status: 412 });
      state.sf.HasOptedOutOfEmail = false;
      return new Response(null, { status: 204 });
    }
    if (path.startsWith("/suppressions/"))
      return Response.json(state.providerBlock ? { origin: "complaint" } : {}, {
        status: state.providerBlock ? 200 : 404,
      });
    if (path === "/contacts" && method === "POST") {
      assert.equal(body.unsubscribed, true);
      state.contact = { id: "recreated", ...body };
      return Response.json({ id: "recreated" });
    }
    if (path.startsWith("/contacts/")) {
      if (method === "PATCH") {
        assert.deepEqual(body, { unsubscribed: false });
        state.contact.unsubscribed = false;
        if (state.resendFailure)
          throw new Error("Response lost after provider accepted write");
        return Response.json({ id: state.contact.id });
      }
      return Response.json(state.contact ?? {}, {
        status: state.contact ? 200 : 404,
      });
    }
    throw new Error(`Unexpected network request ${url}`);
  });
  const input = marketingResubscriptionInput.parse({
    id: randomUUID(),
    email: " Person@Example.org ",
    consentAt: new Date(now - 60000).toISOString(),
    source: "Email request",
    evidence: "Explicit request recorded in ticket 123",
    scope: "all_workspace_marketing",
    confirmed: true,
  });
  const create = () => createMarketingResubscription(input, "staff-1");
  const writes = () => state.requests.filter((r: any) => r.method !== "GET");
  return { state, input, create, writes };
}

test("explicit consent reconciles both providers, retains evidence and supersedes old outbound retries", async (t) => {
  const { state, create, writes } = setup(t);
  state.events.push({
    email: state.block.email,
    direction: "forcemultiplier_to_salesforce",
    status: "failed",
  });
  const result = await create();
  assert.equal(result.status, "completed");
  assert.equal(state.block, null);
  assert.equal(writes().length, 2);
  assert.equal(state.events[0].status, "superseded");
  assert.equal(result.createdBy, "staff-1");
  assert.equal(result.scope, "all_workspace_marketing");
  assert.equal((result as any).previousSuppression.source, "resend");
  assert.equal("resendKeyHash" in result, false);
  assert.equal(state.sync.leaseUntil, null);
  assert.equal(state.workspace.resendCleanupLeaseUntil, null);
});

test("a repeated HTTP request never repeats consent writes", async (t) => {
  const { create, writes } = setup(t);
  assert.equal((await create()).status, "completed");
  assert.equal((await create()).status, "completed");
  assert.equal(writes().length, 2);
});

test("lost Resend response keeps the local block; verification can finish without replaying writes", async (t) => {
  const { state, input, create, writes } = setup(t);
  state.resendFailure = true;
  assert.equal((await create()).status, "needs_review");
  assert.ok(state.block);
  assert.equal((await create()).status, "needs_review");
  assert.equal(writes().length, 2);
  const result = await verifyMarketingResubscription(input.id);
  assert.equal(result.status, "completed");
  assert.equal(state.block, null);
  assert.equal(writes().length, 2);
});

test("Salesforce conditional-write conflict leaves the address blocked and never opts Resend in", async (t) => {
  const { state, input, create, writes } = setup(t);
  state.sfFailure = true;
  assert.equal((await create()).status, "needs_review");
  assert.ok(state.block);
  assert.equal(
    (await verifyMarketingResubscription(input.id)).status,
    "needs_review",
  );
  assert.equal(writes().length, 1);
  assert.equal(state.contact.unsubscribed, true);
});

for (const [name, change] of [
  [
    "duplicate Salesforce contacts",
    (s: any) => {
      s.duplicate = true;
    },
  ],
  [
    "missing Salesforce contact",
    (s: any) => {
      s.sf = null;
    },
  ],
  [
    "local complaint block",
    (s: any) => {
      s.block.kind = "complaint";
    },
  ],
  [
    "Resend delivery suppression",
    (s: any) => {
      s.providerBlock = true;
    },
  ],
  [
    "newer Salesforce modification",
    (s: any) => {
      s.sf.LastModifiedDate = new Date().toISOString();
    },
  ],
  [
    "unconfirmed baseline",
    (s: any) => {
      s.sync.baselineConfirmedAt = null;
    },
  ],
  [
    "legacy writeback still enabled",
    (s: any) => {
      s.legacy = { enabled: true };
    },
  ],
  [
    "newer legacy unsubscribe",
    (s: any) => {
      s.legacyEvents.push({
        email: s.block.email,
        optOutAt: new Date(),
        discoveredAt: new Date(),
      });
    },
  ],
] as const) {
  test(`${name} prevents provider opt-in writes`, async (t) => {
    const { state, create, writes } = setup(t);
    change(state);
    assert.equal((await create()).status, "needs_review");
    assert.ok(state.block);
    assert.equal(writes().length, 0);
  });
}

test("an unsubscribe arriving during reconciliation wins even when the row already exists", async (t) => {
  const { state, input, create, writes } = setup(t);
  state.hook = (path: string, method: string) => {
    if (path.includes("/sobjects/") && method === "PATCH")
      state.block.revision++;
  };
  assert.equal((await create()).status, "needs_review");
  assert.ok(state.block);
  assert.equal(writes().length, 1);
  assert.equal(state.contact.unsubscribed, true);
  assert.equal(
    (await verifyMarketingResubscription(input.id)).status,
    "needs_review",
  );
});

test("an unsubscribe between the final check and delete cannot be cleared", async (t) => {
  const { state, create } = setup(t);
  state.finalRace = true;
  assert.equal((await create()).status, "needs_review");
  assert.ok(state.block);
});

test("a changed provider identity prevents release after a partial result", async (t) => {
  const { state, input, create } = setup(t);
  state.resendFailure = true;
  await create();
  state.contact.id = "replacement-contact";
  assert.equal(
    (await verifyMarketingResubscription(input.id)).status,
    "needs_review",
  );
  assert.ok(state.block);
  process.env.RESEND_API_KEY = "different-key";
  const result = await verifyMarketingResubscription(input.id);
  assert.equal(result.status, "needs_review");
  assert.match(result.error!, /key changed/);
});

test("contacts removed by retention are recreated blocked before explicit opt-in", async (t) => {
  const { state, create, writes } = setup(t);
  state.contact = null;
  assert.equal((await create()).status, "completed");
  assert.equal(state.block, null);
  assert.equal(writes()[0].body.unsubscribed, true);
  assert.equal(writes().length, 3);
});

test("an old consent request cannot be reused for a later unsubscribe", async (t) => {
  const { state, input, create } = setup(t);
  await create();
  state.block = {
    email: input.email,
    kind: "global_unsubscribe",
    source: "resend",
    revision: 0,
    createdAt: new Date(),
  };
  await assert.rejects(
    createMarketingResubscription({ ...input, id: randomUUID() }, "staff-1"),
    /already used/,
  );
  assert.ok(state.block);
  assert.equal(
    (await verifyMarketingResubscription(input.id)).status,
    "completed",
  );
  assert.ok(state.block);
});

test("active sync and cleanup leases prevent overlapping resubscription work", async (t) => {
  const { state, create, writes } = setup(t);
  state.sync.leaseUntil = new Date(Date.now() + 60000);
  await assert.rejects(create(), /sync is busy/);
  state.sync.leaseUntil = null;
  state.workspace.resendCleanupLeaseUntil = new Date(Date.now() + 60000);
  await assert.rejects(create(), /cleanup is busy/);
  assert.equal(state.sync.leaseUntil, null);
  assert.equal(state.jobs.length, 0);
  assert.equal(writes().length, 0);
});

test("invalid evidence, future consent and narrower scope are rejected", () => {
  const base = {
    id: randomUUID(),
    email: "p@example.org",
    consentAt: new Date(Date.now() - 1000).toISOString(),
    source: "Email",
    evidence: "Explicit consent in ticket 1",
    scope: "all_workspace_marketing",
    confirmed: true,
  };
  for (const patch of [
    { email: "invalid" },
    { consentAt: new Date(Date.now() + 60000).toISOString() },
    { evidence: "" },
    { confirmed: false },
    { scope: "one_brand" },
  ])
    assert.equal(
      marketingResubscriptionInput.safeParse({ ...base, ...patch }).success,
      false,
    );
});

test("a later explicit request can restore consent after a second unsubscribe", async (t) => {
  const { state, input, create, writes } = setup(t);
  assert.equal((await create()).status, "completed");
  // Place the earlier completed request and second opt-out in the past.
  state.jobs[0].createdAt = new Date(Date.now() - 120000);
  state.block = {
    email: input.email,
    kind: "global_unsubscribe",
    source: "resend",
    revision: 1,
    createdAt: new Date(Date.now() - 60000),
    occurredAt: new Date(Date.now() - 60000),
  };
  state.contact.unsubscribed = true;
  state.sf.HasOptedOutOfEmail = true;
  state.sf.LastModifiedDate = new Date(Date.now() - 60000).toISOString();
  const next = {
    ...input,
    id: randomUUID(),
    consentAt: new Date(Date.now() - 1000),
  };
  const result = await createMarketingResubscription(next, "staff-2");
  assert.equal(result.status, "completed");
  assert.equal(state.jobs.length, 2);
  assert.equal(state.block, null);
  assert.equal(writes().length, 4);
});

test("provider flags already clear still require audited evidence but need no writes", async (t) => {
  const { state, create, writes } = setup(t);
  state.sf.HasOptedOutOfEmail = false;
  state.contact.unsubscribed = false;
  assert.equal((await create()).status, "completed");
  assert.equal(writes().length, 0);
});

test("newer unsubscribe events, account changes and lease loss during provider work keep the block", async (t) => {
  const { state, create } = setup(t);
  state.hook = (path: string) => {
    if (path.startsWith("/suppressions/")) {
      state.events.push({
        email: state.block.email,
        direction: "resend_to_forcemultiplier",
        occurredAt: new Date(),
        recordedAt: new Date(),
      });
      state.account.externalId = "other-org";
      state.sync.leaseUntil = new Date(Date.now() + 99999);
    }
  };
  assert.equal((await create()).status, "needs_review");
  assert.ok(state.block);
  assert.ok(state.sync.leaseUntil); // A previous owner must not release the new owner's lease.
});

test("preflight failures can resume with the original evidence; attempted writes cannot", async (t) => {
  const { state, input, create, writes } = setup(t);
  state.providerBlock = true;
  const held = await create();
  assert.equal(held.status, "needs_review");
  assert.equal(held.writeStartedAt, undefined);
  state.providerBlock = false;
  assert.equal(
    (await retryMarketingResubscription(input.id)).status,
    "completed",
  );
  assert.equal(state.jobs.length, 1);
  assert.equal(writes().length, 2);
  await assert.rejects(
    retryMarketingResubscription(input.id),
    /may already have happened/,
  );
});

test("an ambiguous write is never repeated through the preflight retry endpoint", async (t) => {
  const { state, input, create, writes } = setup(t);
  state.resendFailure = true;
  assert.equal((await create()).status, "needs_review");
  await assert.rejects(
    retryMarketingResubscription(input.id),
    /may already have happened/,
  );
  assert.equal(writes().length, 2);
  assert.ok(state.block);
});

test("an idempotency key cannot be reused for different consent evidence", async (t) => {
  const { input, create } = setup(t);
  await create();
  await assert.rejects(
    createMarketingResubscription(
      { ...input, evidence: "Different consent evidence" },
      "staff-1",
    ),
    /different consent/,
  );
});
