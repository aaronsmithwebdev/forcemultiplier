// Run with a temporary PGlite install; no database credentials or production writes.
// npm install --prefix /tmp/forcemultiplier-db-check @electric-sql/pglite --no-package-lock --ignore-scripts
// node --import tsx scripts/check-people-migration.mjs /tmp/forcemultiplier-db-check/node_modules/@electric-sql/pglite/dist/index.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { db as appDb } from "../lib/db.ts";
import { saveSalesforcePeople, sourcePeople } from "../lib/people.ts";
import { recipientRows, newlySuppressedCount } from "../lib/campaign-sends.ts";
import { pathToFileURL } from "node:url";
if (!process.argv[2])
  throw new Error(
    "Pass the absolute path to a temporary PGlite module (see script comments).",
  );
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec(`
    CREATE SCHEMA forcemultiplier;
    CREATE TABLE forcemultiplier."Audience"(id text PRIMARY KEY,"orgId" text);
    CREATE TABLE forcemultiplier."PullRun"(id text PRIMARY KEY,"orgId" text,"createdAt" timestamp DEFAULT NOW(),query text,status text,error text,"leaseUntil" timestamp);
    CREATE TABLE forcemultiplier."AudienceMember"("runId" text,"salesforceId" text NOT NULL,email text,"normalizedEmail" text,name text,data jsonb,"optedOut" boolean DEFAULT false,PRIMARY KEY("runId","salesforceId"));
    CREATE TABLE forcemultiplier."ManualAudienceMember"("audienceId" text,email text,PRIMARY KEY("audienceId",email));
    CREATE TABLE forcemultiplier."CampaignRecipient"("sendId" text,email text,"salesforceId" text);
    CREATE TABLE forcemultiplier."CampaignSend"(id text,"includeRunIds" text[]);
    CREATE TABLE forcemultiplier."ContactMirror"("orgId" text,"salesforceId" text,"normalizedEmail" text,"firstName" text,"lastName" text,"optedOut" boolean,"observedAt" timestamp);
    CREATE TABLE forcemultiplier."FunraisinSync"("orgId" text);
    CREATE TABLE forcemultiplier."FunraisinParticipant"("memberId" text,"salesforceId" text NOT NULL,email text,"firstName" text,name text);
    CREATE TABLE forcemultiplier."FunraisinDonation"("donationId" text,"salesforceId" text NOT NULL,email text,name text);
    INSERT INTO forcemultiplier."Audience" VALUES ('a','org'),('b','other-org');
    INSERT INTO forcemultiplier."PullRun"(id,"orgId") VALUES ('run','org'),('other-run','other-org');
    INSERT INTO forcemultiplier."AudienceMember"("runId","salesforceId",email,"normalizedEmail",data) VALUES
      ('run','003000000000000001','shared@example.org','shared@example.org','{"FirstName":"CRM"}'),
      ('run','003000000000000002','shared@example.org','shared@example.org','{}'),
      ('run','manual:local@example.org','local@example.org','local@example.org','{}'),
      ('other-run','003000000000000001','shared@example.org','shared@example.org','{}');
    INSERT INTO forcemultiplier."ManualAudienceMember" VALUES ('a','local@example.org');
    INSERT INTO forcemultiplier."CampaignSend" VALUES ('send',ARRAY['run']);
    INSERT INTO forcemultiplier."CampaignRecipient" VALUES ('send','shared@example.org','003000000000000001'),('send','local@example.org','manual:local@example.org');
    INSERT INTO forcemultiplier."FunraisinSync" VALUES ('org');
    INSERT INTO forcemultiplier."FunraisinParticipant" VALUES ('participant','003000000000000001','shared@example.org','CRM','CRM');
    INSERT INTO forcemultiplier."FunraisinDonation" VALUES ('donation','003000000000000001','shared@example.org','CRM');
  `);
  await db.exec(
    await readFile(
      new URL(
        "../prisma/migrations/202611020001_people_and_audience_imports/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const { rows: people } = await db.query(
    'SELECT * FROM forcemultiplier."Person"',
  );
  assert.equal(
    people.length,
    4,
    "same email or Contact ID in another org must not merge people",
  );
  const local = people.find((p) => p.email === "local@example.org");
  assert.equal(local.salesforceId, null);
  const { rows: members } = await db.query(
    'SELECT * FROM forcemultiplier."AudienceMember"',
  );
  assert.equal(members.length, 4);
  assert.equal(members.find((m) => m.email === local.email).personId, local.id);
  assert.equal(members.find((m) => m.email === local.email).salesforceId, null);
  const { rows: recipients } = await db.query(
    'SELECT * FROM forcemultiplier."CampaignRecipient"',
  );
  assert.ok(recipients.every((r) => r.personId));
  assert.equal(
    recipients.find((r) => r.email === local.email).personId,
    local.id,
  );
  const { rows: sources } = await db.query(
    'SELECT * FROM forcemultiplier."PersonSource"',
  );
  assert.equal(sources.length, 2);
  assert.ok(
    sources.every(
      (s) =>
        s.personId ===
        members.find(
          (m) => m.runId === "run" && m.salesforceId === "003000000000000001",
        ).personId,
    ),
  );
  const { rows: privateTables } = await db.query(
    `SELECT relname FROM pg_class WHERE relnamespace='forcemultiplier'::regnamespace AND relrowsecurity`,
  );
  for (const name of [
    "Person",
    "PersonSource",
    "PersonEmail",
    "AudienceImport",
    "ManualAudienceMember",
  ])
    assert.ok(privateTables.some((t) => t.relname === name));
  await assert.rejects(
    db.exec(
      `INSERT INTO forcemultiplier."Person"(id,"orgId","salesforceId",source,"updatedAt") VALUES ('duplicate','org','003000000000000001','salesforce',NOW())`,
    ),
    /duplicate key/,
  );
  await db.exec(`
    CREATE TABLE forcemultiplier."Suppression" (email text,kind text,"occurredAt" timestamp,"createdAt" timestamp DEFAULT NOW());
    CREATE TABLE forcemultiplier."UnsubscribeEvent" (email text,"optOutAt" timestamp,"discoveredAt" timestamp);
    CREATE TABLE forcemultiplier."MarketingResubscription" (email text,status text,"consentAt" timestamp,"createdAt" timestamp);
    INSERT INTO forcemultiplier."Suppression"(email,kind) VALUES ('old@example.org','global_unsubscribe');
    INSERT INTO forcemultiplier."PersonEmail"("personId",email) VALUES ('${local.id}','old@example.org');
  `);
  const insert = async (table, { data, skipDuplicates }) => {
    if (!data.length) return { count: 0 };
    const columns = Object.keys(data[0]);
    const parameters = [];
    const tuples = data.map(
      (row) =>
        "(" +
        columns
          .map((column) => {
            parameters.push(row[column] ?? null);
            return "$" + parameters.length;
          })
          .join(",") +
        ")",
    );
    await db.query(
      `INSERT INTO forcemultiplier."${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES ${tuples.join(",")} ${skipDuplicates ? "ON CONFLICT DO NOTHING" : ""}`,
      parameters,
    );
    return { count: data.length };
  };
  const identityStore = {
    $queryRaw: async (sql) => (await db.query(sql.text, sql.values)).rows,
    $executeRaw: async (sql) =>
      (await db.query(sql.text, sql.values)).affectedRows,
    personEmail: { createMany: (args) => insert("PersonEmail", args) },
    person: {
      findMany: async () =>
        (
          await db.query(
            `SELECT * FROM forcemultiplier."Person" WHERE "orgId"='org' AND "mergedIntoId" IS NULL`,
          )
        ).rows,
      createMany: (args) => insert("Person", args),
    },
    personSource: {
      findMany: async ({ where }) =>
        (
          await db.query(
            `SELECT s.*,row_to_json(p) AS person FROM forcemultiplier."PersonSource" s JOIN forcemultiplier."Person" p ON p.id=s."personId" WHERE s."orgId"=$1 AND s.source=$2`,
            [where.orgId, where.source],
          )
        ).rows,
      createMany: (args) => insert("PersonSource", args),
    },
  };
  const crmRecord = {
    Id: "003000000000000003",
    Email: "fresh@example.org",
    FirstName: "CRM",
    LastName: "Profile",
    HasOptedOutOfEmail: false,
  };
  const [firstCRM] = await saveSalesforcePeople(
    "org",
    [crmRecord],
    identityStore,
  );
  const [updatedCRM] = await saveSalesforcePeople(
    "org",
    [{ ...crmRecord, FirstName: "Updated" }],
    identityStore,
  );
  assert.equal(
    firstCRM.id,
    updatedCRM.id,
    "Salesforce profile updates retain internal identity",
  );
  const crmSource = await sourcePeople(
    identityStore,
    "org",
    "funraisin-donation",
    [
      {
        id: "crm-donation",
        salesforceId: crmRecord.Id,
        email: crmRecord.Email,
        firstName: "Source must not overwrite CRM",
      },
    ],
  );
  assert.equal(crmSource.get("crm-donation"), firstCRM.id);
  const {
    rows: [ownedCRM],
  } = await db.query(`SELECT * FROM forcemultiplier."Person" WHERE id=$1`, [
    firstCRM.id,
  ]);
  assert.equal(
    ownedCRM.firstName,
    "Updated",
    "Funraisin must preserve Salesforce-owned profile fields",
  );
  const sourceRows = [
    {
      id: "first-local-donation",
      email: "donor@example.org",
      firstName: "Local",
      lastName: "Donor",
    },
    {
      id: "second-local-donation",
      email: "donor@example.org",
      firstName: "Local",
      lastName: "Donor",
    },
  ];
  const donorIds = await sourcePeople(
    identityStore,
    "org",
    "funraisin-donation",
    sourceRows,
  );
  assert.equal(donorIds.get(sourceRows[0].id), donorIds.get(sourceRows[1].id));
  const repeatIds = await sourcePeople(
    identityStore,
    "org",
    "funraisin-donation",
    [{ ...sourceRows[0], email: "changed@example.org", firstName: "Changed" }],
  );
  assert.equal(
    repeatIds.get(sourceRows[0].id),
    donorIds.get(sourceRows[0].id),
    "source IDs survive email changes",
  );
  const {
    rows: [donor],
  } = await db.query(`SELECT * FROM forcemultiplier."Person" WHERE id=$1`, [
    donorIds.get(sourceRows[0].id),
  ]);
  assert.equal(donor.email, "changed@example.org");
  assert.equal(donor.firstName, "Changed");
  assert.equal(donor.lastName, "Donor");
  assert.equal(donor.salesforceId, null);
  const originalQuery = appDb.$queryRaw;
  appDb.$queryRaw = async (sql) => (await db.query(sql.text, sql.values)).rows;
  try {
    const rows = await recipientRows(["run"], [], [], {
      conjunction: "AND",
      items: [],
    });
    assert.equal(rows.length, 2, "delivery deduplicates email addresses");
    assert.equal(
      rows.find((r) => r.email === local.email).suppressed,
      true,
      "historical local suppression survives identity linking and email changes",
    );
    await db.exec(
      `INSERT INTO forcemultiplier."MarketingResubscription" VALUES ('local@example.org','completed',NOW()+INTERVAL '1 minute',NOW()+INTERVAL '1 minute')`,
    );
    const after = await recipientRows(["run"], [], [], {
      conjunction: "AND",
      items: [],
    });
    assert.equal(
      after.find((r) => r.email === local.email).suppressed,
      false,
      "later explicit workspace resubscription can supersede the older block",
    );
    await db.exec(
      `UPDATE forcemultiplier."Person" SET unavailable=true WHERE id='${local.id}'; UPDATE forcemultiplier."CampaignRecipient" SET "personId"='${local.id}' WHERE email='local@example.org';`,
    );
    const blocked = await recipientRows(["run"], [], [], {
      conjunction: "AND",
      items: [],
    });
    assert.equal(
      blocked.find((r) => r.email === local.email).fieldExcluded,
      true,
      "deleted or excluded Salesforce records stay blocked",
    );
    assert.equal(
      await newlySuppressedCount("send"),
      1,
      "a newly unavailable identity blocks a prepared campaign",
    );
  } finally {
    appDb.$queryRaw = originalQuery;
  }
  console.log(
    "Person migration and sending SQL passed: org isolation, shared-email separation, manual identities, memberships, campaign history, Funraisin identities, uniqueness and RLS.",
  );
} finally {
  await db.close();
}
