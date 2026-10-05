import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createParagraphBlock } from "@templatical/types";
import { db } from "../lib/db";
import { marketingConsentReadiness } from "../lib/consent-readiness";
import { campaignSendStep, startCampaignSend } from "../lib/campaign-sends";
import { confirmConsentBaseline } from "../lib/suppressions";

const now = Date.parse("2026-10-06T03:00:00Z");
function mock(t: TestContext, target: any, name: string, fn: any) {
  const original = target[name];
  target[name] = fn;
  t.after(() => {
    target[name] = original;
  });
}

function setup(t: TestContext) {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.CRON_SECRET = "test-cron";
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from("review-only-signing-key").toString("base64")}`;
  process.env.RESEND_API_KEY = "test-resend";
  mock(t, Date, "now", () => now);
  mock(t, globalThis, "fetch", () => {
    throw new Error("Unexpected provider call");
  });
  const sync = {
    enabled: true,
    orgId: "org-1",
    baselineConfirmedAt: new Date(now - 86400000),
    cursor: new Date(now - 300000),
    lastCompletedAt: new Date(now - 299000),
    scanCursor: null,
    error: null,
  };
  const account = { externalId: "org-1", tokens: "encrypted-test" };
  const runs = [
    { orgId: "org-1", status: "completed", audience: { sourceType: "soql" } },
  ];
  mock(t, db.salesforceSuppressionSync, "findUnique", async () => sync);
  mock(t, db.connection, "findUnique", async () => account);
  mock(t, db.pullRun, "findMany", async ({ select }: any) => {
    assert.equal(select.members, undefined);
    assert.equal(select.finishedAt, undefined);
    return runs;
  });
  return { sync, account, runs };
}

test("readiness uses completed consent coverage, not audience age or a running scan", async (t) => {
  const { sync } = setup(t);
  Object.assign(sync, { scanCursor: "/query/next-page" });
  assert.equal(
    (await marketingConsentReadiness(["old-run", "old-run"])).ready,
    true,
  );
  sync.cursor = new Date(now - 15 * 60000);
  assert.equal((await marketingConsentReadiness(["old-run"])).ready, true);
  sync.cursor = new Date(now - 15 * 60000 - 1);
  sync.lastCompletedAt = new Date(now); // Finishing an old baseline is not fresh coverage.
  assert.match(
    (await marketingConsentReadiness(["old-run"])).reason!,
    /15 minutes/,
  );
});

test("readiness blocks incomplete, unhealthy or unverified consent sources", async (t) => {
  const { sync, account, runs } = setup(t);
  const cases = [
    [sync, "enabled", false, /Enable Salesforce/],
    [sync, "baselineConfirmedAt", null, /Confirm the historical/],
    [sync, "cursor", null, /first complete/],
    [sync, "lastCompletedAt", null, /first complete/],
    [sync, "error", "provider failed", /sync error/],
    [sync, "cursor", new Date(now + 1), /clock/],
    [sync, "orgId", "old-org", /connected org/],
    [account, "tokens", null, /Connect Salesforce/],
    [account, "externalId", null, /Connect Salesforce/],
    [process.env, "CRON_SECRET", "", /scheduled/],
    [process.env, "RESEND_WEBHOOK_SECRET", "", /webhook/],
    [process.env, "RESEND_WEBHOOK_SECRET", "whsec_bad", /webhook/],
    [runs[0], "orgId", "other-org", /Selected snapshots/],
    [runs[0], "status", "running", /Selected snapshots/],
    [runs[0].audience, "sourceType", "funraisin", /Other sources/],
  ] as const;
  for (const [target, key, value, expected] of cases) {
    const object = target as any;
    const original = object[key];
    object[key] = value;
    assert.match(
      (await marketingConsentReadiness(["run-1"])).reason!,
      expected,
    );
    object[key] = original;
  }
  assert.equal((await marketingConsentReadiness([])).ready, false);
  runs.length = 0;
  assert.equal((await marketingConsentReadiness(["missing"])).ready, false);
  mock(t, db.salesforceSuppressionSync, "findUnique", async () => null);
  assert.equal((await marketingConsentReadiness()).ready, false);
});

const content = {
  blocks: [createParagraphBlock({ content: "<p>Test content</p>" })],
  settings: {
    width: 600,
    backgroundColor: "#ffffff",
    textColor: "#000000",
    linkUnderline: true,
    fontFamily: "Arial",
    locale: "en",
  },
};

test("initial marketing submission is rejected before provider calls or job creation", async (t) => {
  const { sync } = setup(t);
  sync.enabled = false;
  mock(t, db.campaign, "findUnique", async () => ({
    id: "campaign-1",
    audienceIds: ["audience-1"],
    exclusionAudienceIds: [],
    subject: "Test",
    fromName: "Test",
    fromEmail: "test@example.org",
    replyToEmail: "test@example.org",
    footer: { content },
    serviceNotice: false,
  }));
  mock(t, db.audience, "findMany", async () => [
    { id: "audience-1", runs: [{ id: "run-1" }] },
  ]);
  mock(t, db.campaignSend, "create", async () => {
    assert.fail("Unready campaign was queued");
  });
  await assert.rejects(
    startCampaignSend("campaign-1", "user-1"),
    /Enable Salesforce/,
  );
});

function sending(t: TestContext, status: string, serviceNotice = false) {
  const send = {
    id: "send-1",
    campaignId: "campaign-1",
    status,
    serviceNotice,
    includeRunIds: ["run-1"],
    excludeRunIds: [],
    manualExclusions: [],
    exclusionRules: { conjunction: "AND", items: [] },
    broadcastId: "broadcast-1",
    importId: "import-1",
    segmentId: "segment-1",
    leaseUntil: null,
    error: null,
    content,
    footerContent: content,
    subject: "Test",
    fromName: "Test",
    fromEmail: "test@example.org",
  };
  mock(t, db.campaignSend, "findUnique", async () => send);
  mock(t, db.campaignSend, "updateMany", async ({ data }: any) => {
    Object.assign(send, data);
    return { count: 1 };
  });
  mock(t, db.campaignSend, "update", async ({ data }: any) => {
    Object.assign(send, data);
    return send;
  });
  mock(t, db, "$queryRaw", async () => [{ count: 0n }]);
  mock(t, db, "$transaction", async (ops: any[]) => Promise.all(ops));
  mock(t, db.campaignRecipient, "updateMany", async () => ({ count: 1 }));
  mock(t, db.campaign, "update", async () => ({}));
  return send;
}

for (const stage of ["pending", "importing", "ready"]) {
  test(`${stage} campaign waits without provider work and retains its stage`, async (t) => {
    const { sync } = setup(t);
    sync.cursor = new Date(now - 16 * 60000);
    const send = sending(t, stage);
    await campaignSendStep(send.id);
    assert.equal(send.status, stage);
    assert.match(send.error!, /Waiting for consent checks:.*15 minutes/);
    assert.equal((send.leaseUntil as unknown as Date).getTime(), now + 60000);
  });
}

test("a waiting broadcast resumes once consent is fresh and sends exactly once", async (t) => {
  const { sync } = setup(t);
  sync.enabled = false;
  const send = sending(t, "ready");
  await campaignSendStep(send.id);
  sync.enabled = true;
  mock(t, Date, "now", () => now + 61000);
  let submissions = 0;
  mock(t, globalThis, "fetch", async (url: string) => {
    assert.equal(url, "https://api.resend.com/broadcasts/broadcast-1/send");
    submissions++;
    return Response.json({ id: "broadcast-1" });
  });
  await campaignSendStep(send.id);
  await campaignSendStep(send.id);
  assert.equal(send.status, "sent");
  assert.equal(submissions, 1);
});

test("healthy marketing proceeds through import and broadcast without Salesforce calls", async (t) => {
  setup(t);
  const send = sending(t, "pending");
  Object.assign(send, { segmentId: null, importId: null, broadcastId: null });
  const recipient = {
    email: "test@example.org",
    name: "Test",
    salesforceId: "003000000000000001",
    sourceRows: 1n,
    optedOut: false,
    suppressed: false,
    deliveryBlocked: false,
    audienceExcluded: false,
    fieldExcluded: false,
    manuallyExcluded: false,
  };
  const stored: any[] = [];
  mock(t, db, "$queryRaw", async () =>
    send.status === "pending" ? [recipient] : [{ count: 0n }],
  );
  mock(t, db.campaignRecipient, "createMany", async ({ data }: any) => {
    stored.push(...data);
    return { count: data.length };
  });
  mock(t, db.campaignRecipient, "findMany", async () => stored);
  mock(t, db.campaign, "findUniqueOrThrow", async () => ({
    name: "Test campaign",
  }));
  const requests: string[] = [];
  mock(t, globalThis, "fetch", async (url: string) => {
    assert.equal(new URL(url).host, "api.resend.com");
    const path = new URL(url).pathname;
    requests.push(path);
    if (path === "/segments") return Response.json({ id: "segment-1" });
    if (path === "/contacts/imports") return Response.json({ id: "import-1" });
    if (path === "/contacts/imports/import-1")
      return Response.json({ status: "completed", counts: { failed: 0 } });
    if (path === "/broadcasts" || path === "/broadcasts/broadcast-1/send")
      return Response.json({ id: "broadcast-1" });
    assert.fail(`Unexpected request: ${path}`);
  });
  await campaignSendStep(send.id);
  assert.equal(send.status, "importing");
  await campaignSendStep(send.id);
  assert.equal(send.status, "ready");
  await campaignSendStep(send.id);
  assert.equal(send.status, "sent");
  assert.equal(stored.length, 1);
  assert.deepEqual(requests, [
    "/segments",
    "/contacts/imports",
    "/contacts/imports/import-1",
    "/broadcasts",
    "/broadcasts/broadcast-1/send",
  ]);
});

test("final consent check notices changes during the suppression query", async (t) => {
  const { sync } = setup(t);
  const send = sending(t, "ready");
  mock(t, db, "$queryRaw", async () => {
    sync.enabled = false;
    return [{ count: 0n }];
  });
  await campaignSendStep(send.id);
  assert.equal(send.status, "ready");
  assert.match(send.error!, /Waiting for consent/);
});

test("new recipient suppressions still stop the campaign after consent recovers", async (t) => {
  setup(t);
  const send = sending(t, "ready");
  mock(t, db, "$queryRaw", async () => [{ count: 1n }]);
  await campaignSendStep(send.id);
  assert.equal(send.status, "failed");
  assert.match(send.error!, /suppressed after preparation/);
});

test("consent metadata outages defer a campaign without implying provider submission", async (t) => {
  setup(t);
  const send = sending(t, "ready");
  mock(t, db.salesforceSuppressionSync, "findUnique", async () => {
    throw new Error("database unavailable");
  });
  await campaignSendStep(send.id);
  assert.equal(send.status, "ready");
  assert.match(send.error!, /Waiting for consent/);
});

test("service notices do not depend on the marketing readiness gate", async (t) => {
  setup(t);
  const send = sending(t, "sending", true);
  mock(t, db.salesforceSuppressionSync, "findUnique", async () => {
    assert.fail("Marketing consent was read");
  });
  mock(t, db.campaignRecipient, "findMany", async () => []);
  await campaignSendStep(send.id);
  assert.equal(send.status, "sent");
});

test("baseline confirmation records the actor and is bound to the connected org", async (t) => {
  setup(t);
  mock(
    t,
    db.salesforceSuppressionSync,
    "updateMany",
    async ({ where, data }: any) => {
      assert.equal(where.orgId, "org-1");
      assert.equal(where.enabled, true);
      assert.equal(data.baselineConfirmedBy, "user-1");
      assert.ok(data.baselineConfirmedAt instanceof Date);
      return { count: 1 };
    },
  );
  await confirmConsentBaseline(true, "user-1");
  mock(t, db.salesforceSuppressionSync, "updateMany", async () => ({
    count: 0,
  }));
  await assert.rejects(
    confirmConsentBaseline(true, "user-1"),
    /Enable opt-out sync/,
  );
});
