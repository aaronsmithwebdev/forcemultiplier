import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { AppError } from "./errors";
import { connection } from "./providers";
import { enrich } from "./salesforce";
import { funraisinFundraisingUrl } from "./funraisin";

import { FUNRAISIN_FIELDS } from "./template-merge-tags";
export { FUNRAISIN_FIELDS };

export const funraisinAudienceSchema = z
  .object({
    type: z.literal("funraisin"),
    people: z.enum(["entrants", "donors"]),
    eventId: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
    paidOnly: z.boolean().default(true),
    minDonations: z.number().int().min(1).max(150000).default(1),
    maxDonations: z.number().int().min(1).max(150000).optional(),
  })
  .refine((v) => !v.maxDonations || v.maxDonations >= v.minDonations, {
    message: "Maximum donations must be at least the minimum.",
  });
export function parseFunraisinAudience(query: string) {
  try {
    return funraisinAudienceSchema.parse(JSON.parse(query));
  } catch {
    throw new AppError("Choose valid Funraisin audience filters.", 422);
  }
}

export async function funraisinAudienceConnection(orgId?: string) {
  const [account, sync] = await Promise.all([
    connection("salesforce"),
    db.funraisinSync.findUnique({ where: { id: "default" } }),
  ]);
  if (
    !account.tokens ||
    !sync?.orgId ||
    sync.orgId !== account.externalId ||
    (orgId && orgId !== sync.orgId)
  )
    throw new AppError(
      "Connect the Salesforce org linked to the Funraisin sync.",
      409,
    );
  if (!sync.lastCompletedAt || sync.scanUntil || sync.error)
    throw new AppError(
      "Wait for a successful Funraisin sync to finish before pulling an audience.",
      409,
    );
  return {
    orgId: sync.orgId,
    version: sync.updatedAt.toISOString(),
    baseUrl: sync.baseUrl,
  };
}

