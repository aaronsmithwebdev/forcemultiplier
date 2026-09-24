import { Prisma } from "@prisma/client";
import { db } from "./db";
import { normalizedEmail } from "./email";
import { AppError, publicError } from "./errors";
import { connection, providerRequest, SF_VERSION } from "./providers";
import { hash } from "./security";
import { quote, sfId } from "./soql";

const SYNC_ID = "salesforce";
const TO_FORCE_MULTIPLIER = "salesforce_to_forcemultiplier";
const TO_SALESFORCE = "forcemultiplier_to_salesforce";

type SyncCursor = {
  cursor: Date | null;
  scanCursor: string | null;
  scanUntil: Date | null;
};

type SalesforceContact = {
  Id: string;
  Email?: string | null;
  HasOptedOutOfEmail: boolean;
  SystemModstamp?: string;
};

async function salesforceAccount() {
  const account = await connection("salesforce");
  if (!account.tokens || !account.externalId)
    throw new AppError("Connect Salesforce before enabling opt-out sync.", 409);
  return account;
}

export async function validateSalesforceOptOutField() {
  const description = await providerRequest(
    "salesforce",
    `/services/data/${SF_VERSION}/sobjects/Contact/describe`,
  );
  const field = Array.isArray(description?.fields)
    ? description.fields.find((item: any) => item.name === "HasOptedOutOfEmail")
    : null;
  if (!field || field.type !== "boolean" || field.updateable !== true)
    throw new AppError(
      "The connected Salesforce user cannot update Contact.HasOptedOutOfEmail. Grant field edit access, then try again.",
      403,
    );
}

export async function suppressionState(search = "") {
  const query = search.trim().toLowerCase().slice(0, 254);
  const suppressionWhere = query ? { email: { contains: query } } : undefined;
  const eventWhere = query ? { email: { contains: query } } : undefined;
  const [total, recentSuppressions, recentEvents, sync, grouped] =
    await Promise.all([
      db.suppression.count(),
      db.suppression.findMany({
        where: suppressionWhere,
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          email: true,
          kind: true,
          source: true,
          sourceRef: true,
          occurredAt: true,
          createdAt: true,
        },
      }),
      db.suppressionEvent.findMany({
        where: eventWhere,
        orderBy: { recordedAt: "desc" },
        take: 50,
        select: {
          id: true,
          email: true,
          direction: true,
          source: true,
          sourceRef: true,
          occurredAt: true,
          recordedAt: true,
          salesforceId: true,
          campaignId: true,
          campaignName: true,
          subject: true,
          providerMessageId: true,
          status: true,
          attempts: true,
          error: true,
          processedAt: true,
        },
      }),
      db.salesforceSuppressionSync.findUnique({ where: { id: SYNC_ID } }),
      db.suppressionEvent.groupBy({
        by: ["direction", "status"],
        _count: { _all: true },
      }),
    ]);
  return {
    total,
    recentSuppressions,
    recentEvents,
    sync: {
      enabled: sync?.enabled ?? false,
      field: "Contact.HasOptedOutOfEmail",
      scanning: !!sync?.scanCursor,
      lastRunAt: sync?.lastRunAt,
      lastCompletedAt: sync?.lastCompletedAt,
      error: sync?.error,
      schedulerReady: Boolean(process.env.CRON_SECRET),
      counts: Object.fromEntries(
        grouped.map((row) => [
          `${row.direction}:${row.status}`,
          row._count._all,
        ]),
      ),
    },
  };
}

export async function importSuppressions(
  values: string[],
  sourceRef: string,
  userId: string,
) {
  const emails = [
    ...new Set(values.map(normalizedEmail).filter(Boolean)),
  ] as string[];
  if (!emails.length)
    throw new AppError("This upload contains no valid emails.");
  const recordedAt = new Date();
  const [suppressions] = await db.$transaction([
    db.suppression.createMany({
      data: emails.map((email) => ({
        email,
        source: "csv_import",
        sourceRef,
        createdBy: userId,
      })),
      skipDuplicates: true,
    }),
    db.suppressionEvent.createMany({
      data: emails.map((email) => ({
        dedupeKey: `csv:${hash(`${sourceRef}\0${email}`)}`,
        email,
        direction: "import_to_forcemultiplier",
        source: "csv_import",
        sourceRef,
        recordedAt,
        processedAt: recordedAt,
      })),
      skipDuplicates: true,
    }),
  ]);
  return {
    submitted: emails.length,
    added: suppressions.count,
    existing: emails.length - suppressions.count,
  };
}

