import { db } from "./db";
import { AppError, publicError } from "./errors";
import { connection, sfQuery } from "./providers";
import { sourceQuery, validatePaths, enrich } from "./salesforce";
import { validateQuery } from "./soql";
import { Prisma } from "@prisma/client";
export async function createAudience(input: {
  name: string;
  sourceType: string;
  sourceId?: string;
  query: string;
  fields: string[];
}) {
  const config = await connection("salesforce");
  if (!config.tokens || !config.externalId)
    throw new AppError("Connect Salesforce first.", 409);
  let query = input.query;
  if (input.sourceType !== "soql") {
    const resolved = await sourceQuery(input.sourceType, input.sourceId ?? "");
    if (!resolved.query) throw new AppError(resolved.notes.join(" "), 422);
    query = resolved.query;
  }
  validateQuery(query);
  await validatePaths(input.fields);
  return db.audience.create({
    data: {
      ...input,
      sourceId: input.sourceType === "soql" ? null : input.sourceId,
      query,
      orgId: config.externalId,
      fields: input.fields,
    },
  });
}
export async function startPull(id: string) {
  const audience = await db.audience.findUnique({ where: { id } });
  if (!audience) throw new AppError("Audience not found.", 404);
  const config = await connection("salesforce");
  if (!config.tokens || config.externalId !== audience.orgId)
    throw new AppError(
      "Reconnect the Salesforce org that owns this audience.",
      409,
    );
  const existing = await db.pullRun.findFirst({
    where: { audienceId: id, status: { in: ["pending", "running", "paused"] } },
  });
  if (existing) return existing;
  let query = audience.query;
  if (audience.sourceType !== "soql") {
    const resolved = await sourceQuery(audience.sourceType, audience.sourceId!);
    if (!resolved.query) throw new AppError(resolved.notes.join(" "), 422);
    query = resolved.query;
  }
  validateQuery(query);
  await validatePaths(audience.fields as string[]);
  try {
    return await db.pullRun.create({
      data: {
        audienceId: id,
        query,
        fields: audience.fields as Prisma.InputJsonValue,
        orgId: audience.orgId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const run = await db.pullRun.findFirst({
        where: {
          audienceId: id,
          status: { in: ["pending", "running", "paused"] },
        },
      });
      if (run) return run;
    }
    throw error;
  }
}
export async function pullStep(id: string) {
  const lease = new Date(Date.now() + 90000);
  const acquired = await db.pullRun.updateMany({
    where: {
      id,
      status: { in: ["pending", "running", "paused"] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: lease, status: "running", error: null },
  });
  if (!acquired.count) {
    const run = await db.pullRun.findUnique({ where: { id } });
    if (run?.status === "completed") return run;
    throw new AppError(
      "This pull is busy or has been cancelled. Refresh its status shortly.",
      409,
    );
  }
  try {
    const run = (await db.pullRun.findUnique({ where: { id } }))!;
    const config = await connection("salesforce");
    if (config.externalId !== run.orgId || !config.tokens)
      throw new AppError(
        "The Salesforce connection changed. Reconnect the original org.",
        409,
      );
    const page = await sfQuery(run.query, run.cursor);
    if (
      !Array.isArray(page.records) ||
      typeof page.done !== "boolean" ||
      (!page.done &&
        (!page.nextRecordsUrl || page.nextRecordsUrl === run.cursor))
    )
      throw new AppError(
        "Salesforce returned an incomplete page. No snapshot was published.",
        502,
      );
    if (run.processed + page.records.length > 150000)
      throw new AppError(
        "This audience exceeds the 150,000-record manual pull limit. Narrow the query; Bulk extraction is a later milestone.",
        422,
      );
    const records = await enrich(page.records, run.fields as string[]);
    if (records.length !== page.records.length)
      throw new AppError(
        "Salesforce returned duplicate Contact IDs. Restart this pull.",
        409,
      );
    const latest = await connection("salesforce");
    if (
      latest.version !== config.version ||
      latest.externalId !== run.orgId ||
      !latest.tokens
    )
      throw new AppError(
        "Connection changed during extraction. Resume after reconnecting the original org.",
        409,
      );
    const processed = run.processed + page.records.length;
    const total = run.cursor ? run.total : Number(page.totalSize);
    if (
      !Number.isFinite(total) ||
      total < 0 ||
      processed > total ||
      (page.done && processed !== total)
    )
      throw new AppError(
        "The extracted record count does not match Salesforce. Restart this pull.",
        409,
      );
    return await db.$transaction(
      async (tx) => {
        const owner = await tx.pullRun.updateMany({
          where: { id, leaseUntil: lease, status: "running" },
          data: {
            processed,
            total,
            cursor: page.done ? null : page.nextRecordsUrl,
            status: page.done ? "completed" : "running",
            finishedAt: page.done ? new Date() : null,
            leaseUntil: null,
          },
        });
        if (!owner.count)
          throw new AppError(
            "This pull changed while the page was loading. Refresh and resume.",
            409,
          );
        const inserted = await tx.audienceMember.createMany({
          data: records.map((record) => ({
            runId: id,
            salesforceId: record.Id,
            email: record.Email || null,
            name: [record.FirstName, record.LastName].filter(Boolean).join(" "),
            optedOut: record.HasOptedOutOfEmail === true,
            data: JSON.parse(JSON.stringify(record)),
          })),
          skipDuplicates: true,
        });
        if (inserted.count !== records.length)
          throw new AppError(
            "Contact IDs repeated across pages. Restart this pull.",
            409,
          );
        return tx.pullRun.findUniqueOrThrow({ where: { id } });
      },
      { timeout: 15000 },
    );
  } catch (error) {
    await db.pullRun.updateMany({
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
