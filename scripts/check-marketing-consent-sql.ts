// Isolated PostgreSQL checks. See docs/marketing-resubscriptions.md for invocation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { recipientIsEligible } from "../lib/campaign-sends";

const modulePath = process.env.PGLITE_MODULE;
if (!modulePath)
  throw new Error(
    "Set PGLITE_MODULE to a separately installed @electric-sql/pglite entry point.",
  );
const { PGlite } = await import(modulePath);
const pg = await PGlite.create(); // Memory only: never connects to the workspace database.
try {
  const schema = execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ],
    { encoding: "utf8" },
  );
  assert.ok(
    schema.includes('"MarketingResubscription"'),
    "Prisma must emit the current schema",
  );
  await pg.exec(
    'CREATE SCHEMA IF NOT EXISTS "forcemultiplier"; SET search_path TO "forcemultiplier";',
  );
  await pg.exec(schema);
  // Reconstruct the preceding schema and apply the exact new migration.
  await pg.exec(`DROP TABLE "forcemultiplier"."MarketingResubscription";
    ALTER TABLE "forcemultiplier"."Suppression" DROP COLUMN revision;
    ALTER TABLE "forcemultiplier"."SuppressionEvent" DROP COLUMN "suppressionRevision";`);
  await pg.exec(
    readFileSync(
      "prisma/migrations/202610060002_marketing_resubscriptions/migration.sql",
      "utf8",
    ),
  );
  // Fixture rows intentionally omit unrelated campaign/audience parents.
  await pg.exec("SET session_replication_role = replica");
  async function insert(table: string, data: Record<string, unknown>) {
    const keys = Object.keys(data);
    await pg.query(
      `INSERT INTO "forcemultiplier"."${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(data),
    );
  }
  function template(file: string, after: string) {
    const source = readFileSync(file, "utf8").split(after)[1];
    return source.split("Prisma.sql`")[1].split("`);")[0];
  }
  const queueSql = template(
    "lib/suppressions.ts",
    "async function queueOutbound",
  )
    .replaceAll("${orgId}", "$1")
    .replaceAll("${TO_SALESFORCE}", "$2");
  const queue = async () =>
    (await pg.query(queueSql, ["org-1", "forcemultiplier_to_salesforce"])).rows;
  const countSql = template(
    "lib/campaign-sends.ts",
    "export async function newlySuppressedCount",
  ).replaceAll("${sendId}", "$1");
  const count = async () =>
    Number((await pg.query(countSql, ["send-1"])).rows[0].count);
  const source = readFileSync("lib/campaign-sends.ts", "utf8").split(
    "async function recipientRows",
  )[1];
  const audienceSql = source
    .split("return db.$queryRaw<RecipientRow[]>(Prisma.sql`")[1]
    .split("`);")[0]
    .replaceAll("${fieldMatch}", "FALSE")
    .replaceAll("${Prisma.join(includeRunIds)}", "$1")
    .replaceAll("${excludedRuns}", "AND FALSE")
    .replaceAll("${manualMatch}", "FALSE");
  const audience = async () => (await pg.query(audienceSql, ["run-1"])).rows[0];
  const email = "person@example.org";
  const first = new Date("2026-10-01T00:00:00Z");
  const consentAt = new Date("2026-10-02T00:00:00Z");
  const observed = new Date("2026-10-03T00:00:00Z");
  const job = {
    id: randomUUID(),
    email,
    orgId: "org-1",
    consentAt,
    source: "Email",
    evidence: "Explicit request in ticket",
    createdBy: "staff",
    createdAt: observed,
    resendKeyHash: "test",
    suppressionRevision: 0,
  };
  await insert("Suppression", { email, source: "resend", createdAt: first });
  assert.equal((await queue()).length, 1, "first opt-out queues");
  await insert("SuppressionEvent", {
    id: "out-1",
    dedupeKey: "out-1",
    orgId: "org-1",
    email,
    direction: "forcemultiplier_to_salesforce",
    source: "resend",
    status: "written",
    suppressionRevision: 0,
    recordedAt: consentAt,
  });
  assert.equal((await queue()).length, 0, "same revision does not repeat");
  await pg.exec(`DELETE FROM "forcemultiplier"."SuppressionEvent"`);
  await insert("MarketingResubscription", job);
  assert.equal(
    (await queue()).length,
    0,
    "pending consent holds the old opt-out write",
  );
  await pg.exec(`UPDATE "forcemultiplier"."Suppression" SET revision = 1`);
  assert.equal(
    (await queue()).length,
    1,
    "a newer unsubscribe escapes the old consent hold",
  );
  await insert("SuppressionEvent", {
    id: "out-2",
    dedupeKey: "out-2",
    orgId: "org-1",
    email,
    direction: "forcemultiplier_to_salesforce",
    source: "resend",
    suppressionRevision: 1,
    recordedAt: observed,
  });
  assert.equal((await queue()).length, 0, "second revision deduplicates");
  await pg.exec(
    `UPDATE "forcemultiplier"."MarketingResubscription" SET status = 'completed', "completedAt" = '2026-10-03'; DELETE FROM "forcemultiplier"."Suppression";`,
  );
  await insert("Suppression", {
    email,
    source: "resend",
    createdAt: new Date("2026-10-04T00:00:00Z"),
  });
  assert.equal(
    (await queue()).length,
    1,
    "unsubscribe after successful resubscription queues again",
  );
  await pg.exec(
    `DELETE FROM "forcemultiplier"."Suppression"; DELETE FROM "forcemultiplier"."MarketingResubscription";`,
  );
  await insert("CampaignRecipient", {
    sendId: "send-1",
    email,
    updatedAt: first,
  });
  await insert("UnsubscribeEvent", {
    accountId: "cc",
    orgId: "org-1",
    contactId: "legacy-1",
    email,
    optOutAt: first,
    discoveredAt: first,
  });
  assert.equal(await count(), 1, "legacy opt-out blocks by default");
  await insert("MarketingResubscription", {
    ...job,
    status: "completed",
    completedAt: observed,
  });
  assert.equal(
    await count(),
    0,
    "verified consent supersedes older legacy history without deleting it",
  );
  await insert("AudienceMember", {
    runId: "run-1",
    salesforceId: "003000000000000001",
    email,
    normalizedEmail: email,
    optedOut: true,
    data: {},
  });
  assert.equal(
    recipientIsEligible(await audience(), false),
    false,
    "old opted-out snapshot stays excluded",
  );
  await pg.exec(
    `UPDATE "forcemultiplier"."AudienceMember" SET "optedOut" = false`,
  );
  assert.equal(
    recipientIsEligible(await audience(), false),
    true,
    "fresh opted-in snapshot can be eligible",
  );
  await insert("Suppression", { email, source: "resend", kind: "complaint" });
  assert.equal(
    await count(),
    1,
    "local delivery block wins over completed consent",
  );
  assert.equal(recipientIsEligible(await audience(), false), false);
  assert.equal(recipientIsEligible(await audience(), true), false);
  await pg.exec(
    `DELETE FROM "forcemultiplier"."Suppression"; UPDATE "forcemultiplier"."UnsubscribeEvent" SET "optOutAt" = '2026-10-04';`,
  );
  assert.equal(await count(), 1, "newer legacy unsubscribe wins");
  await pg.exec(
    `UPDATE "forcemultiplier"."UnsubscribeEvent" SET "optOutAt" = '2026-10-01', "discoveredAt" = '2026-10-04';`,
  );
  assert.equal(
    await count(),
    1,
    "late-discovered legacy history stays blocked for review",
  );
  console.log(
    "PASS: migration, repeated opt-out queueing, legacy history, snapshot eligibility, and delivery blocks (isolated PostgreSQL).",
  );
} finally {
  await pg.close();
}
