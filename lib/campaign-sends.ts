import { Prisma } from "@prisma/client";
import type { TemplateContent } from "@templatical/types";
import { db } from "./db";
import { AppError, publicError } from "./errors";
import { renderCampaignHtml } from "./campaign-email";
import {
  resendStatus,
  createResendBroadcast,
  createResendContactImport,
  createResendSegment,
  getResendContactImport,
  sendResendBroadcast,
} from "./resend";

export type AudienceSelection = {
  audienceIds: string[];
  exclusionAudienceIds: string[];
  manualExclusions: string[];
};

type RecipientRow = {
  email: string;
  name: string | null;
  salesforceId: string | null;
  sourceRows: bigint;
  optedOut: boolean;
  audienceExcluded: boolean;
  suppressed: boolean;
};

const active = ["pending", "importing", "ready"];

export function uniqueEmails(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()))].filter(
    Boolean,
  );
}

export function prepareBroadcastHtml(html: string) {
  let prepared = html
    .replace(
      /\{\{\s*contact\.FirstName\s*\}\}/g,
      "{{{contact.first_name|there}}}",
    )
    .replace(/\{\{\s*contact\.LastName\s*\}\}/g, "{{{contact.last_name}}}")
    .replace(/\{\{\s*contact\.Email\s*\}\}/g, "{{{contact.email}}}")
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, "{{{RESEND_UNSUBSCRIBE_URL}}}");
  const unsupported = [
    ...prepared.matchAll(
      /(?<!\{)\{\{(?!\{)\s*contact\.([A-Za-z0-9_.]+)\s*\}\}(?!\})/g,
    ),
  ].map((match) => match[1]);
  if (unsupported.length)
    throw new AppError(
      `This campaign uses merge fields that are not ready for broadcast: ${[...new Set(unsupported)].join(", ")}. Remove them or use FirstName, LastName, and Email.`,
      409,
    );
  if (!prepared.includes("RESEND_UNSUBSCRIBE_URL")) {
    const footer =
      '<p style="font-size:12px;color:#666;text-align:center"><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a></p>';
    prepared = prepared.includes("</body>")
      ? prepared.replace("</body>", `${footer}</body>`)
      : `${prepared}${footer}`;
  }
  return prepared;
}

async function resolveRuns(ids: string[], label: string) {
  if (!ids.length) return [];
  const audiences = await db.audience.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      runs: {
        where: { status: "completed" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (
    audiences.length !== ids.length ||
    audiences.some((audience) => !audience.runs[0])
  )
    throw new AppError(
      `Every ${label} audience needs a completed Salesforce snapshot.`,
      409,
    );
  const byId = new Map(
    audiences.map((audience) => [audience.id, audience.runs[0]!.id]),
  );
  return ids.map((id) => byId.get(id)!);
}

async function recipientRows(
  includeRunIds: string[],
  excludeRunIds: string[],
  manual: string[],
) {
  if (!includeRunIds.length) return [];
  const excludedRuns = excludeRunIds.length
    ? Prisma.sql`AND x."runId" IN (${Prisma.join(excludeRunIds)})`
    : Prisma.sql`AND FALSE`;
  const manualMatch = manual.length
    ? Prisma.sql`i.email IN (${Prisma.join(manual)})`
    : Prisma.sql`FALSE`;
  return db.$queryRaw<RecipientRow[]>(Prisma.sql`
    WITH included AS (
      SELECT m."normalizedEmail" AS email,
        MIN(m.name) AS name,
        MIN(m."salesforceId") AS "salesforceId",
        COUNT(*) AS "sourceRows",
        BOOL_OR(m."optedOut") AS "optedOut"
      FROM "forcemultiplier"."AudienceMember" m
      WHERE m."runId" IN (${Prisma.join(includeRunIds)})
        AND m."normalizedEmail" IS NOT NULL
      GROUP BY m."normalizedEmail"
    )
    SELECT i.*,
      EXISTS (
        SELECT 1 FROM "forcemultiplier"."AudienceMember" x
        WHERE x."normalizedEmail" = i.email ${excludedRuns}
      ) AS "audienceExcluded",
      (${manualMatch} OR EXISTS (
        SELECT 1 FROM "forcemultiplier"."UnsubscribeEvent" u
        WHERE LOWER(u.email) = i.email
      )) AS suppressed
    FROM included i
    ORDER BY i.email
  `);
}

function summary(rows: RecipientRow[]) {
  const counts = {
    source: 0,
    duplicates: 0,
    optedOut: 0,
    excluded: 0,
    suppressed: 0,
    recipients: 0,
  };
  for (const row of rows) {
    const sourceRows = Number(row.sourceRows);
    counts.source += sourceRows;
    counts.duplicates += Math.max(0, sourceRows - 1);
    if (row.optedOut) counts.optedOut++;
    else if (row.audienceExcluded) counts.excluded++;
    else if (row.suppressed) counts.suppressed++;
    else counts.recipients++;
  }
  return counts;
}

export async function campaignAudienceOptions(campaignId: string) {
  const [campaign, audiences] = await Promise.all([
    db.campaign.findUnique({
      where: { id: campaignId },
      select: {
        audienceIds: true,
        exclusionAudienceIds: true,
        manualExclusions: true,
        send: {
          select: {
            id: true,
            status: true,
            counts: true,
            error: true,
            finishedAt: true,
          },
        },
      },
    }),
    db.audience.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        runs: {
          where: { status: "completed" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, processed: true, finishedAt: true },
        },
      },
    }),
  ]);
  if (!campaign) throw new AppError("Campaign not found.", 404);
  return {
    ...campaign,
    audiences: audiences.map((audience) => ({
      id: audience.id,
      name: audience.name,
      snapshot: audience.runs[0] || null,
    })),
  };
}

