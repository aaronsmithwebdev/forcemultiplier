import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, type ResubscribeJob } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { AppError, publicError } from "./errors";
import { connection, providerRequest, SF_VERSION } from "./providers";
import { describe } from "./salesforce";
import { quote } from "./soql";
import { normalizedEmail } from "./email";
import {
  matchesResubscribeFilters,
  resubscribePayload,
  RESUBSCRIBE_CALL_LIMIT,
  RESUBSCRIBE_DAILY_LIMIT,
  RESUBSCRIBE_MAX_ROWS,
} from "./resubscribe-input";

const field = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
  .max(100)
  .nullable()
  .default(null);
export const resubscribeJobInput = z.object({
  name: z.string().trim().min(1).max(120),
  listId: z.uuid(),
  presentField: field,
  amountField: field,
  minimumAmount: z.number().finite().min(0).nullable().default(null),
});
const utcDay = () => new Date().toISOString().slice(0, 10);
const clientKey = (clientId: string) =>
  createHash("sha256").update(clientId).digest("hex");
const numericTypes = ["currency", "double", "int", "percent"];
const pending = ["queued", "checking", "writing"];

export async function createResubscribeJob(
  input: z.infer<typeof resubscribeJobInput>,
) {
  const cc = await connection("constant-contact");
  if (!cc.tokens || !cc.externalId)
    throw new AppError("Connect Constant Contact first.", 409);
  let orgId: string | null = null;
  if (input.presentField || input.amountField) {
    const sf = await connection("salesforce");
    if (!sf.tokens || !sf.externalId)
      throw new AppError("Connect Salesforce to use filters.", 409);
    orgId = sf.externalId;
    const metadata = await describe("Contact");
    for (const name of [input.presentField, input.amountField].filter(
      Boolean,
    )) {
      const selected = metadata.fields.find((f) => f.name === name);
      if (
        !selected ||
        (name === input.amountField
          ? !numericTypes.includes(selected.type)
          : ![
              "string",
              "textarea",
              "picklist",
              "multipicklist",
              "boolean",
              ...numericTypes,
            ].includes(selected.type))
      )
        throw new AppError(
          `Field ${name} is unavailable or has an unsupported type.`,
        );
    }
    if (input.amountField && input.minimumAmount === null)
      throw new AppError("Enter a donation threshold.");
  }
  const list = await providerRequest(
    "constant-contact",
    `/v3/contact_lists/${input.listId}`,
    {},
    { externalId: cc.externalId },
  );
  return db.resubscribeJob.create({
    data: {
      ...input,
      orgId,
      accountId: cc.externalId,
      clientKey: clientKey(cc.clientId),
      listName: list.name,
    },
  });
}

export async function uploadResubscribeChunk(
  id: string,
  index: number,
  values: string[],
) {
  const emails = values.map(normalizedEmail);
  if (emails.some((email) => !email))
    throw new AppError("The upload contains an invalid email address.");
  return db.$transaction(async (tx) => {
    // Updating first locks the job, making upload retries and the row ceiling atomic.
    const claimed = await tx.resubscribeJob.updateMany({
      where: {
        id,
        status: "uploading",
        nextChunk: index,
        uploaded: { lte: RESUBSCRIBE_MAX_ROWS - values.length },
      },
      data: {
        nextChunk: { increment: 1 },
        uploaded: { increment: values.length },
      },
    });
    if (!claimed.count) {
      const job = await tx.resubscribeJob.findUnique({ where: { id } });
      if (job?.status === "uploading" && job.nextChunk > index)
        return { ok: true };
      throw new AppError(
        "Upload is out of order, complete, or exceeds 100,000 rows.",
        409,
      );
    }
    await tx.resubscribeMember.createMany({
      data: emails.map((email) => ({ jobId: id, email: email! })),
      skipDuplicates: true,
    });
    return { ok: true };
  });
}

export async function finishResubscribeUpload(id: string) {
  const job = await db.resubscribeJob.findUnique({ where: { id } });
  if (!job) throw new AppError("Job not found.", 404);
  if (job.status !== "uploading") return job;
  if (!job.uploaded) throw new AppError("Upload at least one email address.");
  return db.$transaction(async (tx) => {
    const claim = await tx.resubscribeJob.updateMany({
      where: { id, status: "uploading", nextChunk: job.nextChunk },
      data: { status: job.orgId ? "preparing" : "ready" },
    });
    if (!claim.count) throw new AppError("Upload changed. Try again.", 409);
    if (!job.orgId)
      await tx.resubscribeMember.updateMany({
        where: { jobId: id, status: "pending" },
        data: { status: "queued" },
      });
    return { ok: true };
  });
}

