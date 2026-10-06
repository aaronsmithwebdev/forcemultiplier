import { Prisma, type MarketingResubscription } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { normalizedEmail } from "./email";
import { AppError, publicError } from "./errors";
import { marketingConsentReadiness } from "./consent-readiness";
import { connection, providerRequest, SF_VERSION } from "./providers";
import { hash } from "./security";
import { quote, sfId } from "./soql";
import {
  assertNoResendSuppression,
  createBlockedResendContact,
  getResendContact,
  resubscribeResendContact,
} from "./resend";

export const marketingResubscriptionInput = z.object({
  id: z.uuid(),
  email: z.string().trim().max(254).transform(normalizedEmail).refine(Boolean),
  consentAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .refine(
      (value) => value.getTime() <= Date.now(),
      "Consent cannot be in the future.",
    ),
  source: z.string().trim().min(3).max(200),
  evidence: z.string().trim().min(10).max(4000),
  scope: z.literal("all_workspace_marketing"),
  confirmed: z.literal(true),
});
const marketingKinds = ["global_unsubscribe", "marketing_unsubscribe"];
const outbound = "forcemultiplier_to_salesforce";

export function marketingResubscriptionState() {
  return db.marketingResubscription.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    omit: { resendKeyHash: true },
  });
}

// ponytail: serialize staff-assisted requests with existing sync/cleanup leases;
// move to fenced per-contact jobs if resubscription volume requires concurrency.
async function withConsentLease<T>(
  operation: (guard: () => Promise<void>) => Promise<T>,
) {
  const lease = new Date(Date.now() + 300_000);
  await db.$transaction(async (tx) => {
    const sync = await tx.salesforceSuppressionSync.updateMany({
      where: {
        id: "salesforce",
        enabled: true,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseUntil: lease },
    });
    if (!sync.count)
      throw new AppError(
        "Consent sync is busy. Try again after it finishes.",
        409,
      );
    await tx.workspaceSettings.upsert({
      where: { id: "workspace" },
      create: { id: "workspace" },
      update: {},
    });
    const cleanup = await tx.workspaceSettings.updateMany({
      where: {
        id: "workspace",
        OR: [
          { resendCleanupLeaseUntil: null },
          { resendCleanupLeaseUntil: { lt: new Date() } },
        ],
      },
      data: { resendCleanupLeaseUntil: lease },
    });
    if (!cleanup.count)
      throw new AppError(
        "Contact cleanup is busy. Try again after it finishes.",
        409,
      );
  });
  const guard = async () => {
    const [sync, cleanup] = await Promise.all([
      db.salesforceSuppressionSync.findUnique({ where: { id: "salesforce" } }),
      db.workspaceSettings.findUnique({ where: { id: "workspace" } }),
    ]);
    if (
      lease.getTime() - Date.now() < 35_000 ||
      sync?.leaseUntil?.getTime() !== lease.getTime() ||
      cleanup?.resendCleanupLeaseUntil?.getTime() !== lease.getTime()
    )
      throw new AppError(
        "Consent processing lease expired. The address remains blocked; verify the result before continuing.",
        409,
      );
  };
  try {
    return await operation(guard);
  } finally {
    await db.$transaction([
      db.salesforceSuppressionSync.updateMany({
        where: { id: "salesforce", leaseUntil: lease },
        data: { leaseUntil: null },
      }),
      db.workspaceSettings.updateMany({
        where: { id: "workspace", resendCleanupLeaseUntil: lease },
        data: { resendCleanupLeaseUntil: null },
      }),
    ]);
  }
}

async function assertLocalConsent(
  tx: Prisma.TransactionClient,
  job: MarketingResubscription,
) {
  const [block, event, legacy, newer] = await Promise.all([
    tx.suppression.findUnique({ where: { email: job.email } }),
    tx.suppressionEvent.findFirst({
      where: {
        email: job.email,
        direction: { not: outbound },
        OR: [
          { recordedAt: { gte: job.createdAt } },
          { occurredAt: { gte: job.consentAt } },
        ],
      },
    }),
    tx.unsubscribeEvent.findFirst({
      where: {
        email: { equals: job.email, mode: "insensitive" },
        OR: [
          { discoveredAt: { gte: job.createdAt } },
          { optOutAt: { gte: job.consentAt } },
        ],
      },
    }),
    tx.marketingResubscription.findFirst({
      where: {
        email: job.email,
        id: { not: job.id },
        createdAt: { gte: job.createdAt },
      },
    }),
  ]);
  if (!block || !marketingKinds.includes(block.kind))
    throw new AppError(
      "The local block changed or is a delivery block. Manual review is required.",
      409,
    );
  if (
    block.revision !== job.suppressionRevision ||
    event ||
    legacy ||
    newer ||
    (block.source !== "marketing_resubscription" &&
      (block.occurredAt ?? block.createdAt) >= job.consentAt)
  )
    throw new AppError(
      "An opt-out is newer than this consent, or another consent change was received during processing. The address remains blocked; obtain a new explicit request.",
      409,
    );
}

