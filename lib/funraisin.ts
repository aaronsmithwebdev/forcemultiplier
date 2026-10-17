import { randomUUID } from "node:crypto";
import { Prisma, type FunraisinSync } from "@prisma/client";
import { db } from "./db";
import { normalizedEmail } from "./email";
import { AppError, publicError } from "./errors";
import { sfId } from "./soql";

const PHASES = [
  "events",
  "participants",
  "registrations",
  "donations",
] as const;
type Phase = (typeof PHASES)[number];
const ENDPOINT: Record<Phase, string> = {
  events: "events",
  participants: "participants",
  registrations: "participantsevents",
  donations: "donations",
};
const PAGE_SIZE = 1000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LEASE = 5 * 60_000;

export function funraisinId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
}

export function funraisinContactId(value: unknown) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id.startsWith("003") || !sfId(id)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
  let suffix = "";
  for (let chunk = 0; chunk < 3; chunk++) {
    let bits = 0;
    for (let character = 0; character < 5; character++) {
      const letter = id[chunk * 5 + character]!;
      if (letter >= "A" && letter <= "Z") bits |= 1 << character;
    }
    suffix += alphabet[bits];
  }
  return id.length === 18 ? (id.slice(15) === suffix ? id : null) : id + suffix;
}

const shortText = (value: unknown, max = 255) =>
  typeof value === "string" ? value.trim().slice(0, max) || null : null;

const name = (first: unknown, last: unknown) =>
  [shortText(first, 150), shortText(last, 150)].filter(Boolean).join(" ") ||
  null;

const date = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null;
};

export function funraisinRow(phase: Phase, row: Record<string, unknown>) {
  const key = {
    events: "event_id",
    participants: "member_id",
    registrations: "history_id",
    donations: "donation_id",
  }[phase];
  const id = funraisinId(row[key]);
  if (!id) throw new AppError(`Funraisin returned an invalid ${key}.`, 502);
  if (phase === "events") {
    const eventName = shortText(row.event_name, 150);
    if (!eventName)
      throw new AppError("Funraisin returned an event without a name.", 502);
    return { id, name: eventName, eventDate: date(row.event_date) };
  }
  if (phase === "participants")
    return {
      id,
      salesforceId: funraisinContactId(row.crm_member_id),
      name: name(row.m_fname, row.m_lname),
      email: normalizedEmail(shortText(row.m_email, 254)),
    };
  if (phase === "registrations") {
    if (
      [row.is_active, row.is_complete, row.is_archived].some(
        (value) => value !== "Y" && value !== "N",
      )
    )
      throw new AppError(
        "Funraisin returned an invalid registration status.",
        502,
      );
    return {
      id,
      memberId: funraisinId(row.member_id),
      eventId: funraisinId(row.event_id),
      active: row.is_active === "Y",
      complete: row.is_complete === "Y",
      archived: row.is_archived === "Y",
    };
  }
  return {
    id,
    eventId: funraisinId(row.event_id),
    salesforceId: funraisinContactId(row.crm_donor_id),
    name: name(row.d_fname, row.d_lname),
    email: normalizedEmail(shortText(row.d_email, 254)),
    status: shortText(row.d_status, 20),
  };
}

function apiUrl() {
  const raw = process.env.FUNRAISIN_BASE_URL?.trim();
  const key = process.env.FUNRAISIN_API_KEY?.trim();
  if (!raw || !key) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("FUNRAISIN_BASE_URL is invalid.", 500);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AppError("FUNRAISIN_BASE_URL must be a plain HTTPS URL.", 500);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  return { url, key };
}

export function funraisinPageUrl(
  base: URL,
  phase: Phase,
  offset: number,
  since: Date | null,
) {
  const url = new URL(
    `${base.pathname.replace(/\/+$/, "")}/api/${ENDPOINT[phase]}`,
    base.origin,
  );
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  if (since)
    url.searchParams.set("date_from", since.toISOString().slice(0, 10));
  return url;
}