export async function setResubscribeStatus(
  id: string,
  action: "start" | "pause" | "cancel",
) {
  const job = await db.resubscribeJob.findUnique({ where: { id } });
  if (!job) throw new AppError("Job not found.", 404);
  if (action === "start") {
    if (!process.env.CRON_SECRET)
      throw new AppError(
        "Configure CRON_SECRET before starting scheduled processing.",
        503,
      );
    await checkAccounts(job);
  }
  const allowed =
    action === "start"
      ? ["ready", "paused"]
      : action === "pause"
        ? ["running"]
        : ["uploading", "preparing", "ready", "paused", "running"];
  const result = await db.resubscribeJob.updateMany({
    where: { id, status: { in: allowed } },
    data: {
      status:
        action === "start"
          ? "running"
          : action === "pause"
            ? "paused"
            : "cancelled",
      error: null,
    },
  });
  if (!result.count)
    throw new AppError("This job cannot make that transition.", 409);
  return { ok: true };
}

async function checkAccounts(job: ResubscribeJob) {
  const cc = await connection("constant-contact");
  if (
    !cc.tokens ||
    cc.externalId !== job.accountId ||
    clientKey(cc.clientId) !== job.clientKey
  )
    throw new AppError(
      "Reconnect the Constant Contact account and application used for this upload.",
      409,
    );
  if (job.orgId) {
    const sf = await connection("salesforce");
    if (!sf.tokens || sf.externalId !== job.orgId)
      throw new AppError(
        "Reconnect the Salesforce org used for this upload.",
        409,
      );
  }
}

export async function resubscribeState(
  id?: string,
  status?: string,
  offset = 0,
) {
  if (id) {
    const job = await db.resubscribeJob.findUnique({ where: { id } });
    if (!job) throw new AppError("Job not found.", 404);
    const groups = await db.resubscribeMember.groupBy({
      by: ["status"],
      where: { jobId: id },
      _count: true,
    });
    const where = { jobId: id, ...(status ? { status } : {}) };
    return {
      ...job,
      counts: Object.fromEntries(groups.map((g) => [g.status, g._count])),
      total: await db.resubscribeMember.count({ where }),
      members: await db.resubscribeMember.findMany({
        where,
        orderBy: [{ priority: "desc" }, { email: "asc" }],
        skip: offset,
        take: 50,
      }),
    };
  }
  const cc = await db.connection.findUnique({
    where: { provider: "constant-contact" },
  });
  return {
    jobs: await db.resubscribeJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { _count: { select: { members: true } } },
    }),
    today: cc
      ? await db.resubscribeDay.findUnique({
          where: {
            clientKey_day: { clientKey: clientKey(cc.clientId), day: utcDay() },
          },
        })
      : null,
    schedulerReady: Boolean(process.env.CRON_SECRET),
  };
}

