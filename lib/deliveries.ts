import { Prisma } from "@prisma/client";
import { db } from "./db";
import { AppError, publicError } from "./errors";
import { connection, providerRequest } from "./providers";

const active = ["pending", "running", "paused"];
type Batch = {
  cursor: string;
  processed: number;
  submitted: number;
  skipped: number;
};

export function importContact(member: {
  email: string | null;
  optedOut: boolean;
  data: unknown;
}) {
  const email = member.email?.trim();
  if (
    member.optedOut ||
    !email ||
    email.length > 50 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    return null;
  const data = member.data as Record<string, unknown>;
  return {
    email,
    ...(data.FirstName
      ? { first_name: String(data.FirstName).slice(0, 50) }
      : {}),
    ...(data.LastName ? { last_name: String(data.LastName).slice(0, 50) } : {}),
  };
}

export async function startDelivery(audienceId: string, listId: string) {
  const config = await connection("constant-contact");
  if (!config.tokens || !config.externalId)
    throw new AppError("Connect Constant Contact first.", 409);
  const source = await db.pullRun.findFirst({
    where: { audienceId, status: "completed" },
    orderBy: { createdAt: "desc" },
  });
  if (!source)
    throw new AppError("Complete a Salesforce pull before sending.", 409);
  const total = await db.audienceMember.count({
    where: { runId: source.id },
  });
  if (!total) throw new AppError("This audience has no contacts to send.");
  const list = await providerRequest(
    "constant-contact",
    `/v3/contact_lists/${listId}`,
  );
  if (!list?.list_id || typeof list.name !== "string")
    throw new AppError(
      "Constant Contact did not return the selected list.",
      502,
    );
  const existing = await db.deliveryRun.findFirst({
    where: { audienceId, status: { in: active } },
  });
  if (existing) {
    if (existing.listId !== listId)
      throw new AppError(
        `Finish the current delivery to ${existing.listName} before choosing another list.`,
        409,
      );
    return existing;
  }
  try {
    return await db.deliveryRun.create({
      data: {
        audienceId,
        sourceRunId: source.id,
        accountId: config.externalId,
        listId,
        listName: list.name,
        total,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const run = await db.deliveryRun.findFirst({
        where: { audienceId, status: { in: active } },
      });
      if (run) return run;
    }
    throw error;
  }
}

export async function deliveryStep(id: string) {
  const lease = new Date(Date.now() + 90000);
  const acquired = await db.deliveryRun.updateMany({
    where: {
      id,
      status: { in: active },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: lease, status: "running", error: null },
  });
  if (!acquired.count) {
    const run = await db.deliveryRun.findUnique({ where: { id } });
    if (run && !active.includes(run.status)) return run;
    throw new AppError(
      "This delivery is already being processed. Try again shortly.",
      409,
    );
  }
  try {
    const run = await db.deliveryRun.findUniqueOrThrow({ where: { id } });
    const config = await connection("constant-contact");
    if (!config.tokens || config.externalId !== run.accountId)
      throw new AppError(
        "Reconnect the Constant Contact account that owns this delivery.",
        409,
      );
    if (run.activityId) return await finishActivity(run, lease);

    const members = await db.audienceMember.findMany({
      where: {
        runId: run.sourceRunId,
        ...(run.cursor ? { salesforceId: { gt: run.cursor } } : {}),
      },
      orderBy: { salesforceId: "asc" },
      take: 2000,
    });
    if (!members.length) {
      if (run.processed !== run.total)
        throw new AppError(
          "The saved Salesforce snapshot changed during delivery.",
          409,
        );
      return complete(run.id, lease, run.failed);
    }
    const contacts = members.map(importContact).filter((row) => row !== null);
    const batch: Batch = {
      cursor: members.at(-1)!.salesforceId,
      processed: members.length,
      submitted: contacts.length,
      skipped: members.length - contacts.length,
    };
    if (!contacts.length) return commitBatch(run, lease, batch, 0);
    const payload = JSON.stringify({
      import_data: contacts,
      list_ids: [run.listId],
    });
    if (Buffer.byteLength(payload) >= 4_000_000)
      throw new AppError("This contact batch exceeds Constant Contact limits.");
    const activity = await providerRequest(
      "constant-contact",
      "/v3/activities/contacts_json_import",
      { method: "POST", body: payload },
    );
    if (typeof activity?.activity_id !== "string")
      throw new AppError("Constant Contact did not start the import.", 502);
    await db.deliveryRun.updateMany({
      where: { id: run.id, leaseUntil: lease, activityId: null },
      data: {
        activityId: activity.activity_id,
        activityProgress: Number(activity.percent_done) || 0,
        batch: batch as unknown as Prisma.InputJsonValue,
        leaseUntil: null,
      },
    });
    return db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
  } catch (error) {
    await db.deliveryRun.updateMany({
      where: { id, leaseUntil: lease, status: "running" },
      data: {
        status: "paused",
        error: publicError(error).error,
        leaseUntil: null,
      },
    });
    throw error;
  }
}

async function finishActivity(
  run: Awaited<ReturnType<typeof db.deliveryRun.findUniqueOrThrow>>,
  lease: Date,
) {
  const activity = await providerRequest(
    "constant-contact",
    `/v3/activities/${run.activityId}`,
  );
  const state = String(activity?.state || "");
  if (["initialized", "processing"].includes(state)) {
    await db.deliveryRun.updateMany({
      where: { id: run.id, leaseUntil: lease },
      data: {
        activityProgress: Number(activity.percent_done) || 0,
        leaseUntil: null,
      },
    });
    return db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
  }
  const errors = Array.isArray(activity?.activity_errors)
    ? activity.activity_errors.map(String)
    : [];
  if (state !== "completed") {
    await db.deliveryRun.updateMany({
      where: { id: run.id, leaseUntil: lease },
      data: {
        status: "paused",
        activityId: null,
        activityProgress: 0,
        batch: Prisma.JsonNull,
        error:
          errors.join(" ").slice(0, 1000) || `Import ${state || "failed"}.`,
        leaseUntil: null,
      },
    });
    throw new AppError(
      "Constant Contact could not finish this batch. Resume to retry it.",
      502,
    );
  }
  const failed = Math.max(
    Number(activity.status?.error_count) || 0,
    Number(activity.status?.cannot_add_to_list_count) || 0,
    errors.length,
  );
  return commitBatch(run, lease, run.batch as unknown as Batch, failed);
}

async function commitBatch(
  run: Awaited<ReturnType<typeof db.deliveryRun.findUniqueOrThrow>>,
  lease: Date,
  batch: Batch,
  failed: number,
) {
  const processed = run.processed + batch.processed;
  const totalFailed = run.failed + failed;
  const done = processed === run.total;
  if (processed > run.total)
    throw new AppError("Delivery progress exceeds the source snapshot.", 409);
  await db.deliveryRun.updateMany({
    where: { id: run.id, leaseUntil: lease },
    data: {
      cursor: batch.cursor,
      processed,
      submitted: { increment: batch.submitted },
      skipped: { increment: batch.skipped },
      failed: { increment: failed },
      activityId: null,
      activityProgress: 0,
      batch: Prisma.JsonNull,
      status: done
        ? totalFailed
          ? "completed_with_errors"
          : "completed"
        : "running",
      finishedAt: done ? new Date() : null,
      error:
        done && totalFailed
          ? `${totalFailed} contact rows could not be imported.`
          : null,
      leaseUntil: null,
    },
  });
  return db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
}

async function complete(id: string, lease: Date, failed: number) {
  await db.deliveryRun.updateMany({
    where: { id, leaseUntil: lease },
    data: {
      status: failed ? "completed_with_errors" : "completed",
      finishedAt: new Date(),
      leaseUntil: null,
    },
  });
  return db.deliveryRun.findUniqueOrThrow({ where: { id } });
}