export async function saveAndPreviewCampaignAudience(
  campaignId: string,
  selection: AudienceSelection,
) {
  const audienceIds = [...new Set(selection.audienceIds)];
  const exclusionAudienceIds = [
    ...new Set(selection.exclusionAudienceIds),
  ].filter((id) => !audienceIds.includes(id));
  const manualExclusions = uniqueEmails(selection.manualExclusions);
  const [includeRunIds, excludeRunIds] = await Promise.all([
    resolveRuns(audienceIds, "included"),
    resolveRuns(exclusionAudienceIds, "excluded"),
  ]);
  const rows = await recipientRows(
    includeRunIds,
    excludeRunIds,
    manualExclusions,
  );
  await db.campaign.update({
    where: { id: campaignId },
    data: { audienceIds, exclusionAudienceIds, manualExclusions },
  });
  return summary(rows);
}

export async function startCampaignSend(campaignId: string, userId: string) {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { send: true },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);
  if (campaign.send) return campaign.send;
  if (!campaign.audienceIds.length)
    throw new AppError("Choose at least one audience.");
  if (!campaign.subject || !campaign.fromName || !campaign.fromEmail)
    throw new AppError("Complete Email settings before sending.", 409);
  if (campaign.replyToEmail.toLowerCase() !== campaign.fromEmail.toLowerCase())
    throw new AppError(
      "Resend Broadcasts reply to the From address. Make Reply-to match From before sending.",
      409,
    );
  const domain = campaign.fromEmail.split("@")[1]?.toLowerCase();
  const resend = await resendStatus();
  if (
    !resend.domains.some(
      (item: { sending: boolean; status: string; name: string }) =>
        item.sending &&
        item.status === "verified" &&
        item.name.toLowerCase() === domain,
    )
  )
    throw new AppError(
      "The From email must use a verified Resend sending domain.",
      409,
    );
  const [includeRunIds, excludeRunIds] = await Promise.all([
    resolveRuns(campaign.audienceIds, "included"),
    resolveRuns(campaign.exclusionAudienceIds, "excluded"),
  ]);
  try {
    return await db.campaignSend.create({
      data: {
        campaignId,
        content: campaign.content as Prisma.InputJsonValue,
        subject: campaign.subject,
        fromName: campaign.fromName,
        fromEmail: campaign.fromEmail,
        includeAudienceIds: campaign.audienceIds,
        excludeAudienceIds: campaign.exclusionAudienceIds,
        includeRunIds,
        excludeRunIds,
        manualExclusions: campaign.manualExclusions,
        createdBy: userId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.campaignSend.findUnique({
        where: { campaignId },
      });
      if (existing) return existing;
    }
    throw error;
  }
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function campaignSendStep(id?: string) {
  const send = id
    ? await db.campaignSend.findUnique({ where: { id } })
    : await db.campaignSend.findFirst({
        where: { status: { in: active } },
        orderBy: { createdAt: "asc" },
      });
  if (!send || !active.includes(send.status)) return send;
  const lease = new Date(Date.now() + 90_000);
  const acquired = await db.campaignSend.updateMany({
    where: {
      id: send.id,
      status: { in: active },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: lease, error: null },
  });
  if (!acquired.count)
    return db.campaignSend.findUnique({ where: { id: send.id } });
  try {
    if (send.status === "pending") {
      const rows = await recipientRows(
        send.includeRunIds,
        send.excludeRunIds,
        send.manualExclusions,
      );
      const counts = summary(rows);
      if (!counts.recipients)
        throw new AppError("No recipients remain after exclusions.", 409);
      const eligible = rows.filter(
        (row) => !row.optedOut && !row.audienceExcluded && !row.suppressed,
      );
      for (let offset = 0; offset < eligible.length; offset += 5000)
        await db.campaignRecipient.createMany({
          data: eligible.slice(offset, offset + 5000).map((row) => ({
            sendId: send.id,
            email: row.email,
            name: row.name,
            salesforceId: row.salesforceId,
          })),
          skipDuplicates: true,
        });
      let segmentId = send.segmentId;
      if (!segmentId) {
        const campaign = await db.campaign.findUniqueOrThrow({
          where: { id: send.campaignId },
          select: { name: true },
        });
        segmentId = await createResendSegment(
          `${campaign.name} · ${send.id.slice(-6)}`,
        );
        await db.campaignSend.update({
          where: { id: send.id },
          data: {
            segmentId,
            counts: counts as unknown as Prisma.InputJsonValue,
          },
        });
      }
      const recipients = await db.campaignRecipient.findMany({
        where: { sendId: send.id },
        orderBy: { email: "asc" },
      });
      const csv = [
        "Email,First Name,Last Name",
        ...recipients.map((recipient) => {
          const parts = (recipient.name || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          return [recipient.email, parts[0] || "", parts.slice(1).join(" ")]
            .map(csvCell)
            .join(",");
        }),
      ].join("\n");
      const importId = await createResendContactImport(segmentId, csv);
      return db.campaignSend.update({
        where: { id: send.id },
        data: {
          status: "importing",
          importId,
          counts: counts as unknown as Prisma.InputJsonValue,
          leaseUntil: null,
        },
      });
    }
    if (send.status === "importing") {
      if (!send.importId || !send.segmentId)
        throw new AppError("The Resend import state is incomplete.", 409);
      const contactImport = await getResendContactImport(send.importId);
      if (["pending", "processing"].includes(String(contactImport.status)))
        return db.campaignSend.update({
          where: { id: send.id },
          data: { leaseUntil: null },
        });
      if (
        contactImport.status !== "completed" ||
        Number(contactImport.counts?.failed) > 0
      )
        throw new AppError(
          `Resend could not import every recipient${contactImport.counts?.failed ? ` (${contactImport.counts.failed} failed)` : ""}. Nothing was sent.`,
          409,
        );
      const campaign = await db.campaign.findUniqueOrThrow({
        where: { id: send.campaignId },
        select: { name: true },
      });
      const rendered = await renderCampaignHtml(
        send.content as unknown as TemplateContent,
      );
      const broadcastId = await createResendBroadcast({
        segmentId: send.segmentId,
        name: campaign.name,
        from: `${send.fromName} <${send.fromEmail}>`,
        subject: send.subject,
        html: prepareBroadcastHtml(rendered),
      });
      return db.campaignSend.update({
        where: { id: send.id },
        data: { status: "ready", broadcastId, leaseUntil: null },
      });
    }
    if (!send.broadcastId)
      throw new AppError("The Resend broadcast is missing.", 409);
    await sendResendBroadcast(send.broadcastId);
    await db.$transaction([
      db.campaignRecipient.updateMany({
        where: { sendId: send.id },
        data: { status: "submitted" },
      }),
      db.campaign.update({
        where: { id: send.campaignId },
        data: { status: "sent" },
      }),
      db.campaignSend.update({
        where: { id: send.id },
        data: { status: "sent", finishedAt: new Date(), leaseUntil: null },
      }),
    ]);
    return db.campaignSend.findUnique({ where: { id: send.id } });
  } catch (error) {
    await db.campaignSend.updateMany({
      where: { id: send.id, leaseUntil: lease },
      data: {
        status: send.status === "ready" ? "review" : "failed",
        error: publicError(error).error,
        leaseUntil: null,
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}
