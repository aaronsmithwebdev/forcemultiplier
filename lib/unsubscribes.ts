import { Prisma } from "@prisma/client";
import { db } from "./db";
import { normalizedEmail } from "./email";
import { AppError, publicError } from "./errors";
import { connection, providerRequest, SF_VERSION, sfQuery } from "./providers";
import { sfId } from "./soql";
import { validateSalesforceOptOutField } from "./suppressions";

const SYNC_ID = "default";

type LinkRow = { contactId: string; salesforceId: string };
type SalesforceContact = { Id: string; HasOptedOutOfEmail: boolean };

export function uniqueLinks(rows: LinkRow[]) {
  const links = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = links.get(row.contactId) ?? new Set<string>();
    ids.add(row.salesforceId);
    links.set(row.contactId, ids);
  }
  return new Map(
    [...links].map(([contactId, ids]) => [contactId, [...ids].sort()]),
  );
}

async function accounts() {
  const [salesforce, constantContact] = await Promise.all([
    connection("salesforce"),
    connection("constant-contact"),
  ]);
  if (!salesforce.tokens || !salesforce.externalId)
    throw new AppError("Connect Salesforce before enabling writeback.", 409);
  if (!constantContact.tokens || !constantContact.externalId)
    throw new AppError(
      "Connect Constant Contact before enabling writeback.",
      409,
    );
  return { salesforce, constantContact };
}

export async function setUnsubscribeSync(
  enabled: boolean,
  includeExisting = false,
) {
  if (!enabled) {
    await db.unsubscribeSync.upsert({
      where: { id: SYNC_ID },
      create: { id: SYNC_ID },
      update: { enabled: false, leaseUntil: null },
    });
    return unsubscribeState();
  }
  const { salesforce, constantContact } = await accounts();
  await validateSalesforceOptOutField();
  const current = await db.unsubscribeSync.findUnique({
    where: { id: SYNC_ID },
  });
  const sameAccounts =
    current?.accountId === constantContact.externalId &&
    current?.orgId === salesforce.externalId;
  await db.unsubscribeSync.upsert({
    where: { id: SYNC_ID },
    create: {
      id: SYNC_ID,
      enabled: true,
      accountId: constantContact.externalId,
      orgId: salesforce.externalId,
      cursor: includeExisting ? null : new Date(),
    },
    update: {
      enabled: true,
      accountId: constantContact.externalId,
      orgId: salesforce.externalId,
      ...(sameAccounts && !includeExisting
        ? {}
        : {
            cursor: includeExisting ? null : new Date(),
            scanCursor: null,
            scanUntil: null,
          }),
      leaseUntil: null,
      error: null,
    },
  });
  return unsubscribeState();
}

export async function retryUnsubscribeEvents() {
  const sync = await db.unsubscribeSync.findUnique({ where: { id: SYNC_ID } });
  if (!sync?.enabled || !sync.accountId || !sync.orgId)
    throw new AppError("Enable unsubscribe writeback first.", 409);
  const result = await db.unsubscribeEvent.updateMany({
    where: {
      accountId: sync.accountId,
      orgId: sync.orgId,
      status: { in: ["failed", "unmatched", "ambiguous"] },
    },
    data: {
      status: "pending",
      attempts: 0,
      availableAt: new Date(),
      error: null,
      processedAt: null,
    },
  });
  return { retried: result.count };
}

export async function unsubscribeState() {
  const sync = await db.unsubscribeSync.findUnique({ where: { id: SYNC_ID } });
  if (!sync)
    return { enabled: false, field: "Contact.HasOptedOutOfEmail", counts: {} };
  const grouped =
    sync.accountId && sync.orgId
      ? await db.unsubscribeEvent.groupBy({
          by: ["status"],
          where: { accountId: sync.accountId, orgId: sync.orgId },
          _count: { _all: true },
        })
      : [];
  const recent =
    sync.accountId && sync.orgId
      ? await db.unsubscribeEvent.findMany({
          where: { accountId: sync.accountId, orgId: sync.orgId },
          orderBy: { discoveredAt: "desc" },
          take: 20,
          select: {
            contactId: true,
            email: true,
            optOutAt: true,
            status: true,
            salesforceId: true,
            error: true,
            processedAt: true,
          },
        })
      : [];
  return {
    enabled: sync.enabled,
    field: "Contact.HasOptedOutOfEmail",
    cursor: sync.cursor,
    scanning: !!sync.scanCursor,
    lastRunAt: sync.lastRunAt,
    lastCompletedAt: sync.lastCompletedAt,
    error: sync.error,
    counts: Object.fromEntries(
      grouped.map((row) => [row.status, row._count._all]),
    ),
    recent,
  };
}