async function page(
  config: NonNullable<ReturnType<typeof apiUrl>>,
  phase: Phase,
  offset: number,
  since: Date | null,
) {
  // ponytail: offset pages can shift during source writes; overlapping polls and weekly full scans reduce gaps until Funraisin offers a stable cursor.
  const url = funraisinPageUrl(config.url, phase, offset, since);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.key}` },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok)
    throw new AppError(
      `Funraisin ${ENDPOINT[phase]} returned HTTP ${response.status}.`,
      502,
    );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AppError("Funraisin returned invalid JSON.", 502);
  }
  const result = payload as { total_records?: unknown; data?: unknown };
  const total = Number(result?.total_records);
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Array.isArray(result?.data) ||
    result.data.length > PAGE_SIZE ||
    result.data.some(
      (row) => !row || typeof row !== "object" || Array.isArray(row),
    ) ||
    (offset < total && !result.data.length)
  )
    throw new AppError("Funraisin returned an incomplete page.", 502);
  return { total, rows: result.data as Record<string, unknown>[] };
}

async function savePage(
  sync: FunraisinSync,
  lease: Date,
  result: Awaited<ReturnType<typeof page>>,
) {
  const phase = sync.phase as Phase;
  const rows = result.rows.map((row) => funraisinRow(phase, row));
  const ids = rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length)
    throw new AppError("Funraisin returned duplicate IDs in one page.", 502);
  let valid = rows;
  let issues: { id: string; reason: string }[] = [];
  if (phase === "registrations") {
    const [events, participants] = await Promise.all([
      db.funraisinEvent.findMany({
        where: {
          id: {
            in: rows.map((row) => row.eventId).filter((v): v is string => !!v),
          },
        },
        select: { id: true },
      }),
      db.funraisinParticipant.findMany({
        where: {
          memberId: {
            in: rows.map((row) => row.memberId).filter((v): v is string => !!v),
          },
        },
        select: { memberId: true },
      }),
    ]);
    const eventIds = new Set(events.map((event) => event.id));
    const memberIds = new Set(participants.map((person) => person.memberId));
    issues = rows.flatMap((row) =>
      !row.eventId || !eventIds.has(row.eventId)
        ? [
            {
              id: row.id,
              reason: "Event is missing from the Funraisin catalog.",
            },
          ]
        : !row.memberId || !memberIds.has(row.memberId)
          ? [
              {
                id: row.id,
                reason: "Participant has no valid Salesforce Contact link.",
              },
            ]
          : [],
    );
  } else if (phase === "donations") {
    const events = await db.funraisinEvent.findMany({
      where: {
        id: {
          in: rows.map((row) => row.eventId).filter((v): v is string => !!v),
        },
      },
      select: { id: true },
    });
    const eventIds = new Set(events.map((event) => event.id));
    issues = rows.flatMap((row) =>
      !row.salesforceId
        ? [{ id: row.id, reason: "Donor has no valid Salesforce Contact ID." }]
        : row.eventId && !eventIds.has(row.eventId)
          ? [
              {
                id: row.id,
                reason: "Event is missing from the Funraisin catalog.",
              },
            ]
          : [],
    );
  } else if (phase === "participants") {
    issues = rows.flatMap((row) =>
      row.salesforceId
        ? []
        : [
            {
              id: row.id,
              reason: "Participant has no valid Salesforce Contact ID.",
            },
          ],
    );
  }
  const issueIds = new Set(issues.map((issue) => issue.id));
  valid = rows.filter((row) => !issueIds.has(row.id));
  const skipped = issues.length;
  const validIds = new Set(valid.map((row) => row.id));
  const finished = sync.offset + result.rows.length >= result.total;
  const next = PHASES[PHASES.indexOf(phase) + 1];
  const done = finished && !next;
  const seen = sync.mode === "full" ? sync.scanId : null;
  await db.$transaction(
    async (tx) => {
      if (valid.length)
        await tx.funraisinIssue.deleteMany({
          where: { phase, sourceId: { in: valid.map((row) => row.id) } },
        });
      if (issues.length)
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "forcemultiplier"."FunraisinIssue" (phase, "sourceId", reason, "lastSeenScan")
          VALUES ${Prisma.join(issues.map((issue) => Prisma.sql`(${phase}, ${issue.id}, ${issue.reason}, ${seen})`))}
          ON CONFLICT (phase, "sourceId") DO UPDATE SET reason = EXCLUDED.reason,
            "lastSeenScan" = COALESCE(EXCLUDED."lastSeenScan", "FunraisinIssue"."lastSeenScan")
        `);
      if (skipped && phase === "participants")
        await tx.funraisinParticipant.deleteMany({
          where: { memberId: { in: ids.filter((id) => !validIds.has(id)) } },
        });
      if (skipped && phase === "registrations")
        await tx.funraisinRegistration.deleteMany({
          where: { historyId: { in: ids.filter((id) => !validIds.has(id)) } },
        });
      if (skipped && phase === "donations")
        await tx.funraisinDonation.deleteMany({
          where: { donationId: { in: ids.filter((id) => !validIds.has(id)) } },
        });
      if (valid.length) {
        if (phase === "events")
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO "forcemultiplier"."FunraisinEvent" (id, name, "eventDate", "lastSeenScan")
          VALUES ${Prisma.join(valid.map((row) => Prisma.sql`(${row.id}, ${row.name}, ${row.eventDate}, ${seen})`))}
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "eventDate" = EXCLUDED."eventDate",
            "lastSeenScan" = COALESCE(EXCLUDED."lastSeenScan", "FunraisinEvent"."lastSeenScan")
        `);
        if (phase === "participants")
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO "forcemultiplier"."FunraisinParticipant" ("memberId", "salesforceId", name, email, "lastSeenScan")
          VALUES ${Prisma.join(valid.map((row) => Prisma.sql`(${row.id}, ${row.salesforceId}, ${row.name}, ${row.email}, ${seen})`))}
          ON CONFLICT ("memberId") DO UPDATE SET "salesforceId" = EXCLUDED."salesforceId",
            name = EXCLUDED.name, email = EXCLUDED.email,
            "lastSeenScan" = COALESCE(EXCLUDED."lastSeenScan", "FunraisinParticipant"."lastSeenScan")
        `);
        if (phase === "registrations")
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO "forcemultiplier"."FunraisinRegistration" ("historyId", "memberId", "eventId", active, complete, archived, "lastSeenScan")
          VALUES ${Prisma.join(valid.map((row) => Prisma.sql`(${row.id}, ${row.memberId}, ${row.eventId}, ${row.active}, ${row.complete}, ${row.archived}, ${seen})`))}
          ON CONFLICT ("historyId") DO UPDATE SET "memberId" = EXCLUDED."memberId",
            "eventId" = EXCLUDED."eventId", active = EXCLUDED.active,
            complete = EXCLUDED.complete, archived = EXCLUDED.archived,
            "lastSeenScan" = COALESCE(EXCLUDED."lastSeenScan", "FunraisinRegistration"."lastSeenScan")
        `);
        if (phase === "donations")
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO "forcemultiplier"."FunraisinDonation" ("donationId", "eventId", "salesforceId", name, email, status, "lastSeenScan")
          VALUES ${Prisma.join(valid.map((row) => Prisma.sql`(${row.id}, ${row.eventId}, ${row.salesforceId}, ${row.name}, ${row.email}, ${row.status}, ${seen})`))}
          ON CONFLICT ("donationId") DO UPDATE SET "eventId" = EXCLUDED."eventId",
            "salesforceId" = EXCLUDED."salesforceId", name = EXCLUDED.name,
            email = EXCLUDED.email, status = EXCLUDED.status,
            "lastSeenScan" = COALESCE(EXCLUDED."lastSeenScan", "FunraisinDonation"."lastSeenScan")
        `);
      }
      if (finished && sync.mode === "full") {
        const table = {
          events: "FunraisinEvent",
          participants: "FunraisinParticipant",
          registrations: "FunraisinRegistration",
          donations: "FunraisinDonation",
        }[phase];
        const previous = await tx.$queryRawUnsafe<[{ count: bigint }]>(
          `SELECT count(*) AS count FROM "forcemultiplier"."${table}"`,
        );
        if (
          Number(previous[0]!.count) >= 100 &&
          sync.processed + rows.length < Number(previous[0]!.count) * 0.8
        )
          throw new AppError(
            "Funraisin returned far fewer records than the previous scan. Review before reconciliation.",
            409,
          );
        await tx.$executeRawUnsafe(
          `DELETE FROM "forcemultiplier"."${table}" WHERE "lastSeenScan" IS DISTINCT FROM $1`,
          sync.scanId,
        );
        await tx.$executeRaw`
          DELETE FROM "forcemultiplier"."FunraisinIssue"
          WHERE phase = ${phase} AND "lastSeenScan" IS DISTINCT FROM ${sync.scanId}
        `;
      }
      const updated = await tx.funraisinSync.updateMany({
        where: { id: sync.id, leaseUntil: lease, phase, offset: sync.offset },
        data: {
          phase: finished ? (next ?? "events") : phase,
          offset: finished ? 0 : sync.offset + rows.length,
          total: finished ? 0 : result.total,
          processed: finished ? 0 : sync.processed + rows.length,
          skipped: sync.skipped + skipped,
          ...(done
            ? {
                mode: "incremental",
                scanId: null,
                scanUntil: null,
                lastCompletedAt: new Date(),
                ...(sync.mode === "full" ? { lastFullAt: new Date() } : {}),
                dueAt: new Date(Date.now() + HOUR),
              }
            : {}),
          error: null,
        },
      });
      if (updated.count !== 1)
        throw new AppError("Funraisin sync lease changed.", 409);
    },
    { timeout: 60_000 },
  );
  return {
    finished: done,
    phase,
    processed: sync.processed + rows.length,
    skipped: sync.skipped + skipped,
  };
}

