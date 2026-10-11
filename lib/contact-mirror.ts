import { randomUUID } from "node:crypto";
import { Prisma, type ContactMirrorSync } from "@prisma/client";
import { db } from "./db";
import { normalizedEmail } from "./email";
import { AppError, publicError } from "./errors";
import { connection, providerRequest, SF_VERSION } from "./providers";
import {
  CORE_CONTACT_FIELDS,
  mirrorFieldAllowed,
} from "./contact-mirror-fields";
import { describe } from "./salesforce";
import { sfId } from "./soql";

const SYNC_ID = "salesforce";
const DAY = 86_400_000;
const MINUTE = 60_000;
const LEASE = 90_000;
// ponytail: Bulk delete days above this limit require a full rebuild; add adaptive time windows if this occurs.
const MAX_DELETIONS = 2000;

type SalesforceContact = {
  Id: unknown;
  Email?: unknown;
  FirstName?: unknown;
  LastName?: unknown;
  HasOptedOutOfEmail: unknown;
  SystemModstamp: unknown;
  [field: string]: unknown;
};

function selectedFields(value: Prisma.JsonValue): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    value.some(
      (name) =>
        typeof name !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
        CORE_CONTACT_FIELDS.includes(name),
    ) ||
    new Set(value).size !== value.length
  )
    throw new AppError(
      "The Contact mirror field selection is invalid. Pause and review it.",
      409,
    );
  return value as string[];
}

export function mirrorContactRow(
  record: SalesforceContact,
  orgId: string,
  fields: string[] = [],
) {
  const stamp = new Date(String(record.SystemModstamp ?? ""));
  if (
    typeof record.Id !== "string" ||
    !sfId(record.Id) ||
    (record.Email != null &&
      (typeof record.Email !== "string" || record.Email.length > 254)) ||
    (record.FirstName != null &&
      (typeof record.FirstName !== "string" ||
        record.FirstName.length > 255)) ||
    (record.LastName != null &&
      (typeof record.LastName !== "string" || record.LastName.length > 255)) ||
    typeof record.HasOptedOutOfEmail !== "boolean" ||
    Number.isNaN(stamp.getTime())
  )
    throw new AppError(
      "Salesforce returned an invalid Contact record. The mirror did not advance.",
      502,
    );
  const email = (record.Email as string | null | undefined)?.trim() || null;
  const extraFields = Object.fromEntries(
    fields.map((name) => {
      const value = record[name];
      if (
        !Object.hasOwn(record, name) ||
        (value !== null &&
          typeof value !== "string" &&
          typeof value !== "boolean" &&
          !(typeof value === "number" && Number.isFinite(value))) ||
        (typeof value === "string" && value.length > 4096)
      )
        throw new AppError(
          "Salesforce returned an invalid selected Contact field. The mirror did not advance.",
          502,
        );
      return [name, value];
    }),
  );
  if (JSON.stringify(extraFields).length > 16_384)
    throw new AppError(
      "A selected Contact field is too large to mirror. The mirror did not advance.",
      502,
    );
  return {
    orgId,
    salesforceId: record.Id as string,
    email,
    normalizedEmail: normalizedEmail(email),
    firstName: (record.FirstName as string | null | undefined) ?? null,
    lastName: (record.LastName as string | null | undefined) ?? null,
    extraFields,
    optedOut: record.HasOptedOutOfEmail,
    systemModstamp: stamp,
  };
}

export async function contactMirrorState() {
  const row = await db.contactMirrorSync.findUnique({ where: { id: SYNC_ID } });
  // Status only. Contact addresses and provider records never leave this route.
  return row
    ? {
        enabled: row.enabled,
        orgId: row.orgId,
        phase: row.phase,
        fields: selectedFields(row.fields),
        processed: row.processed,
        total: row.total,
        lastFullCount: row.lastFullCount,
        coveredThrough: row.cursor,
        deletedThrough: row.deletedThrough,
        lastCompletedAt: row.lastCompletedAt,
        error: row.error,
        schedulerReady: Boolean(process.env.CRON_SECRET),
      }
    : {
        enabled: false,
        phase: "not_started",
        fields: [],
        schedulerReady: Boolean(process.env.CRON_SECRET),
      };
}