function scanPath(sync: {
  cursor: Date | null;
  scanCursor: string | null;
  scanUntil: Date | null;
}) {
  if (sync.scanCursor) return sync.scanCursor;
  const params = new URLSearchParams({
    status: "unsubscribed",
    optout_before: (sync.scanUntil ?? new Date()).toISOString(),
    limit: "500",
  });
  if (sync.cursor)
    params.set(
      "optout_after",
      new Date(sync.cursor.getTime() - 1000).toISOString(),
    );
  return `/v3/contacts?${params}`;
}

async function scan(sync: {
  accountId: string;
  orgId: string;
  cursor: Date | null;
  scanCursor: string | null;
  scanUntil: Date | null;
}) {
  const boundary = sync.scanUntil ?? new Date();
  const page = await providerRequest(
    "constant-contact",
    scanPath({ ...sync, scanUntil: boundary }),
  );
  if (!Array.isArray(page?.contacts))
    throw new AppError(
      "Constant Contact returned an incomplete unsubscribe page.",
      502,
    );
  const events = page.contacts.flatMap((contact: any) => {
    const email = normalizedEmail(contact?.email_address?.address);
    const optOutAt = new Date(contact?.opt_out_date);
    return typeof contact?.contact_id === "string" &&
      email &&
      contact?.permission_to_send === "unsubscribed" &&
      !Number.isNaN(optOutAt.getTime())
      ? [
          {
            accountId: sync.accountId,
            orgId: sync.orgId,
            contactId: contact.contact_id,
            email,
            optOutAt,
            optOutSource:
              typeof contact.opt_out_source === "string"
                ? contact.opt_out_source.slice(0, 100)
                : null,
          },
        ]
      : [];
  });
  if (events.length)
    await db.unsubscribeEvent.createMany({
      data: events,
      skipDuplicates: true,
    });
  const next =
    typeof page?._links?.next?.href === "string" ? page._links.next.href : null;
  if (next && next === scanPath({ ...sync, scanUntil: boundary }))
    throw new AppError("Unsubscribe pagination did not advance.", 502);
  await db.unsubscribeSync.update({
    where: { id: SYNC_ID },
    data: next
      ? { scanCursor: next, scanUntil: boundary }
      : {
          cursor: boundary,
          scanCursor: null,
          scanUntil: null,
          lastCompletedAt: new Date(),
        },
  });
}

async function writeEvents(accountId: string, orgId: string) {
  const events = await db.unsubscribeEvent.findMany({
    where: {
      accountId,
      orgId,
      status: { in: ["pending", "failed"] },
      attempts: { lt: 8 },
      availableAt: { lte: new Date() },
    },
    orderBy: { discoveredAt: "asc" },
    take: 100,
  });
  if (!events.length) return;
  const contactIds = events.map((event) => event.contactId);
  const links = await db.$queryRaw<LinkRow[]>(Prisma.sql`
    SELECT DISTINCT e."contactId", am."salesforceId"
    FROM "forcemultiplier"."UnsubscribeEvent" e
    JOIN "forcemultiplier"."AudienceMember" am
      ON am."normalizedEmail" = e."email" AND am."optedOut" = false
    JOIN "forcemultiplier"."DeliveryRun" d
      ON d."sourceRunId" = am."runId" AND d."accountId" = e."accountId"
    JOIN "forcemultiplier"."Audience" a
      ON a."id" = d."audienceId" AND a."orgId" = e."orgId"
    WHERE e."accountId" = ${accountId}
      AND e."orgId" = ${orgId}
      AND e."contactId" IN (${Prisma.join(contactIds)})
      AND d."status" IN ('completed', 'completed_with_errors')
      AND NOT EXISTS (
        SELECT 1 FROM "forcemultiplier"."DeliveryIssue" i
        WHERE i."deliveryId" = d."id"
          AND (i."salesforceId" = am."salesforceId" OR lower(i."email") = e."email")
      )
  `);
  const byContact = uniqueLinks(links);
  const mapped: typeof events = [];
  const terminal: Prisma.PrismaPromise<unknown>[] = [];
  for (const event of events) {
    const ids = (byContact.get(event.contactId) ?? []).filter(sfId);
    if (ids.length !== 1) {
      terminal.push(
        db.unsubscribeEvent.update({
          where: {
            accountId_orgId_contactId: {
              accountId,
              orgId,
              contactId: event.contactId,
            },
          },
          data: {
            status: ids.length ? "ambiguous" : "unmatched",
            attempts: { increment: 1 },
            error: ids.length
              ? "More than one previously delivered Salesforce contact used this email address."
              : "No previously delivered Salesforce contact matched this email address.",
            processedAt: new Date(),
          },
        }),
      );
    } else {
      event.salesforceId = ids[0];
      mapped.push(event);
    }
  }
  if (terminal.length) await db.$transaction(terminal);
  if (!mapped.length) return;
  const ids = [...new Set(mapped.map((event) => event.salesforceId!))];
  const page = await sfQuery(
    `SELECT Id, HasOptedOutOfEmail FROM Contact WHERE Id IN (${ids.map((id) => `'${id}'`).join(",")})`,
  );
  const records = new Map<string, SalesforceContact>(
    (Array.isArray(page?.records) ? page.records : []).map(
      (record: SalesforceContact) => [record.Id, record],
    ),
  );
  const updates: typeof mapped = [];
  const beforeWrite: Prisma.PrismaPromise<unknown>[] = [];
  for (const event of mapped) {
    const record = records.get(event.salesforceId!);
    if (!record) {
      beforeWrite.push(
        failedUpdate(event, "The Salesforce contact no longer exists."),
      );
    } else if (record.HasOptedOutOfEmail) {
      beforeWrite.push(
        eventUpdate(event, {
          status: "already_opted_out",
          salesforceId: event.salesforceId,
          attempts: { increment: 1 },
          error: null,
          processedAt: new Date(),
        }),
      );
    } else updates.push(event);
  }
  if (beforeWrite.length) await db.$transaction(beforeWrite);
  if (!updates.length) return;
  const result = await providerRequest(
    "salesforce",
    `/services/data/${SF_VERSION}/composite/sobjects`,
    {
      method: "PATCH",
      body: JSON.stringify({
        allOrNone: false,
        records: updates.map((event) => ({
          attributes: { type: "Contact" },
          Id: event.salesforceId,
          HasOptedOutOfEmail: true,
        })),
      }),
    },
  );
  if (!Array.isArray(result) || result.length !== updates.length)
    throw new AppError("Salesforce returned an incomplete write result.", 502);
  await db.$transaction(
    updates.map((event, index) => {
      const item = result[index];
      return item?.success
        ? eventUpdate(event, {
            status: "written",
            salesforceId: event.salesforceId,
            attempts: { increment: 1 },
            error: null,
            processedAt: new Date(),
          })
        : failedUpdate(
            event,
            (Array.isArray(item?.errors) ? item.errors : [])
              .map(
                (error: any) =>
                  `${error.statusCode || "ERROR"}: ${error.message || "Update failed"}`,
              )
              .join(" ") || "Salesforce rejected the contact update.",
          );
    }),
  );
}