export async function funraisinAudiencePage(
  query: string,
  cursor: string | null = null,
  limit = 500,
  orgId?: string,
) {
  const filters = parseFunraisinAudience(query);
  const config = await funraisinAudienceConnection(orgId);
  const previous = cursor
    ? (JSON.parse(cursor) as { after: string; version: string })
    : null;
  if (previous && previous.version !== config.version)
    throw new AppError(
      "Funraisin data changed during this pull. Cancel it and start a new pull.",
      409,
    );
  if (
    filters.eventId &&
    !(await db.funraisinEvent.findUnique({ where: { id: filters.eventId } }))
  )
    throw new AppError("Funraisin event not found.", 404);
  const eventFilter = filters.eventId
    ? Prisma.sql`AND d."eventId" = ${filters.eventId}`
    : Prisma.empty;
  // ponytail: counts are recomputed for each 500-contact page under the 150,000-contact pull limit; materialize aggregates if larger audiences need faster pulls.
  const source =
    filters.people === "entrants"
      ? Prisma.sql`
    SELECT DISTINCT p."salesforceId"
    FROM "forcemultiplier"."FunraisinRegistration" r
    JOIN "forcemultiplier"."FunraisinParticipant" p ON p."memberId" = r."memberId"
    WHERE TRUE
      ${filters.paidOnly ? Prisma.sql`AND r."isPaid"` : Prisma.empty}
      ${filters.eventId ? Prisma.sql`AND r."eventId" = ${filters.eventId}` : Prisma.empty}
  `
      : Prisma.sql`
    SELECT d."salesforceId" FROM "forcemultiplier"."FunraisinDonation" d
    WHERE d.status = 'paid' AND d.amount > COALESCE(d."refundAmount", 0) ${eventFilter}
    GROUP BY d."salesforceId"
    HAVING COUNT(*) >= ${filters.minDonations}
      ${filters.maxDonations ? Prisma.sql`AND COUNT(*) <= ${filters.maxDonations}` : Prisma.empty}
  `;
  const rows = await db.$queryRaw<
    {
      Id: string;
      total: bigint;
      count: bigint;
      amount: string;
      donatedAt: Date | null;
      target: string | null;
      event: string | null;
      username: string | null;
      eventKey: string | null;
    }[]
  >(Prisma.sql`
    WITH source AS (${source}), numbered AS (SELECT *, COUNT(*) OVER () AS total FROM source),
    selected AS (
      SELECT * FROM numbered
      ${previous ? Prisma.sql`WHERE "salesforceId" > ${previous.after}` : Prisma.empty}
      ORDER BY "salesforceId" LIMIT ${limit + 1}
    )
    SELECT s."salesforceId" AS "Id", s.total,
      stats.count, stats.amount::text, latest."donatedAt", latest.target,
      ${filters.eventId ? Prisma.sql`(SELECT name FROM "forcemultiplier"."FunraisinEvent" WHERE id = ${filters.eventId})` : filters.people === "donors" ? Prisma.sql`latest.event` : Prisma.sql`entrant.name`} AS event, entrant.username, entrant."eventKey"
    FROM selected s
    LEFT JOIN LATERAL (
      SELECT p.username, e."eventKey", e.name
      FROM "forcemultiplier"."FunraisinRegistration" r
      JOIN "forcemultiplier"."FunraisinParticipant" p ON p."memberId" = r."memberId"
      JOIN "forcemultiplier"."FunraisinEvent" e ON e.id = r."eventId"
      WHERE ${filters.people === "entrants"} AND p."salesforceId" = s."salesforceId"
        ${filters.paidOnly ? Prisma.sql`AND r."isPaid"` : Prisma.empty}
        ${filters.eventId ? Prisma.sql`AND r."eventId" = ${filters.eventId}` : Prisma.empty}
      ORDER BY e."eventDate" DESC NULLS LAST, r."historyId"::numeric DESC LIMIT 1
    ) entrant ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS count, COALESCE(SUM(d.amount - COALESCE(d."refundAmount", 0)), 0) AS amount
      FROM "forcemultiplier"."FunraisinDonation" d
      WHERE d."salesforceId" = s."salesforceId" AND d.status = 'paid'
        AND d.amount > COALESCE(d."refundAmount", 0) ${eventFilter}
    ) stats ON TRUE
    LEFT JOIN LATERAL (
      SELECT d."donatedAt", COALESCE(p.name, t.name, e.name) AS target, e.name AS event
      FROM "forcemultiplier"."FunraisinDonation" d
      LEFT JOIN "forcemultiplier"."FunraisinParticipant" p ON p."memberId" = d."memberId"
      LEFT JOIN "forcemultiplier"."FunraisinTeam" t ON t."teamId" = d."teamId" AND t."eventId" = d."eventId"
      LEFT JOIN "forcemultiplier"."FunraisinEvent" e ON e.id = d."eventId"
      WHERE d."salesforceId" = s."salesforceId" AND d.status = 'paid'
        AND d.amount > COALESCE(d."refundAmount", 0) ${eventFilter}
      ORDER BY d."donatedAt" DESC NULLS LAST, d."donationId"::numeric DESC LIMIT 1
    ) latest ON TRUE
    ORDER BY s."salesforceId"
  `);
  const done = rows.length <= limit;
  if (!done) rows.pop();
  const records = await enrich(
    rows.map((row) => ({
      Id: row.Id,
      FunraisinEventName: row.event ?? "",
      FunraisinUsername: row.username ?? "",
      FunraisinEventKey: row.eventKey ?? "",
      FunraisinFundraisingUrl: funraisinFundraisingUrl(
        config.baseUrl,
        row.username,
        row.eventKey,
      ),
      FunraisinDonationCount: Number(row.count),
      FunraisinDonationTotal: row.amount,
      FunraisinLastDonatedAt: row.donatedAt?.toISOString().slice(0, 10) ?? "",
      FunraisinLastDonatedToName: row.target ?? "",
    })),
    [],
  );
  const latest = await funraisinAudienceConnection(config.orgId);
  if (latest.version !== config.version)
    throw new AppError(
      "Funraisin data changed during extraction. Restart this pull.",
      409,
    );
  const totalSize = Number(rows[0]?.total ?? 0);
  return {
    records,
    totalSize,
    done,
    nextRecordsUrl: done
      ? undefined
      : JSON.stringify({ after: rows.at(-1)!.Id, version: config.version }),
  };
}
