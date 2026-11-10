import type { PullRun } from "@prisma/client";
import { AUDIENCE_IMPORT_BATCH_SIZE } from "./audience-import-input";
import { saveSalesforcePeople, refreshPeople, personRecord } from "./people";
import {
  previewAudienceImport,
  commitAudienceImport,
  type ImportRow,
} from "./audience-imports";
import {
  FUNRAISIN_FIELDS,
  parseFunraisinAudience,
  funraisinAudienceConnection,
  funraisinAudiencePage,
} from "./funraisin-audiences";
import { db } from "./db";
import { AppError, publicError, transientError } from "./errors";
import { connection, sfQuery } from "./providers";
import { sourceQuery, validatePaths, enrich, reportPage } from "./salesforce";
import { validateQuery } from "./soql";
import { Prisma } from "@prisma/client";
import { normalizedEmail } from "./email";
export async function createAudience(input: {
  name: string;
  sourceType: string;
  sourceId?: string;
  query: string;
  fields: string[];
  exclusionAudienceIds?: string[];
}) {
  const config = await connection("salesforce");
  if (!config.tokens || !config.externalId)
    throw new AppError("Connect Salesforce first.", 409);
  if (input.sourceType === "funraisin") {
    const sync = await funraisinAudienceConnection();
    const filters = parseFunraisinAudience(input.query);
    await validateAudienceExclusions(
      sync.orgId,
      input.exclusionAudienceIds ?? [],
    );
    return db.audience.create({
      data: {
        name: input.name,
        sourceType: "funraisin",
        query: JSON.stringify(filters),
        orgId: sync.orgId,
        exclusionAudienceIds: input.exclusionAudienceIds ?? [],
        fields: FUNRAISIN_FIELDS.filter(
          (field) =>
            filters.people === "entrants" || field !== "FunraisinDateOfBirth",
        ),
      },
    });
  }
  let query = input.query;
  if (input.sourceType !== "soql") {
    const resolved = await sourceQuery(input.sourceType, input.sourceId ?? "");
    if (!resolved.query) throw new AppError(resolved.notes.join(" "), 422);
    query =
      "executionQuery" in resolved ? resolved.executionQuery : resolved.query;
  }
  validateQuery(
    query.startsWith("report:") ? JSON.parse(query.slice(7)).query : query,
  );
  await validatePaths(input.fields);
  await validateAudienceExclusions(
    config.externalId,
    input.exclusionAudienceIds ?? [],
  );
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
async function validateAudienceExclusions(
  orgId: string,
  ids: string[],
  selfId?: string,
) {
  if (ids.includes(selfId ?? "") || new Set(ids).size !== ids.length)
    throw new AppError("Choose distinct audiences other than this audience.");
  if (!ids.length) return;
  const found = await db.audience.count({ where: { id: { in: ids }, orgId } });
  if (found !== ids.length)
    throw new AppError(
      "An excluded audience is unavailable in this Salesforce org.",
      409,
    );
}
export async function updateAudienceExclusions(id: string, ids: string[]) {
  const audience = await db.audience.findUnique({ where: { id } });
  if (!audience) throw new AppError("Audience not found.", 404);
  await validateAudienceExclusions(audience.orgId, ids, id);
  return db.audience.update({
    where: { id },
    data: { exclusionAudienceIds: ids },
  });
}
export async function updateAudienceQuery(id: string, query: string) {
  validateQuery(query);
  const audience = await db.audience.findUnique({ where: { id } });
  if (!audience) throw new AppError("Audience not found.", 404);
  if (["funraisin", "import"].includes(audience.sourceType))
    throw new AppError(
      "Imported and Funraisin audiences do not use editable SOQL. Use their list or filters instead.",
      409,
    );
  const config = await connection("salesforce");
  if (!config.tokens || config.externalId !== audience.orgId)
    throw new AppError(
      "Reconnect the Salesforce org that owns this audience.",
      409,
    );
  return db.audience.update({
    where: { id },
    data: { query, sourceType: "soql", sourceId: null },
  });
}
export async function addManualMember(
  id: string,
  email: string,
  userId: string,
) {
  const preview = await previewAudienceImport(
    { audienceId: id, name: "Manual addition", text: email, format: "paste" },
    userId,
  );
  if (
    (preview.rows as unknown as ImportRow[]).some(
      (r) => r.status === "ambiguous",
    )
  )
    throw new AppError(
      "Several people share this email. Use Import list to review the match.",
      409,
    );
  await commitAudienceImport(preview.id, {}, userId);
  return db.manualAudienceMember.findUniqueOrThrow({
    where: { audienceId_email: { audienceId: id, email } },
  });
}

export async function removeManualMember(id: string, email: string) {
  return db.$transaction(async (tx) => {
    const removed = await tx.manualAudienceMember.deleteMany({
      where: { audienceId: id, email },
    });
    if (!removed.count) throw new AppError("Manual email not found.", 404);
    await tx.audience.update({
      where: { id },
      data: { manualVersion: { increment: 1 } },
    });
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
  if (audience.sourceType === "funraisin") {
    parseFunraisinAudience(query);
    await funraisinAudienceConnection(audience.orgId);
  } else if (!["soql", "import"].includes(audience.sourceType)) {
    const resolved = await sourceQuery(audience.sourceType, audience.sourceId!);
    if (!resolved.query) throw new AppError(resolved.notes.join(" "), 422);
    query =
      "executionQuery" in resolved ? resolved.executionQuery : resolved.query;
  }
  if (!["funraisin", "import"].includes(audience.sourceType)) {
    validateQuery(
      query.startsWith("report:") ? JSON.parse(query.slice(7)).query : query,
    );
    await validatePaths(audience.fields as string[]);
  }
  try {
    return await db.pullRun.create({
      data: {
        audienceId: id,
        query,
        fields: audience.fields as Prisma.InputJsonValue,
        orgId: audience.orgId,
        manualVersion:
          audience.sourceType === "import" ? audience.manualVersion : 0,
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
async function pullStage<T>(
  runId: string,
  stage: string,
  operation: () => Promise<T>,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      const retry =
        transientError(error) &&
        attempt === 0 &&
        (stage !== "save page" || code === "P2024");
      if (!(error instanceof AppError))
        console.error("Audience pull step failed", {
          runId,
          stage,
          attempt: attempt + 1,
          retry,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  code,
                  causeCode: (error as Error & { cause?: { code?: unknown } })
                    .cause?.code,
                  stack: error.stack,
                }
              : String(error),
        });
      if (!retry) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Unreachable pull retry state.");
}
async function manualAudiencePage(run: PullRun) {
  const cursor = run.cursor
    ? (JSON.parse(run.cursor.slice("manual:".length)) as {
        after: string | null;
        sourceTotal: number;
        version: number;
      })
    : { after: null, sourceTotal: 0, version: run.manualVersion ?? 0 };
  const audience = await db.audience.findUniqueOrThrow({
    where: { id: run.audienceId },
  });
  if (audience.manualVersion !== cursor.version)
    throw new AppError(
      "Audience additions changed during this pull. Cancel it and start a new pull.",
      409,
    );
  const [members, total] = await Promise.all([
    db.manualAudienceMember.findMany({
      where: {
        audienceId: run.audienceId,
        ...(cursor.after ? { email: { gt: cursor.after } } : {}),
      },
      orderBy: { email: "asc" },
      take: AUDIENCE_IMPORT_BATCH_SIZE,
      include: { person: true },
    }),
    db.manualAudienceMember.count({ where: { audienceId: run.audienceId } }),
  ]);
  if (!members.length && run.processed < cursor.sourceTotal + total)
    throw new AppError(
      "Audience membership paging was incomplete. Restart this pull.",
      409,
    );
  const people = await Promise.all(
    members.map((m) =>
      m.person.mergedIntoId
        ? db.person.findUniqueOrThrow({ where: { id: m.person.mergedIntoId } })
        : m.person,
    ),
  );
  const current = await refreshPeople(people, run.orgId);
  const totalSize = cursor.sourceTotal + total;
  const done = run.processed + members.length >= totalSize;
  return {
    records: current.map(personRecord),
    totalSize,
    done,
    nextRecordsUrl: done
      ? undefined
      : "manual:" + JSON.stringify({ ...cursor, after: members.at(-1)?.email }),
    manualVersion: cursor.version,
  };
}

export async function pullStep(id: string) {
  const lease = new Date(Date.now() + 90000);
  const acquired = await pullStage(id, "claim run", () =>
    db.pullRun.updateMany({
      where: {
        id,
        status: { in: ["pending", "running", "paused"] },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseUntil: lease, status: "running", error: null },
    }),
  );
  if (!acquired.count) {
    const run = await db.pullRun.findUnique({ where: { id } });
    if (run?.status === "completed") return run;
    throw new AppError(
      "This pull is busy or has been cancelled. Refresh its status shortly.",
      409,
    );
  }
  try {
    const run = (await pullStage(id, "load run", () =>
      db.pullRun.findUnique({ where: { id } }),
    ))!;
    const config = await pullStage(id, "load Salesforce connection", () =>
      connection("salesforce"),
    );
    if (config.externalId !== run.orgId || !config.tokens)
      throw new AppError(
        "The Salesforce connection changed. Reconnect the original org.",
        409,
      );
    const imported = run.query === "import";
    const manualPhase = imported || !!run.cursor?.startsWith("manual:");
    const funraisin = run.query.startsWith("{");
    const report = run.query.startsWith("report:");
    const page = await pullStage(id, "fetch Salesforce page", () =>
      manualPhase
        ? manualAudiencePage(run)
        : funraisin
          ? funraisinAudiencePage(run.query, run.cursor, 500, run.orgId)
          : report
            ? reportPage(run.query, run.cursor, run.orgId)
            : sfQuery(run.query, run.cursor, run.orgId),
    );
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
    if (
      Number(page.totalSize) > 150000 ||
      run.processed + ("scanned" in page ? page.scanned : page.records.length) >
        150000
    )
      throw new AppError(
        "This audience exceeds the 150,000-record manual pull limit. Narrow the query; Bulk extraction is a later milestone.",
        422,
      );
    const records: Record<string, any>[] = await pullStage(
      id,
      "enrich Salesforce contacts",
      () =>
        funraisin || manualPhase
          ? Promise.resolve(page.records)
          : enrich(page.records, run.fields as string[], run.orgId),
    );
    if (records.length !== page.records.length)
      throw new AppError(
        "Salesforce returned duplicate Contact IDs. Restart this pull.",
        409,
      );
    const sourcePeople =
      funraisin || manualPhase
        ? []
        : await saveSalesforcePeople(run.orgId, records);
    const bySalesforce = new Map(
      sourcePeople.map((p) => [p.salesforceId, p.id]),
    );
    const manualVersion = manualPhase
      ? (run.manualVersion ?? 0)
      : page.done
        ? (
            await db.audience.findUniqueOrThrow({
              where: { id: run.audienceId },
            })
          ).manualVersion
        : 0;
    const latest = await pullStage(id, "recheck Salesforce connection", () =>
      connection("salesforce"),
    );
    if (
      latest.version !== config.version ||
      latest.externalId !== run.orgId ||
      !latest.tokens
    )
      throw new AppError(
        "Connection changed during extraction. Resume after reconnecting the original org.",
        409,
      );
    const processed =
      run.processed + ("scanned" in page ? page.scanned : page.records.length);
    let total = run.cursor ? run.total : Number(page.totalSize);
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
    let enteringManual = false;
    if (page.done && !manualPhase) {
      const count = await db.manualAudienceMember.count({
        where: { audienceId: run.audienceId },
      });
      if (count) {
        enteringManual = true;
        page.done = false;
        page.nextRecordsUrl =
          "manual:" +
          JSON.stringify({
            after: null,
            sourceTotal: total,
            version: manualVersion,
          });
        total += count;
      }
    }
    return await pullStage(id, "save page", () =>
      db.$transaction(
        async (tx) => {
          if (
            (page.done || manualPhase || enteringManual) &&
            (
              await tx.audience.findUniqueOrThrow({
                where: { id: run.audienceId },
              })
            ).manualVersion !== manualVersion
          )
            throw new AppError(
              "Audience additions changed during this pull. Restart it.",
              409,
            );
          const owner = await tx.pullRun.updateMany({
            where: { id, leaseUntil: lease, status: "running" },
            data: {
              processed,
              ...(page.done || enteringManual ? { manualVersion } : {}),
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
              personId: record.PersonId || bySalesforce.get(record.Id)!,
              deliveryKey: record.Id || `local:${record.PersonId}`,
              salesforceId: record.Id || null,
              email: record.Email || null,
              normalizedEmail: normalizedEmail(record.Email),
              name:
                [record.FirstName, record.LastName].filter(Boolean).join(" ") ||
                null,
              optedOut: record.HasOptedOutOfEmail === true,
              data: JSON.parse(JSON.stringify(record)),
            })),
            skipDuplicates: true,
          });
          if (!manualPhase && inserted.count !== records.length)
            throw new AppError(
              "Contact IDs repeated across pages. Restart this pull.",
              409,
            );
          if (page.done && manualPhase) {
            const count = await tx.audienceMember.count({
              where: { runId: id },
            });
            await tx.pullRun.updateMany({
              where: { id },
              data: { processed: count, total: count },
            });
          }
          if (report && (page.done || enteringManual)) {
            const count = await tx.audienceMember.count({
              where: { runId: id },
            });
            await tx.pullRun.updateMany({
              where: { id },
              data: {
                processed: count,
                total: count + (enteringManual ? total - processed : 0),
                ...(enteringManual
                  ? {
                      cursor:
                        "manual:" +
                        JSON.stringify({
                          after: null,
                          sourceTotal: count,
                          version: manualVersion,
                        }),
                    }
                  : {}),
              },
            });
          }
          return tx.pullRun.findUniqueOrThrow({ where: { id } });
        },
        { maxWait: 15000, timeout: 15000 },
      ),
    );
  } catch (error) {
    await pullStage(id, "pause run", () =>
      db.pullRun.updateMany({
        where: { id, leaseUntil: lease, status: "running" },
        data: {
          status: "paused",
          error: publicError(error).error,
          leaseUntil: null,
        },
      }),
    );
    throw error;
  }
}