async function prepare(job: ResubscribeJob) {
  const rows = await db.resubscribeMember.findMany({
    where: { jobId: job.id, status: "pending" },
    orderBy: { email: "asc" },
    take: 200,
  });
  if (!rows.length) {
    await db.resubscribeJob.updateMany({
      where: { id: job.id, status: "preparing" },
      data: { status: "ready", error: null },
    });
    return false;
  }
  const fields = [
    ...new Set(
      [
        "Id",
        "Email",
        "Name",
        "HasOptedOutOfEmail",
        job.presentField,
        job.amountField,
      ].filter(Boolean),
    ),
  ];
  const query = `SELECT ${fields.join(",")} FROM Contact WHERE Email IN (${rows.map((r) => quote(r.email)).join(",")})`;
  const matches = new Map<string, Record<string, any>[]>();
  let cursor: string | undefined;
  do {
    const page = await providerRequest(
      "salesforce",
      cursor ||
        `/services/data/${SF_VERSION}/query?q=${encodeURIComponent(query)}`,
      {},
      { externalId: job.orgId!, timeoutMs: 8000 },
    );
    for (const record of page.records ?? []) {
      const email = normalizedEmail(record.Email);
      if (email) matches.set(email, [...(matches.get(email) ?? []), record]);
    }
    cursor = page.done ? undefined : page.nextRecordsUrl;
    if (!page.done && !cursor)
      throw new AppError("Salesforce returned an incomplete page.", 502);
  } while (cursor);
  await db.$transaction(
    rows.map((row) => {
      const records = matches.get(row.email) ?? [];
      const record = records.length === 1 ? records[0] : null;
      const { attributes, ...data } = record ?? {};
      return db.resubscribeMember.update({
        where: { jobId_email: { jobId: job.id, email: row.email } },
        data: {
          status: !record
            ? "unmatched"
            : matchesResubscribeFilters(record, job)
              ? "queued"
              : "excluded",
          salesforceId: record?.Id ?? null,
          data: data as Prisma.InputJsonValue,
          priority:
            job.amountField && typeof record?.[job.amountField] === "number"
              ? record[job.amountField]
              : 0,
          error: !record
            ? records.length
              ? "Multiple Salesforce contacts share this email."
              : "No Salesforce Contact matched this email."
            : null,
        },
      });
    }),
  );
  return true;
}

class WorkStopped extends Error {}

export async function reserveResubscribeContact(client: string, day: string) {
  await db.resubscribeDay.upsert({
    where: { clientKey_day: { clientKey: client, day } },
    create: { clientKey: client, day },
    update: {},
  });
  const result = await db.resubscribeDay.updateMany({
    where: {
      clientKey: client,
      day,
      contacts: { lt: RESUBSCRIBE_DAILY_LIMIT },
      calls: { lte: RESUBSCRIBE_CALL_LIMIT - 2 },
    },
    data: { contacts: { increment: 1 } },
  });
  return result.count === 1;
}