export async function setSalesforceSuppressionSync(enabled: boolean) {
  if (!enabled) {
    await db.salesforceSuppressionSync.upsert({
      where: { id: SYNC_ID },
      create: { id: SYNC_ID },
      update: { enabled: false, leaseUntil: null },
    });
    return suppressionState();
  }
  const account = await salesforceAccount();
  await validateSalesforceOptOutField();
  const current = await db.salesforceSuppressionSync.findUnique({
    where: { id: SYNC_ID },
  });
  const sameOrg = current?.orgId === account.externalId;
  await db.salesforceSuppressionSync.upsert({
    where: { id: SYNC_ID },
    create: {
      id: SYNC_ID,
      enabled: true,
      orgId: account.externalId,
    },
    update: {
      enabled: true,
      orgId: account.externalId,
      ...(sameOrg ? {} : { cursor: null, scanCursor: null, scanUntil: null }),
      leaseUntil: null,
      error: null,
    },
  });
  return suppressionState();
}

export function salesforceOptOutQuery(cursor: Date | null, boundary: Date) {
  return [
    "SELECT Id, Email, HasOptedOutOfEmail, SystemModstamp FROM Contact",
    "WHERE HasOptedOutOfEmail = true",
    `AND SystemModstamp <= ${boundary.toISOString()}`,
    ...(cursor ? [`AND SystemModstamp > ${cursor.toISOString()}`] : []),
    "ORDER BY SystemModstamp, Id",
  ].join(" ");
}

function scanPath(sync: SyncCursor, boundary: Date) {
  return (
    sync.scanCursor ||
    `/services/data/${SF_VERSION}/query?q=${encodeURIComponent(
      salesforceOptOutQuery(sync.cursor, boundary),
    )}`
  );
}

export function salesforceOptOutRows(
  records: SalesforceContact[],
  orgId: string,
  recordedAt: Date,
) {
  const suppressions: Prisma.SuppressionCreateManyInput[] = [];
  const events: Prisma.SuppressionEventCreateManyInput[] = [];
  for (const record of records) {
    const occurredAt = new Date(record.SystemModstamp || "");
    if (
      !sfId(record.Id) ||
      record.HasOptedOutOfEmail !== true ||
      Number.isNaN(occurredAt.getTime())
    )
      throw new AppError(
        "Salesforce returned an invalid Contact opt-out record.",
        502,
      );
    const email = normalizedEmail(record.Email);
    if (email)
      suppressions.push({
        email,
        source: "salesforce",
        sourceRef: record.Id,
        occurredAt,
      });
    events.push({
      dedupeKey: `sf_in:${orgId}:${record.Id}:${email ?? "no-email"}`,
      orgId,
      email,
      direction: TO_FORCE_MULTIPLIER,
      source: "salesforce",
      sourceRef: record.Id,
      occurredAt,
      recordedAt,
      salesforceId: record.Id,
      status: email ? "recorded" : "invalid_email",
      error: email
        ? null
        : "The opted-out Salesforce Contact has no valid email address.",
      processedAt: recordedAt,
    });
  }
  return { suppressions, events };
}

async function scanSalesforceOptOuts(sync: SyncCursor, orgId: string) {
  const boundary = sync.scanUntil ?? new Date();
  const path = scanPath(sync, boundary);
  const page = await providerRequest(
    "salesforce",
    path,
    {},
    {
      externalId: orgId,
      timeoutMs: 10000,
    },
  );
  if (
    !Array.isArray(page?.records) ||
    typeof page.done !== "boolean" ||
    (!page.done &&
      (typeof page.nextRecordsUrl !== "string" || page.nextRecordsUrl === path))
  )
    throw new AppError("Salesforce returned an incomplete opt-out page.", 502);

  const recordedAt = new Date();
  const { suppressions, events } = salesforceOptOutRows(
    page.records,
    orgId,
    recordedAt,
  );

  await db.$transaction([
    db.suppression.createMany({ data: suppressions, skipDuplicates: true }),
    db.suppressionEvent.createMany({ data: events, skipDuplicates: true }),
    db.salesforceSuppressionSync.update({
      where: { id: SYNC_ID },
      data: page.done
        ? {
            cursor: boundary,
            scanCursor: null,
            scanUntil: null,
            lastCompletedAt: recordedAt,
          }
        : { scanCursor: page.nextRecordsUrl, scanUntil: boundary },
    }),
  ]);
}