function eventUpdate(
  event: { accountId: string; orgId: string; contactId: string },
  data: Prisma.UnsubscribeEventUpdateInput,
) {
  return db.unsubscribeEvent.update({
    where: {
      accountId_orgId_contactId: {
        accountId: event.accountId,
        orgId: event.orgId,
        contactId: event.contactId,
      },
    },
    data,
  });
}

function failedUpdate(
  event: {
    accountId: string;
    orgId: string;
    contactId: string;
    attempts: number;
    salesforceId?: string | null;
  },
  error: string,
) {
  const delayMinutes = Math.min(24 * 60, 2 ** event.attempts * 5);
  return eventUpdate(event, {
    status: "failed",
    salesforceId: event.salesforceId,
    attempts: { increment: 1 },
    availableAt: new Date(Date.now() + delayMinutes * 60000),
    error: error.slice(0, 1000),
    processedAt: new Date(),
  });
}

export async function runUnsubscribeSync() {
  const lease = new Date(Date.now() + 55000);
  const acquired = await db.unsubscribeSync.updateMany({
    where: {
      id: SYNC_ID,
      enabled: true,
      accountId: { not: null },
      orgId: { not: null },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: lease, lastRunAt: new Date(), error: null },
  });
  if (!acquired.count) return { ran: false };
  try {
    const sync = await db.unsubscribeSync.findUniqueOrThrow({
      where: { id: SYNC_ID },
    });
    const { salesforce, constantContact } = await accounts();
    if (
      salesforce.externalId !== sync.orgId ||
      constantContact.externalId !== sync.accountId
    )
      throw new AppError(
        "Connected accounts changed. Disable and re-enable unsubscribe writeback.",
        409,
      );
    await scan({
      accountId: sync.accountId!,
      orgId: sync.orgId!,
      cursor: sync.cursor,
      scanCursor: sync.scanCursor,
      scanUntil: sync.scanUntil,
    });
    await writeEvents(sync.accountId!, sync.orgId!);
    await db.unsubscribeSync.updateMany({
      where: { id: SYNC_ID, leaseUntil: lease },
      data: { leaseUntil: null },
    });
    return { ran: true };
  } catch (error) {
    await db.unsubscribeSync.updateMany({
      where: { id: SYNC_ID, leaseUntil: lease },
      data: { leaseUntil: null, error: publicError(error).error },
    });
    throw error;
  }
}