async function assertContext(
  job: MarketingResubscription,
  guard: () => Promise<void>,
) {
  await guard();
  const ready = await marketingConsentReadiness();
  if (!ready.ready) throw new AppError(ready.reason!, 409);
  const legacy = await db.unsubscribeSync.findUnique({
    where: { id: "default" },
  });
  if (legacy?.enabled || (legacy?.leaseUntil && legacy.leaseUntil > new Date()))
    throw new AppError(
      "Disable legacy Constant Contact unsubscribe writeback and wait for its worker to finish before restoring marketing consent.",
      409,
    );
  const account = await connection("salesforce");
  if (
    account.externalId !== job.orgId ||
    hash(process.env.RESEND_API_KEY?.trim() ?? "") !== job.resendKeyHash
  )
    throw new AppError(
      "The connected Salesforce org or Resend key changed. The address remains blocked.",
      409,
    );
  await assertLocalConsent(db, job);
}

async function salesforceContact(
  job: MarketingResubscription,
  guard: () => Promise<void>,
) {
  const query = `SELECT Id, Email, HasOptedOutOfEmail, LastModifiedDate FROM Contact WHERE Email = ${quote(job.email)} LIMIT 2`;
  const page = await providerRequest(
    "salesforce",
    `/services/data/${SF_VERSION}/query?q=${encodeURIComponent(query)}`,
    {},
    { externalId: job.orgId, beforeRequest: guard, timeoutMs: 10000 },
  );
  const record = page?.records?.[0];
  if (
    page?.done !== true ||
    !Array.isArray(page.records) ||
    page.records.length !== 1 ||
    !sfId(record?.Id) ||
    normalizedEmail(record.Email) !== job.email ||
    typeof record.HasOptedOutOfEmail !== "boolean" ||
    !Number.isFinite(Date.parse(record.LastModifiedDate)) ||
    (job.salesforceId && job.salesforceId !== record.Id)
  )
    throw new AppError(
      "Exactly one unchanged Salesforce Contact must match this address. Resolve missing, duplicate, or changed contacts first.",
      409,
    );
  return record as {
    Id: string;
    HasOptedOutOfEmail: boolean;
    LastModifiedDate: string;
  };
}

// Leave room between this workflow's Resend calls for the default API rate limit.
// Other workers can still exhaust the shared quota; those failures stay blocked.
async function resendConsentRequest<T>(
  job: MarketingResubscription,
  guard: () => Promise<void>,
  request: () => Promise<T>,
) {
  await new Promise((resolve) => setTimeout(resolve, 600));
  await assertContext(job, guard);
  return request();
}