type OutboundCandidate = {
  email: string;
  source: string;
  sourceRef: string | null;
  occurredAt: Date | null;
  createdAt: Date;
  campaignId: string | null;
  campaignName: string | null;
  subject: string | null;
  providerMessageId: string | null;
};

async function queueOutbound(orgId: string) {
  const rows = await db.$queryRaw<OutboundCandidate[]>(Prisma.sql`
    SELECT s.email, s.source, s."sourceRef", s."occurredAt", s."createdAt",
      origin."campaignId", origin."campaignName", origin.subject,
      origin."providerMessageId"
    FROM "forcemultiplier"."Suppression" s
    LEFT JOIN LATERAL (
      SELECT e."campaignId", e."campaignName", e.subject, e."providerMessageId"
      FROM "forcemultiplier"."SuppressionEvent" e
      WHERE e.email = s.email AND e.direction <> ${TO_SALESFORCE}
      ORDER BY e."recordedAt" DESC
      LIMIT 1
    ) origin ON TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM "forcemultiplier"."SuppressionEvent" e
      WHERE e.email = s.email AND e."orgId" = ${orgId}
        AND e.direction = ${TO_SALESFORCE}
    )
      AND NOT EXISTS (
        SELECT 1 FROM "forcemultiplier"."SuppressionEvent" e
        WHERE e.email = s.email AND e."orgId" = ${orgId}
          AND e.direction = ${TO_FORCE_MULTIPLIER}
          AND e.status = 'recorded'
      )
    ORDER BY s."createdAt", s.email
    LIMIT 100
  `);
  if (!rows.length) return;
  await db.suppressionEvent.createMany({
    data: rows.map((row) => ({
      dedupeKey: `sf_out:${orgId}:${row.email}`,
      orgId,
      email: row.email,
      direction: TO_SALESFORCE,
      source: row.source,
      sourceRef: row.sourceRef,
      occurredAt: row.occurredAt ?? row.createdAt,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      subject: row.subject,
      providerMessageId: row.providerMessageId,
      status: "queued",
    })),
    skipDuplicates: true,
  });
}

export function salesforceMatches(records: SalesforceContact[]) {
  const matches = new Map<string, SalesforceContact[]>();
  for (const record of records) {
    const email = normalizedEmail(record.Email);
    if (email) matches.set(email, [...(matches.get(email) ?? []), record]);
  }
  return matches;
}

async function querySalesforceEmails(emails: string[], orgId: string) {
  const query = `SELECT Id, Email, HasOptedOutOfEmail FROM Contact WHERE Email IN (${emails.map(quote).join(",")})`;
  const records: SalesforceContact[] = [];
  let cursor: string | undefined;
  do {
    const page = await providerRequest(
      "salesforce",
      cursor ||
        `/services/data/${SF_VERSION}/query?q=${encodeURIComponent(query)}`,
      {},
      { externalId: orgId, timeoutMs: 10000 },
    );
    if (!Array.isArray(page?.records) || typeof page.done !== "boolean")
      throw new AppError(
        "Salesforce returned an incomplete Contact page.",
        502,
      );
    records.push(...page.records);
    cursor = page.done ? undefined : page.nextRecordsUrl;
    if (!page.done && !cursor)
      throw new AppError("Salesforce Contact pagination did not advance.", 502);
  } while (cursor);
  return records;
}

async function matchOutbound(orgId: string) {
  const events = await db.suppressionEvent.findMany({
    where: {
      orgId,
      direction: TO_SALESFORCE,
      status: "queued",
      email: { not: null },
      availableAt: { lte: new Date() },
    },
    orderBy: { recordedAt: "asc" },
    take: 100,
  });
  if (!events.length) return;
  const matches = salesforceMatches(
    await querySalesforceEmails(
      events.map((event) => event.email!),
      orgId,
    ),
  );
  const processedAt = new Date();
  await db.$transaction(
    events.map((event) => {
      const records = matches.get(event.email!) ?? [];
      const record = records.length === 1 ? records[0] : null;
      return db.suppressionEvent.update({
        where: { id: event.id },
        data: !record
          ? {
              status: records.length ? "ambiguous" : "unmatched",
              error: records.length
                ? "Multiple Salesforce Contacts share this email address."
                : "No Salesforce Contact matched this email address.",
              processedAt,
            }
          : record.HasOptedOutOfEmail
            ? {
                status: "already_opted_out",
                salesforceId: record.Id,
                error: null,
                processedAt,
              }
            : {
                status: "pending",
                salesforceId: record.Id,
                error: null,
                processedAt: null,
              },
      });
    }),
  );
}