export async function setContactMirrorFields(fields: string[]) {
  if (
    fields.length > 30 ||
    new Set(fields).size !== fields.length ||
    fields.some((name) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
  )
    throw new AppError("Select up to 30 distinct Contact fields.");
  const account = await connection("salesforce");
  if (!account.tokens || !account.externalId)
    throw new AppError(
      "Connect Salesforce before choosing Contact fields.",
      409,
    );
  const metadata = await describe("Contact", account.externalId);
  for (const name of fields) {
    const field = metadata.fields.find((item) => item.name === name);
    if (!field || !mirrorFieldAllowed(field))
      throw new AppError(
        `Contact field ${name} cannot be mirrored. Choose a direct, non-calculated scalar field.`,
      );
  }
  const current = await db.contactMirrorSync.findUnique({
    where: { id: SYNC_ID },
  });
  if (current?.orgId && current.orgId !== account.externalId)
    throw new AppError(
      "The Salesforce org changed. Review the existing mirror first.",
      409,
    );
  if (
    current &&
    JSON.stringify(selectedFields(current.fields)) === JSON.stringify(fields)
  )
    return contactMirrorState();
  if (!current) {
    await db.contactMirrorSync.create({
      data: {
        id: SYNC_ID,
        orgId: account.externalId,
        fields,
      },
    });
  } else {
    await db.$transaction(
      async (tx) => {
        const updated = await tx.contactMirrorSync.updateMany({
          where: { id: SYNC_ID, orgId: account.externalId, enabled: false },
          data: {
            fields,
            phase: "bootstrap",
            cursor: null,
            deletedThrough: null,
            scanUntil: null,
            queryCursor: null,
            scanId: null,
            processed: 0,
            total: 0,
            lastFullCount: null,
            lastCompletedAt: null,
            dueAt: new Date(),
            error: null,
            leaseUntil: null,
          },
        });
        if (!updated.count)
          throw new AppError(
            "Pause the mirror before changing its fields.",
            409,
          );
        // shortcut: Clearing a very large mirror can exceed this transaction window; batch the purge if that occurs.
        await tx.$executeRaw`
          UPDATE "forcemultiplier"."ContactMirror"
          SET "extraFields" = '{}'::jsonb
          WHERE "orgId" = ${account.externalId} AND "extraFields" <> '{}'::jsonb
        `;
      },
      { timeout: 180_000 },
    );
  }
  return contactMirrorState();
}

export async function setContactMirrorEnabled(
  enabled: boolean,
  userId: string,
) {
  if (!enabled) {
    await db.contactMirrorSync.updateMany({
      where: { id: SYNC_ID },
      data: { enabled: false, leaseUntil: null },
    });
    return contactMirrorState();
  }
  const account = await connection("salesforce");
  if (!account.tokens || !account.externalId)
    throw new AppError(
      "Connect Salesforce before starting the Contact mirror.",
      409,
    );
  const current = await db.contactMirrorSync.findUnique({
    where: { id: SYNC_ID },
  });
  if (current?.orgId && current.orgId !== account.externalId)
    throw new AppError(
      "The Salesforce org changed. Review the existing mirror before starting a different org.",
      409,
    );
  await db.contactMirrorSync.upsert({
    where: { id: SYNC_ID },
    create: {
      id: SYNC_ID,
      enabled: true,
      orgId: account.externalId,
      enabledBy: userId,
    },
    update: {
      enabled: true,
      enabledBy: userId,
      error: null,
      leaseUntil: null,
      dueAt: new Date(),
    },
  });
  return contactMirrorState();
}

export async function rebuildContactMirror() {
  const sync = await db.contactMirrorSync.findUnique({
    where: { id: SYNC_ID },
  });
  if (!sync?.enabled || !sync.orgId)
    throw new AppError("Enable the Contact mirror first.", 409);
  const account = await connection("salesforce");
  if (!account.tokens || account.externalId !== sync.orgId)
    throw new AppError(
      "Reconnect the original Salesforce org before rebuilding.",
      409,
    );
  const updated = await db.contactMirrorSync.updateMany({
    where: {
      id: SYNC_ID,
      enabled: true,
      orgId: sync.orgId,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: {
      phase: "bootstrap",
      cursor: null,
      deletedThrough: null,
      scanUntil: null,
      queryCursor: null,
      scanId: null,
      processed: 0,
      total: 0,
      lastFullCount: null,
      error: null,
      lastCompletedAt: null,
      leaseUntil: null,
      dueAt: new Date(),
    },
  });
  if (!updated.count)
    throw new AppError(
      "The Contact mirror is busy. Rebuild after the current step finishes.",
      409,
    );
  return contactMirrorState();
}

function minute(value: Date) {
  return new Date(Math.floor(value.getTime() / MINUTE) * MINUTE);
}
function contactQuery(
  phase: string,
  cursor: Date | null,
  boundary: Date,
  fields: string[],
) {
  const lower =
    phase === "changes" && cursor
      ? ` AND SystemModstamp >= ${new Date(cursor.getTime() - 2 * MINUTE).toISOString()}`
      : "";
  return `SELECT ${[...CORE_CONTACT_FIELDS, ...fields].join(", ")} FROM Contact WHERE SystemModstamp <= ${boundary.toISOString()}${lower} ORDER BY SystemModstamp, Id`;
}

function rowValues(
  rows: ReturnType<typeof mirrorContactRow>[],
  scanId: string | null,
) {
  return Prisma.join(
    rows.map(
      (r) => Prisma.sql`(
    ${r.orgId}, ${r.salesforceId}, ${r.email}, ${r.normalizedEmail},
    ${r.firstName}, ${r.lastName}, ${JSON.stringify(r.extraFields)}::jsonb, ${r.optedOut}, ${r.systemModstamp}, NOW(), NULL, ${scanId}
  )`,
    ),
  );
}

async function saveContactPage(
  sync: ContactMirrorSync,
  lease: Date,
  boundary: Date,
) {
  const scanId =
    sync.phase === "bootstrap" ? (sync.scanId ?? randomUUID()) : null;
  const fields = selectedFields(sync.fields);
  const path =
    sync.queryCursor ||
    `/services/data/${SF_VERSION}/query?q=${encodeURIComponent(contactQuery(sync.phase, sync.cursor, boundary, fields))}`;
  const page = await providerRequest(
    "salesforce",
    path,
    { headers: { "Sforce-Query-Options": "batchSize=2000" } },
    { externalId: sync.orgId!, timeoutMs: 25000 },
  );
  if (
    !Array.isArray(page?.records) ||
    typeof page.done !== "boolean" ||
    (!page.done &&
      (typeof page.nextRecordsUrl !== "string" ||
        !page.nextRecordsUrl.startsWith(
          `/services/data/${SF_VERSION}/query/`,
        ) ||
        page.nextRecordsUrl === path)) ||
    !Number.isSafeInteger(page.totalSize) ||
    page.totalSize < 0
  )
    throw new AppError(
      "Salesforce returned an incomplete Contact page. The mirror did not advance.",
      502,
    );
  const rows = page.records.map((record: SalesforceContact) =>
    mirrorContactRow(record, sync.orgId!, fields),
  );
  if (
    rows.some(
      (row: ReturnType<typeof mirrorContactRow>) =>
        row.systemModstamp > boundary,
    )
  )
    throw new AppError(
      "Salesforce returned Contacts beyond the mirror boundary.",
      502,
    );
  const processed = sync.processed + rows.length;
  if (processed > page.totalSize || (page.done && processed !== page.totalSize))
    throw new AppError(
      "The Contact page count changed during extraction. Restart the mirror scan.",
      409,
    );
  await db.$transaction(async (tx) => {
    const owner = await tx.contactMirrorSync.updateMany({
      where: {
        id: SYNC_ID,
        enabled: true,
        orgId: sync.orgId,
        leaseUntil: lease,
      },
      data: page.done
        ? sync.phase === "bootstrap"
          ? {
              phase: "changes",
              cursor: boundary,
              deletedThrough: boundary,
              scanUntil: null,
              queryCursor: null,
              scanId: null,
              processed: 0,
              total: 0,
              lastFullCount: processed,
              error: null,
              leaseUntil: null,
            }
          : {
              phase: "deletions",
              cursor: boundary,
              scanUntil: boundary,
              queryCursor: null,
              processed: 0,
              total: 0,
              error: null,
              leaseUntil: null,
            }
        : {
            scanUntil: boundary,
            queryCursor: page.nextRecordsUrl,
            scanId,
            processed,
            total: page.totalSize,
            error: null,
            leaseUntil: null,
          },
    });
    if (!owner.count || lease.getTime() <= Date.now())
      throw new AppError(
        "The Contact mirror lease expired. Retry this page.",
        409,
      );
    for (let offset = 0; offset < rows.length; offset += 250)
      await tx.$executeRaw(Prisma.sql`
      INSERT INTO "forcemultiplier"."ContactMirror" (
        "orgId", "salesforceId", email, "normalizedEmail", "firstName", "lastName",
        "extraFields", "optedOut", "systemModstamp", "observedAt", "deletedAt", "lastSeenScan"
      ) VALUES ${rowValues(rows.slice(offset, offset + 250), scanId)}
      ON CONFLICT ("orgId", "salesforceId") DO UPDATE SET
        email = EXCLUDED.email, "normalizedEmail" = EXCLUDED."normalizedEmail",
        "firstName" = EXCLUDED."firstName", "lastName" = EXCLUDED."lastName",
        "extraFields" = EXCLUDED."extraFields",
        "optedOut" = EXCLUDED."optedOut", "systemModstamp" = EXCLUDED."systemModstamp",
        "observedAt" = EXCLUDED."observedAt", "deletedAt" = NULL,
        "lastSeenScan" = COALESCE(EXCLUDED."lastSeenScan", "ContactMirror"."lastSeenScan")
      WHERE EXCLUDED."systemModstamp" >= "ContactMirror"."systemModstamp"
    `);
    if (page.done && sync.phase === "bootstrap")
      await tx.$executeRaw`
        UPDATE "forcemultiplier"."ContactMirror" SET
          email = NULL, "normalizedEmail" = NULL, "firstName" = NULL,
          "lastName" = NULL, "extraFields" = '{}'::jsonb,
          "optedOut" = true, "deletedAt" = ${boundary},
          "observedAt" = NOW()
        WHERE "orgId" = ${sync.orgId} AND "lastSeenScan" IS DISTINCT FROM ${scanId}
          AND "deletedAt" IS NULL AND "systemModstamp" <= ${boundary}
      `;
  });
  return {
    phase: sync.phase,
    processed,
    total: page.totalSize,
    done: page.done,
  };
}

async function saveDeletedWindow(sync: ContactMirrorSync, lease: Date) {
  const start = minute(sync.deletedThrough!);
  const end = new Date(
    Math.min(start.getTime() + DAY, minute(sync.scanUntil!).getTime()),
  );
  if (end <= start)
    throw new AppError("Contact deletion coverage did not advance.", 409);
  const path = `/services/data/${SF_VERSION}/sobjects/Contact/deleted/?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
  const page = await providerRequest(
    "salesforce",
    path,
    {},
    { externalId: sync.orgId!, timeoutMs: 25000 },
  );
  const through = new Date(page?.latestDateCovered ?? "");
  const earliest = new Date(page?.earliestDateAvailable ?? "");
  if (
    !Array.isArray(page?.deletedRecords) ||
    page.deletedRecords.length > MAX_DELETIONS ||
    Number.isNaN(through.getTime()) ||
    minute(through) <= start ||
    through > end ||
    Number.isNaN(earliest.getTime()) ||
    earliest > start
  )
    throw new AppError(
      "Salesforce deletion history is incomplete or too large. The mirror needs a full reconciliation.",
      409,
    );
  const rows = page.deletedRecords.map(
    (record: { id: unknown; deletedDate: unknown }) => {
      const deletedAt = new Date(String(record.deletedDate ?? ""));
      if (
        typeof record.id !== "string" ||
        !sfId(record.id) ||
        Number.isNaN(deletedAt.getTime()) ||
        deletedAt < start ||
        deletedAt > through
      )
        throw new AppError(
          "Salesforce returned an invalid deleted Contact.",
          502,
        );
      return { id: record.id as string, deletedAt };
    },
  );
  await db.$transaction(async (tx) => {
    const done = through >= minute(sync.scanUntil!);
    const owner = await tx.contactMirrorSync.updateMany({
      where: {
        id: SYNC_ID,
        enabled: true,
        orgId: sync.orgId,
        leaseUntil: lease,
      },
      data: done
        ? {
            phase: "idle",
            deletedThrough: through,
            scanUntil: null,
            lastCompletedAt: new Date(),
            dueAt: new Date(Date.now() + DAY),
            leaseUntil: null,
          }
        : { deletedThrough: through, leaseUntil: null, error: null },
    });
    if (!owner.count || lease.getTime() <= Date.now())
      throw new AppError(
        "The Contact mirror lease expired. Retry this deletion window.",
        409,
      );
    for (let offset = 0; offset < rows.length; offset += 200) {
      const values = Prisma.join(
        rows
          .slice(offset, offset + 200)
          .map(
            (r: { id: string; deletedAt: Date }) =>
              Prisma.sql`(${r.id}, ${r.deletedAt})`,
          ),
      );
      await tx.$executeRaw(Prisma.sql`
        UPDATE "forcemultiplier"."ContactMirror" AS c SET
          email = NULL, "normalizedEmail" = NULL, "firstName" = NULL,
          "lastName" = NULL, "extraFields" = '{}'::jsonb, "optedOut" = true,
          "systemModstamp" = d."deletedAt", "deletedAt" = d."deletedAt",
          "observedAt" = NOW()
        FROM (VALUES ${values}) AS d(id, "deletedAt")
        WHERE c."orgId" = ${sync.orgId} AND c."salesforceId" = d.id
          AND c."systemModstamp" <= d."deletedAt"
      `);
    }
  });
  return {
    phase: "deletions",
    deleted: rows.length,
    done: through >= minute(sync.scanUntil!),
  };
}

export async function runContactMirrorStep() {
  const lease = new Date(Date.now() + LEASE);
  const claim = await db.contactMirrorSync.updateMany({
    where: {
      id: SYNC_ID,
      enabled: true,
      dueAt: { lte: new Date() },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: lease },
  });
  if (!claim.count) return { idle: true };
  try {
    let sync = await db.contactMirrorSync.findUniqueOrThrow({
      where: { id: SYNC_ID },
    });
    const account = await connection("salesforce");
    if (
      !account.tokens ||
      !account.externalId ||
      account.externalId !== sync.orgId
    ) {
      await db.contactMirrorSync.updateMany({
        where: { id: SYNC_ID, leaseUntil: lease },
        data: {
          enabled: false,
          leaseUntil: null,
          error:
            "The Salesforce connection changed. Review and re-enable the Contact mirror.",
        },
      });
      return { paused: true };
    }
    if (sync.phase === "idle") {
      if (
        !sync.cursor ||
        !sync.deletedThrough ||
        Date.now() - sync.deletedThrough.getTime() > 14 * DAY
      )
        throw new AppError(
          "Salesforce deletion history may have expired. A full reconciliation is required.",
          409,
        );
      const nextBoundary = minute(new Date(Date.now() - 2 * MINUTE));
      if (nextBoundary <= sync.cursor) {
        await db.contactMirrorSync.updateMany({
          where: { id: SYNC_ID, leaseUntil: lease },
          data: {
            leaseUntil: null,
            dueAt: new Date(sync.cursor.getTime() + 3 * MINUTE),
          },
        });
        return { idle: true };
      }
      sync = await db.contactMirrorSync.update({
        where: { id: SYNC_ID },
        data: {
          phase: "changes",
          scanUntil: nextBoundary,
          processed: 0,
          total: 0,
        },
      });
    }
    if (sync.phase === "bootstrap" || sync.phase === "changes") {
      const boundary =
        sync.scanUntil ?? minute(new Date(Date.now() - 2 * MINUTE));
      if (sync.phase === "changes" && sync.cursor && boundary <= sync.cursor) {
        await db.contactMirrorSync.updateMany({
          where: { id: SYNC_ID, leaseUntil: lease },
          data: {
            leaseUntil: null,
            dueAt: new Date(sync.cursor.getTime() + 3 * MINUTE),
          },
        });
        return { idle: true };
      }
      const result = await saveContactPage(sync, lease, boundary);
      return result;
    }
    if (sync.phase === "deletions") return await saveDeletedWindow(sync, lease);
    throw new AppError(
      "Unknown Contact mirror phase. The mirror is paused.",
      409,
    );
  } catch (error) {
    await db.contactMirrorSync.updateMany({
      where: { id: SYNC_ID, leaseUntil: lease },
      data: { leaseUntil: null, error: publicError(error).error },
    });
    throw error;
  }
}