async function processContact(job: ResubscribeJob, lease: Date) {
  const row = await db.resubscribeMember.findFirst({
    where: {
      jobId: job.id,
      status: { in: pending },
      availableAt: { lte: new Date() },
    },
    orderBy: [{ priority: "desc" }, { email: "asc" }],
  });
  if (!row) {
    if (
      !(await db.resubscribeMember.count({
        where: { jobId: job.id, status: { in: pending } },
      }))
    )
      await db.resubscribeJob.updateMany({
        where: { id: job.id, status: "running" },
        data: { status: "completed", error: null },
      });
    return false;
  }
  const where = { jobId_email: { jobId: job.id, email: row.email } };
  // A process that died after starting a PUT must never blindly repeat that consent change.
  if (row.status === "writing") {
    await db.resubscribeMember.update({
      where,
      data: {
        status: "uncertain",
        error:
          "Processing stopped during the update. Check this contact in Constant Contact before a new request.",
        processedAt: new Date(),
      },
    });
    return true;
  }
  const day = utcDay();
  if (!(await reserveResubscribeContact(job.clientKey, day))) return false;
  await db.resubscribeMember.update({
    where,
    data: { status: "checking", attempts: { increment: 1 }, error: null },
  });
  let writing = false;
  const guard = {
    externalId: job.accountId,
    timeoutMs: 8000,
    beforeRequest: async () => {
      await delay(500); // Leave headroom under Constant Contact's 4 requests/second limit.
      const [owner, current] = await Promise.all([
        db.resubscribeWorker.findFirst({
          where: {
            id: "default",
            leaseUntil: lease,
            AND: { leaseUntil: { gt: new Date() } },
          },
        }),
        db.resubscribeJob.findUnique({ where: { id: job.id } }),
      ]);
      if (!owner || current?.status !== "running" || utcDay() !== day)
        throw new WorkStopped("Processing paused or the daily window changed.");
      const budget = await db.resubscribeDay.updateMany({
        where: {
          clientKey: job.clientKey,
          day,
          calls: { lt: RESUBSCRIBE_CALL_LIMIT },
        },
        data: { calls: { increment: 1 } },
      });
      if (!budget.count)
        throw new WorkStopped("Today's API budget is exhausted.");
    },
  };
  try {
    const params = new URLSearchParams({
      email: row.email,
      status: "active,unsubscribed",
      include: "list_memberships",
      limit: "2",
    });
    const result = await providerRequest(
      "constant-contact",
      `/v3/contacts?${params}`,
      {},
      guard,
    );
    if (!Array.isArray(result.contacts))
      throw new AppError(
        "Constant Contact returned an incomplete response.",
        502,
      );
    const contacts = result.contacts.filter(
      (c: any) => normalizedEmail(c.email_address?.address) === row.email,
    );
    const contact =
      contacts.length === 1 && !result._links?.next ? contacts[0] : null;
    let reason: string | null = null;
    if (!contact)
      reason = contacts.length
        ? "Ambiguous Constant Contact match."
        : "No active or unsubscribed Constant Contact record found.";
    else if (contact.email_address.permission_to_send !== "unsubscribed")
      reason = "Already subscribed; no changes made.";
    else if (
      contact.email_address.opt_out_date &&
      new Date(contact.email_address.opt_out_date) > job.createdAt
    )
      reason =
        "Contact unsubscribed after this job was created; no changes made.";
    if (reason) {
      await db.resubscribeMember.update({
        where,
        data: { status: "skipped", error: reason, processedAt: new Date() },
      });
      return true;
    }
    const id = z.uuid().parse(contact.contact_id);
    const payload = resubscribePayload(contact, job.listId);
    await db.resubscribeMember.update({
      where,
      data: { status: "writing", contactId: id },
    });
    writing = true;
    const updated = await providerRequest(
      "constant-contact",
      `/v3/contacts/${id}`,
      { method: "PUT", body: JSON.stringify(payload) },
      guard,
    );
    if (
      updated.contact_id !== id ||
      normalizedEmail(updated.email_address?.address) !== row.email ||
      updated.email_address?.permission_to_send !== "explicit"
    )
      throw new AppError(
        "Constant Contact did not confirm explicit email permission.",
        502,
      );
    await db.resubscribeMember.update({
      where,
      data: { status: "completed", processedAt: new Date(), error: null },
    });
    return true;
  } catch (error) {
    const stopped = error instanceof WorkStopped;
    const message = stopped ? error.message : publicError(error).error;
    await db.resubscribeMember.update({
      where,
      data: {
        status: writing ? "uncertain" : row.attempts >= 4 ? "failed" : "queued",
        error: writing ? `Update outcome needs review: ${message}` : message,
        availableAt: new Date(
          Date.now() +
            (stopped ? 60000 : Math.min(3600, 60 * 2 ** row.attempts) * 1000),
        ),
        processedAt: writing || row.attempts >= 4 ? new Date() : null,
      },
    });
    if (error instanceof AppError && [403, 409, 429].includes(error.status))
      throw error;
    return !stopped;
  }
}

export async function runResubscriptions() {
  const deadline = Date.now() + 20000;
  await db.resubscribeWorker.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  const lease = new Date(Date.now() + 120000);
  // ponytail: one worker for this small workspace; partition by API key if throughput grows.
  const claimed = await db.resubscribeWorker.updateMany({
    where: {
      id: "default",
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: lease },
  });
  if (!claimed.count) return { ran: false };
  let processed = 0;
  try {
    const jobs = await db.resubscribeJob.findMany({
      where: { status: { in: ["preparing", "running"] } },
      orderBy: { updatedAt: "asc" },
      take: 10,
    });
    for (const job of jobs) {
      if (Date.now() >= deadline) break;
      try {
        await checkAccounts(job);
        if (job.status === "preparing") {
          for (let batch = 0; batch < 10 && Date.now() < deadline; batch++)
            if (!(await prepare(job))) break;
        } else
          while (Date.now() < deadline) {
            const current = await db.resubscribeJob.findUnique({
              where: { id: job.id },
            });
            if (
              current?.status !== "running" ||
              !(await processContact(job, lease))
            )
              break;
            processed++;
          }
        await db.resubscribeJob.updateMany({
          where: { id: job.id, status: job.status },
          data: { error: null },
        });
      } catch (error) {
        await db.resubscribeJob.updateMany({
          where: { id: job.id, status: job.status },
          data: {
            error: publicError(error).error,
            ...(job.status === "running" &&
            error instanceof AppError &&
            [403, 409].includes(error.status)
              ? { status: "paused" }
              : {}),
          },
        });
      }
    }
    return { ran: true, processed };
  } finally {
    await db.resubscribeWorker.updateMany({
      where: { id: "default", leaseUntil: lease },
      data: { leaseUntil: null },
    });
  }
}
