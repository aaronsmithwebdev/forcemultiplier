import { Prisma } from "@prisma/client";
import { db } from "./db";
import { publicError } from "./errors";
import {
  deleteResendContact,
  getResendContact,
  type ResendContact,
} from "./resend";

const SETTINGS_ID = "workspace";
const BATCH_SIZE = 50;
const LEASE_MS = 90_000;
const IDLE_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;

type Candidate = { email: string; lastActivityAt: Date };
type Provider = {
  get: (email: string) => Promise<ResendContact | null>;
  delete: (email: string) => Promise<void>;
};

const provider: Provider = {
  get: getResendContact,
  delete: deleteResendContact,
};

async function settings() {
  return db.workspaceSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
}

export function resendRetentionCutoff(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function resendRetentionState() {
  const row = await settings();
  return {
    retentionDays: row.resendContactRetentionDays,
    lastRunAt: row.resendCleanupLastRunAt,
    lastDeleted: row.resendCleanupLastDeleted,
    error: row.resendCleanupError,
    schedulerReady: Boolean(process.env.CRON_SECRET),
  };
}

export async function saveResendRetentionDays(retentionDays: number) {
  await settings();
  await db.workspaceSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      resendContactRetentionDays: retentionDays,
      resendCleanupNextRunAt: null,
      resendCleanupError: null,
    },
  });
  return resendRetentionState();
}

async function candidates(cutoff: Date) {
  return db.$queryRaw<Candidate[]>(Prisma.sql`
    WITH contact_history AS (
      SELECT lower(r.email) AS email,
        max(CASE WHEN s.status = 'sent'
          THEN coalesce(s."finishedAt", s."updatedAt") END) AS "lastSentAt",
        max(CASE WHEN s."importId" IS NOT NULL
          THEN s."updatedAt" END) AS "lastImportedAt",
        max(r."providerContactDeletedAt") AS "lastDeletedAt",
        bool_or(s.status IN ('pending', 'importing', 'ready')) AS active
      FROM "forcemultiplier"."CampaignRecipient" r
      JOIN "forcemultiplier"."CampaignSend" s ON s.id = r."sendId"
      GROUP BY lower(r.email)
    )
    SELECT email,
      coalesce("lastSentAt", "lastImportedAt") AS "lastActivityAt"
    FROM contact_history
    WHERE "lastImportedAt" IS NOT NULL
      AND coalesce("lastSentAt", "lastImportedAt") < ${cutoff}
      AND NOT active
      AND (
        "lastDeletedAt" IS NULL OR
        "lastDeletedAt" < coalesce("lastSentAt", "lastImportedAt")
      )
    ORDER BY coalesce("lastSentAt", "lastImportedAt"), email
    LIMIT ${BATCH_SIZE}
  `);
}

async function preserveUnsubscribe(
  email: string,
  contact: ResendContact,
  recordedAt: Date,
) {
  if (!contact.unsubscribed) return;
  await db.$transaction([
    db.suppression.upsert({
      where: { email },
      create: {
        email,
        source: "resend",
        sourceRef: contact.id,
        occurredAt: recordedAt,
      },
      update: { revision: { increment: 1 } },
    }),
    db.suppressionEvent.createMany({
      data: [
        {
          dedupeKey: `resend_cleanup:${contact.id}:${recordedAt.toISOString()}`,
          email,
          direction: "resend_to_forcemultiplier",
          source: "resend",
          sourceRef: contact.id,
          occurredAt: recordedAt,
          recordedAt,
          processedAt: recordedAt,
        },
      ],
      skipDuplicates: true,
    }),
  ]);
}

export async function runResendContactCleanup(
  now = new Date(),
  resend: Provider = provider,
) {
  const current = await settings();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const acquired = await db.workspaceSettings.updateMany({
    where: {
      id: SETTINGS_ID,
      AND: [
        {
          OR: [
            { resendCleanupLeaseUntil: null },
            { resendCleanupLeaseUntil: { lte: now } },
          ],
        },
        {
          OR: [
            { resendCleanupNextRunAt: null },
            { resendCleanupNextRunAt: { lte: now } },
          ],
        },
      ],
    },
    data: {
      resendCleanupLeaseUntil: leaseUntil,
      resendCleanupLastRunAt: now,
      resendCleanupError: null,
    },
  });
  if (!acquired.count) return { idle: true, deleted: 0 };

  let deleted = 0;
  let interrupted = false;
  try {
    const rows = await candidates(
      resendRetentionCutoff(current.resendContactRetentionDays, now),
    );
    for (const row of rows) {
      const active = await db.workspaceSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      if (
        active?.resendCleanupLeaseUntil?.getTime() !== leaseUntil.getTime() ||
        leaseUntil.getTime() - Date.now() < 65000
      ) {
        interrupted = true;
        break;
      }
      const contact = await resend.get(row.email);
      if (contact) {
        await preserveUnsubscribe(row.email, contact, now);
        const owner = await db.workspaceSettings.findUnique({
          where: { id: SETTINGS_ID },
        });
        if (
          owner?.resendCleanupLeaseUntil?.getTime() !== leaseUntil.getTime() ||
          leaseUntil.getTime() - Date.now() < 35000
        ) {
          interrupted = true;
          break;
        }
        await resend.delete(row.email);
        deleted += 1;
      }
      await db.campaignRecipient.updateMany({
        where: { email: row.email },
        data: { providerContactDeletedAt: now },
      });
    }
    await db.workspaceSettings.updateMany({
      where: { id: SETTINGS_ID, resendCleanupLeaseUntil: leaseUntil },
      data: {
        resendCleanupLeaseUntil: null,
        resendCleanupNextRunAt:
          interrupted || rows.length === BATCH_SIZE
            ? now
            : new Date(now.getTime() + IDLE_MS),
        resendCleanupLastDeleted: deleted,
      },
    });
    return { deleted, remaining: interrupted || rows.length === BATCH_SIZE };
  } catch (error) {
    const failure = publicError(error);
    await db.workspaceSettings.updateMany({
      where: { id: SETTINGS_ID, resendCleanupLeaseUntil: leaseUntil },
      data: {
        resendCleanupLeaseUntil: null,
        resendCleanupNextRunAt: new Date(now.getTime() + RETRY_MS),
        resendCleanupLastDeleted: deleted,
        resendCleanupError: failure.error.slice(0, 1000),
      },
    });
    throw error;
  }
}