async function verifyAndRelease(
  job: MarketingResubscription,
  guard: () => Promise<void>,
) {
  await assertContext(job, guard);
  const sf = await salesforceContact(job, guard);
  const contact = await resendConsentRequest(job, guard, () =>
    getResendContact(job.email),
  );
  if (
    !job.salesforceId ||
    sf.HasOptedOutOfEmail ||
    !contact ||
    contact.id !== job.resendContactId ||
    normalizedEmail(contact.email) !== job.email ||
    contact.unsubscribed
  )
    throw new AppError(
      "Salesforce and Resend have not both confirmed subscription for the original contacts. The address remains blocked.",
      409,
    );
  await resendConsentRequest(job, guard, () =>
    assertNoResendSuppression(job.email),
  );
  await assertContext(job, guard);
  return db.$transaction(
    async (tx) => {
      await assertLocalConsent(tx, job);
      const released = await tx.suppression.deleteMany({
        where: {
          email: job.email,
          revision: job.suppressionRevision,
          kind: { in: marketingKinds },
        },
      });
      if (!released.count)
        throw new AppError(
          "A concurrent opt-out changed the block. The address remains blocked.",
          409,
        );
      return tx.marketingResubscription.update({
        where: { id: job.id },
        data: { status: "completed", completedAt: new Date(), error: null },
        omit: { resendKeyHash: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function createMarketingResubscription(
  input: z.infer<typeof marketingResubscriptionInput>,
  userId: string,
) {
  const existing = await db.marketingResubscription.findUnique({
    where: { id: input.id },
    omit: { resendKeyHash: true },
  });
  if (existing) {
    if (
      existing.email !== input.email ||
      existing.consentAt.getTime() !== input.consentAt.getTime() ||
      existing.source !== input.source ||
      existing.evidence !== input.evidence ||
      existing.scope !== input.scope
    )
      throw new AppError(
        "This request ID already records different consent. Review its result before starting another request.",
        409,
      );
    return existing; // A lost HTTP response never repeats an opt-in write.
  }
  return withConsentLease(async (guard) => {
    const account = await connection("salesforce");
    if (!account.externalId)
      throw new AppError("Connect Salesforce first.", 409);
    const job = await db.$transaction(
      async (tx) => {
        const prior = await tx.marketingResubscription.findFirst({
          where: { email: input.email! },
          orderBy: { createdAt: "desc" },
        });
        if (prior && input.consentAt <= prior.createdAt)
          throw new AppError(
            "This consent was already used. Verify the existing request, or record a new explicit request from the person.",
            409,
          );
        const row = await tx.marketingResubscription.create({
          data: {
            id: input.id,
            email: input.email!,
            consentAt: input.consentAt,
            source: input.source,
            evidence: input.evidence,
            scope: input.scope,
            createdBy: userId,
            orgId: account.externalId!,
            resendKeyHash: hash(process.env.RESEND_API_KEY?.trim() ?? ""),
          },
        });
        const block = await tx.suppression.upsert({
          where: { email: row.email },
          create: {
            email: row.email,
            source: "marketing_resubscription",
            sourceRef: row.id,
            createdBy: userId,
          },
          update: {},
        });
        await tx.suppressionEvent.updateMany({
          where: {
            email: row.email,
            direction: outbound,
            status: {
              in: ["queued", "pending", "failed", "unmatched", "ambiguous"],
            },
          },
          data: {
            status: "superseded",
            error: "Held by an explicit marketing resubscription request.",
            processedAt: new Date(),
          },
        });
        return tx.marketingResubscription.update({
          where: { id: row.id },
          data: {
            suppressionRevision: block.revision,
            previousSuppression: JSON.parse(JSON.stringify(block)),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return reconcile(job, guard);
  });
}

async function markWriteStarted(job: MarketingResubscription) {
  if (job.writeStartedAt) return;
  job.writeStartedAt = new Date();
  await db.marketingResubscription.update({
    where: { id: job.id },
    data: { writeStartedAt: job.writeStartedAt },
  });
}

async function reconcile(
  job: MarketingResubscription,
  guard: () => Promise<void>,
) {
  try {
    await assertContext(job, guard);
    const sf = await salesforceContact(job, guard);
    await resendConsentRequest(job, guard, () =>
      assertNoResendSuppression(job.email),
    );
    let contact = await resendConsentRequest(job, guard, () =>
      getResendContact(job.email),
    );
    if (!contact) {
      await assertContext(job, guard);
      await markWriteStarted(job);
      // Retention may have removed it. Recreate blocked, then explicitly reconcile.
      contact = await resendConsentRequest(job, guard, () =>
        createBlockedResendContact(job.email),
      );
    }
    if (normalizedEmail(contact.email) !== job.email)
      throw new AppError("Resend returned a different contact address.", 409);
    if (sf.HasOptedOutOfEmail && new Date(sf.LastModifiedDate) >= job.consentAt)
      throw new AppError(
        "Salesforce changed this opted-out contact after the recorded consent. Review the change and obtain a new explicit request.",
        409,
      );
    Object.assign(job, { salesforceId: sf.Id, resendContactId: contact.id });
    await db.marketingResubscription.update({
      where: { id: job.id },
      data: { salesforceId: sf.Id, resendContactId: contact.id },
    });
    if (sf.HasOptedOutOfEmail) {
      await assertContext(job, guard);
      await markWriteStarted(job);
      await providerRequest(
        "salesforce",
        `/services/data/${SF_VERSION}/sobjects/Contact/${sf.Id}`,
        {
          method: "PATCH",
          headers: {
            "If-Unmodified-Since": new Date(sf.LastModifiedDate).toUTCString(),
          },
          body: JSON.stringify({ HasOptedOutOfEmail: false }),
        },
        {
          externalId: job.orgId,
          beforeRequest: () => assertContext(job, guard),
          timeoutMs: 10000,
        },
      );
    }
    if (contact.unsubscribed) {
      await assertContext(job, guard);
      await markWriteStarted(job);
      // Never automatically replay this write after an ambiguous provider result.
      await resendConsentRequest(job, guard, () =>
        resubscribeResendContact(contact!.id),
      );
    }
    return await verifyAndRelease(job, guard);
  } catch (error) {
    return db.marketingResubscription.update({
      where: { id: job.id },
      data: { status: "needs_review", error: publicError(error).error },
      omit: { resendKeyHash: true },
    });
  }
}

export async function verifyMarketingResubscription(id: string) {
  return withConsentLease(async (guard) => {
    const job = await db.marketingResubscription.findUniqueOrThrow({
      where: { id },
    });
    if (job.status === "completed")
      return db.marketingResubscription.findUniqueOrThrow({
        where: { id },
        omit: { resendKeyHash: true },
      });
    try {
      return await verifyAndRelease(job, guard);
    } catch (error) {
      return db.marketingResubscription.update({
        where: { id },
        data: { status: "needs_review", error: publicError(error).error },
        omit: { resendKeyHash: true },
      });
    }
  });
}

// Retry preflight only when no provider mutation has ever been attempted.
export async function retryMarketingResubscription(id: string) {
  return withConsentLease(async (guard) => {
    const job = await db.marketingResubscription.findUniqueOrThrow({
      where: { id },
    });
    if (job.status === "completed" || job.writeStartedAt)
      throw new AppError(
        "A provider write may already have happened. Use Verify result; subscription writes will not be repeated.",
        409,
      );
    return reconcile(job, guard);
  });
}