export async function runFunraisinSyncStep() {
  const config = apiUrl();
  if (!config) return { configured: false };
  const account = await db.connection.findUnique({
    where: { provider: "salesforce" },
    select: { externalId: true, tokens: true },
  });
  if (!account?.externalId || !account.tokens)
    return { configured: true, waitingForSalesforce: true };
  await db.funraisinSync.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  const lease = new Date(Date.now() + LEASE);
  const claimed = await db.funraisinSync.updateMany({
    where: {
      id: "default",
      dueAt: { lte: new Date() },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: lease },
  });
  if (!claimed.count) return { idle: true };
  try {
    let sync = await db.funraisinSync.findUniqueOrThrow({
      where: { id: "default" },
    });
    const baseUrl = config.url.toString();
    if (
      (sync.orgId && sync.orgId !== account.externalId) ||
      (sync.baseUrl && sync.baseUrl !== baseUrl)
    )
      throw new AppError(
        "Funraisin or Salesforce connection changed. Review the existing sync before continuing.",
        409,
      );
    if (!sync.orgId || !sync.baseUrl)
      sync = await db.funraisinSync.update({
        where: { id: sync.id },
        data: { orgId: account.externalId, baseUrl },
      });
    if (!sync.scanUntil) {
      const full =
        !sync.lastFullAt || Date.now() - sync.lastFullAt.getTime() >= 7 * DAY;
      sync = await db.funraisinSync.update({
        where: { id: sync.id },
        data: {
          mode: full ? "full" : "incremental",
          scanId: full ? randomUUID() : null,
          scanUntil: new Date(),
          processed: 0,
          skipped: 0,
        },
      });
    }
    let result: Awaited<ReturnType<typeof savePage>> | null = null;
    for (let step = 0; step < 5; step++) {
      const since =
        sync.mode === "incremental" && sync.lastCompletedAt
          ? new Date(sync.lastCompletedAt.getTime() - 2 * DAY)
          : null;
      const fetched = await page(
        config,
        sync.phase as Phase,
        sync.offset,
        since,
      );
      result = await savePage(sync, lease, fetched);
      if (result.finished) break;
      sync = await db.funraisinSync.findUniqueOrThrow({
        where: { id: "default" },
      });
    }
    return result ?? { idle: true };
  } catch (error) {
    await db.funraisinSync.updateMany({
      where: { id: "default", leaseUntil: lease },
      data: {
        error: publicError(error).error,
        dueAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    throw error;
  } finally {
    await db.funraisinSync.updateMany({
      where: { id: "default", leaseUntil: lease },
      data: { leaseUntil: null },
    });
  }
}