function failedEvent(event: { id: string; attempts: number }, error: string) {
  const delayMinutes = Math.min(24 * 60, 2 ** event.attempts * 5);
  return db.suppressionEvent.update({
    where: { id: event.id },
    data: {
      status: "failed",
      attempts: { increment: 1 },
      availableAt: new Date(Date.now() + delayMinutes * 60000),
      error: error.slice(0, 1000),
      processedAt: new Date(),
    },
  });
}

async function writeOutbound(orgId: string) {
  const events = await db.suppressionEvent.findMany({
    where: {
      orgId,
      direction: TO_SALESFORCE,
      status: { in: ["pending", "failed"] },
      salesforceId: { not: null },
      attempts: { lt: 8 },
      availableAt: { lte: new Date() },
    },
    orderBy: { recordedAt: "asc" },
    take: 100,
  });
  if (!events.length) return;
  const result = await providerRequest(
    "salesforce",
    `/services/data/${SF_VERSION}/composite/sobjects`,
    {
      method: "PATCH",
      body: JSON.stringify({
        allOrNone: false,
        records: events.map((event) => ({
          attributes: { type: "Contact" },
          Id: event.salesforceId,
          HasOptedOutOfEmail: true,
        })),
      }),
    },
    { externalId: orgId, timeoutMs: 12000 },
  );
  if (!Array.isArray(result) || result.length !== events.length)
    throw new AppError("Salesforce returned an incomplete opt-out write.", 502);
  await db.$transaction(
    events.map((event, index) => {
      const item = result[index];
      return item?.success
        ? db.suppressionEvent.update({
            where: { id: event.id },
            data: {
              status: "written",
              attempts: { increment: 1 },
              error: null,
              processedAt: new Date(),
            },
          })
        : failedEvent(
            event,
            (Array.isArray(item?.errors) ? item.errors : [])
              .map(
                (error: any) =>
                  `${error.statusCode || "ERROR"}: ${error.message || "Update failed"}`,
              )
              .join(" ") || "Salesforce rejected the Contact opt-out.",
          );
    }),
  );
}

export async function retrySalesforceSuppressionEvents() {
  const sync = await db.salesforceSuppressionSync.findUnique({
    where: { id: SYNC_ID },
  });
  if (!sync?.enabled || !sync.orgId)
    throw new AppError("Enable Salesforce opt-out sync first.", 409);
  const result = await db.suppressionEvent.updateMany({
    where: {
      orgId: sync.orgId,
      direction: TO_SALESFORCE,
      status: { in: ["failed", "unmatched", "ambiguous"] },
    },
    data: {
      status: "queued",
      salesforceId: null,
      attempts: 0,
      availableAt: new Date(),
      error: null,
      processedAt: null,
    },
  });
  return { retried: result.count };
}

export async function runSalesforceSuppressionSync() {
  const lease = new Date(Date.now() + 55000);
  const acquired = await db.salesforceSuppressionSync.updateMany({
    where: {
      id: SYNC_ID,
      enabled: true,
      orgId: { not: null },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: lease, lastRunAt: new Date(), error: null },
  });
  if (!acquired.count) return { ran: false };
  try {
    const sync = await db.salesforceSuppressionSync.findUniqueOrThrow({
      where: { id: SYNC_ID },
    });
    const account = await salesforceAccount();
    if (account.externalId !== sync.orgId)
      throw new AppError(
        "The connected Salesforce org changed. Disable and re-enable opt-out sync.",
        409,
      );
    await scanSalesforceOptOuts(sync, sync.orgId!);
    await queueOutbound(sync.orgId!);
    await matchOutbound(sync.orgId!);
    await writeOutbound(sync.orgId!);
    await db.salesforceSuppressionSync.updateMany({
      where: { id: SYNC_ID, leaseUntil: lease },
      data: { leaseUntil: null },
    });
    return { ran: true };
  } catch (error) {
    await db.salesforceSuppressionSync.updateMany({
      where: { id: SYNC_ID, leaseUntil: lease },
      data: { leaseUntil: null, error: publicError(error).error },
    });
    throw error;
  }
}
