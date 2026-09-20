import { Prisma } from "@prisma/client";
import { db } from "./db";
import { startPull, pullStep } from "./audiences";
import {
  resolveDestination,
  startScheduledDelivery,
  deliveryStep,
  type Destination,
  type FieldMapping,
} from "./deliveries";
import { AppError, publicError } from "./errors";

const active = ["pending", "pulling", "delivering"];
type Recurrence = {
  cadence: string;
  intervalHours: number | null;
  localTime: string | null;
  weekday: number | null;
  timeZone: string;
};
export type ScheduleInput = Recurrence & {
  listId: string;
  mappings: { source: string; targetId: string }[];
};

function localParts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return values as Record<
    "year" | "month" | "day" | "hour" | "minute" | "second",
    number
  >;
}

function localDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let attempt = 0; attempt < 4; attempt++) {
    const actual = localParts(new Date(guess), timeZone);
    const difference =
      wanted -
      Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
      );
    if (!difference) return new Date(guess);
    guess += difference;
  }
  return null; // A daylight-saving transition can remove a local clock time.
}

export function nextRunAt(
  schedule: Recurrence,
  after: Date,
  intervalAnchor?: Date,
) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: schedule.timeZone }).format();
  } catch {
    throw new AppError("Choose a valid time zone.");
  }
  if (schedule.cadence === "hours") {
    const hours = schedule.intervalHours ?? 0;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168)
      throw new AppError("Choose an interval from 1 to 168 hours.");
    const interval = hours * 3_600_000;
    let next = (intervalAnchor ?? after).getTime() + interval;
    while (next <= after.getTime()) next += interval;
    return new Date(next);
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime ?? ""))
    throw new AppError("Choose a valid scheduled time.");
  if (
    schedule.cadence === "weekly" &&
    (!Number.isInteger(schedule.weekday) ||
      schedule.weekday === null ||
      schedule.weekday < 0 ||
      schedule.weekday > 6)
  )
    throw new AppError("Choose a valid weekday.");
  if (!["daily", "weekly"].includes(schedule.cadence))
    throw new AppError("Choose a valid schedule frequency.");
  const [hour, minute] = schedule.localTime!.split(":").map(Number);
  const current = localParts(after, schedule.timeZone);
  for (let offset = 0; offset <= 8; offset++) {
    const calendar = new Date(
      Date.UTC(current.year, current.month - 1, current.day + offset),
    );
    if (
      schedule.cadence === "weekly" &&
      calendar.getUTCDay() !== schedule.weekday
    )
      continue;
    const candidate = localDate(
      calendar.getUTCFullYear(),
      calendar.getUTCMonth() + 1,
      calendar.getUTCDate(),
      hour,
      minute,
      schedule.timeZone,
    );
    if (candidate && candidate > after) return candidate;
  }
  throw new AppError("Could not calculate the next scheduled run.");
}

export async function saveSchedule(audienceId: string, input: ScheduleInput) {
  if (!process.env.CRON_SECRET)
    throw new AppError("Add CRON_SECRET to the Vercel environment first.", 503);
  const audience = await db.audience.findUnique({ where: { id: audienceId } });
  if (!audience) throw new AppError("Audience not found.", 404);
  const destination = await resolveDestination(
    audience.fields,
    input.listId,
    input.mappings,
  );
  const now = new Date();
  const recurrence: Recurrence = {
    cadence: input.cadence,
    intervalHours: input.cadence === "hours" ? input.intervalHours : null,
    localTime: input.cadence === "hours" ? null : input.localTime,
    weekday: input.cadence === "weekly" ? input.weekday : null,
    timeZone: input.timeZone,
  };
  const nextRunAtValue = nextRunAt(recurrence, now);
  const data = {
    ...recurrence,
    accountId: destination.accountId,
    listId: destination.listId,
    listName: destination.listName,
    mappings: destination.mappings as unknown as Prisma.InputJsonValue,
    nextRunAt: nextRunAtValue,
    error: null,
  };
  const previous = await db.syncSchedule.findUnique({ where: { audienceId } });
  return previous
    ? db.syncSchedule.update({
        where: { id: previous.id },
        data: { ...data, version: { increment: 1 } },
        include: { runs: { orderBy: { createdAt: "desc" }, take: 10 } },
      })
    : db.syncSchedule.create({
        data: { audienceId, ...data },
        include: { runs: true },
      });
}

export async function setScheduleEnabled(id: string, enabled: boolean) {
  const schedule = await db.syncSchedule.findUnique({ where: { id } });
  if (!schedule) throw new AppError("Schedule not found.", 404);
  return db.syncSchedule.update({
    where: { id },
    data: {
      enabled,
      ...(enabled
        ? { nextRunAt: nextRunAt(schedule, new Date()), error: null }
        : {}),
    },
  });
}

function frozenRun(
  schedule: Awaited<ReturnType<typeof db.syncSchedule.findUniqueOrThrow>>,
) {
  return {
    scheduleId: schedule.id,
    scheduleVersion: schedule.version,
    accountId: schedule.accountId,
    listId: schedule.listId,
    listName: schedule.listName,
    mappings: schedule.mappings as Prisma.InputJsonValue,
  };
}

export async function runScheduleNow(id: string) {
  const schedule = await db.syncSchedule.findUnique({ where: { id } });
  if (!schedule) throw new AppError("Schedule not found.", 404);
  if (!schedule.enabled)
    throw new AppError("Resume this schedule before running it.", 409);
  const existing = await db.syncRun.findFirst({
    where: { scheduleId: id, status: { in: active } },
  });
  if (existing) return existing;
  const now = new Date();
  return db.$transaction(async (tx) => {
    const run = await tx.syncRun.create({
      data: { ...frozenRun(schedule), manual: true, scheduledFor: now },
    });
    await tx.syncSchedule.update({
      where: { id },
      data: { lastRunAt: now, error: null },
    });
    return run;
  });
}

async function enqueueDue(now: Date) {
  const schedules = await db.syncSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: 20,
  });
  for (const schedule of schedules) {
    try {
      await db.$transaction(async (tx) => {
        const owner = await tx.syncSchedule.updateMany({
          where: {
            id: schedule.id,
            enabled: true,
            nextRunAt: schedule.nextRunAt,
          },
          data: { lastRunAt: now, error: null },
        });
        if (!owner.count) return;
        await tx.syncRun.create({
          data: {
            ...frozenRun(schedule),
            scheduledFor: schedule.nextRunAt,
          },
        });
      });
    } catch (error) {
      if (!(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ))
        throw error;
    }
  }
}

async function claimRun(excluded: string[]) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = new Date();
    const candidate = await db.syncRun.findFirst({
      where: {
        id: excluded.length ? { notIn: excluded } : undefined,
        status: { in: active },
        availableAt: { lte: now },
        schedule: { enabled: true },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: { availableAt: "asc" },
    });
    if (!candidate) return null;
    const lease = new Date(Date.now() + 75_000);
    const claimed = await db.syncRun.updateMany({
      where: {
        id: candidate.id,
        status: { in: active },
        availableAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { leaseUntil: lease },
    });
    if (claimed.count) return { id: candidate.id, lease };
  }
  return null;
}

async function finishSync(
  id: string,
  lease: Date,
  status: "completed" | "completed_with_errors",
  error: string | null,
) {
  const run = await db.syncRun.findUniqueOrThrow({
    where: { id },
    include: { schedule: true },
  });
  const finishedAt = new Date();
  await db.$transaction(async (tx) => {
    const owner = await tx.syncRun.updateMany({
      where: { id, leaseUntil: lease, status: { in: active } },
      data: { status, error, finishedAt, leaseUntil: null },
    });
    if (!owner.count) return;
    await tx.syncSchedule.updateMany({
      where: { id: run.scheduleId, version: run.scheduleVersion },
      data: {
        lastCompletedAt: finishedAt,
        error,
        ...(!run.manual
          ? {
              nextRunAt: nextRunAt(run.schedule, finishedAt, run.scheduledFor),
            }
          : {}),
      },
    });
  });
}

async function failOrRetry(id: string, lease: Date, error: unknown) {
  const run = await db.syncRun.findUniqueOrThrow({ where: { id } });
  const message = publicError(error).error;
  const attempts = run.attempts + 1;
  if (attempts < 8) {
    await db.$transaction([
      db.syncRun.updateMany({
        where: { id, leaseUntil: lease, status: { in: active } },
        data: {
          attempts,
          availableAt: new Date(
            Date.now() + Math.min(3600, 60 * 2 ** (attempts - 1)) * 1000,
          ),
          error: message,
          leaseUntil: null,
        },
      }),
      db.syncSchedule.updateMany({
        where: { id: run.scheduleId },
        data: { error: message },
      }),
    ]);
    return;
  }
  const finishedAt = new Date();
  const schedule = await db.syncSchedule.findUniqueOrThrow({
    where: { id: run.scheduleId },
  });
  await db.$transaction([
    db.syncRun.updateMany({
      where: { id, leaseUntil: lease, status: { in: active } },
      data: {
        status: "failed",
        attempts,
        error: message,
        finishedAt,
        leaseUntil: null,
      },
    }),
    db.pullRun.updateMany({
      where: {
        id: run.pullRunId ?? "",
        status: { in: ["pending", "running", "paused"] },
      },
      data: { status: "cancelled", finishedAt, leaseUntil: null },
    }),
    db.deliveryRun.updateMany({
      where: {
        id: run.deliveryRunId ?? "",
        status: { in: ["pending", "running", "paused"] },
      },
      data: { status: "failed", error: message, finishedAt, leaseUntil: null },
    }),
    db.syncSchedule.updateMany({
      where: { id: run.scheduleId, version: run.scheduleVersion },
      data: {
        error: message,
        ...(!run.manual
          ? { nextRunAt: nextRunAt(schedule, finishedAt, run.scheduledFor) }
          : {}),
      },
    }),
  ]);
}

async function processRun(id: string, lease: Date, deadline: number) {
  try {
    while (Date.now() < deadline) {
      let run = await db.syncRun.findUniqueOrThrow({
        where: { id },
        include: { schedule: true },
      });
      if (run.status === "pending" || run.status === "pulling") {
        let pull = run.pullRunId
          ? await db.pullRun.findUnique({ where: { id: run.pullRunId } })
          : await startPull(run.schedule.audienceId);
        if (!pull) throw new AppError("The scheduled pull could not be found.");
        if (!run.pullRunId) {
          await db.syncRun.updateMany({
            where: { id, leaseUntil: lease },
            data: {
              pullRunId: pull.id,
              status: "pulling",
              attempts: 0,
              error: null,
            },
          });
        }
        if (pull.status !== "completed") pull = await pullStep(pull.id);
        await db.syncRun.updateMany({
          where: { id, leaseUntil: lease },
          data: { attempts: 0, error: null },
        });
        await db.syncSchedule.updateMany({
          where: { id: run.scheduleId },
          data: { error: null },
        });
        if (pull.status !== "completed") continue;
        if (!pull.total) {
          await finishSync(id, lease, "completed", null);
          return;
        }
        await db.syncRun.updateMany({
          where: { id, leaseUntil: lease },
          data: { status: "delivering" },
        });
        continue;
      }
      if (run.status === "delivering") {
        const destination: Destination = {
          accountId: run.accountId,
          listId: run.listId,
          listName: run.listName,
          mappings: run.mappings as unknown as FieldMapping[],
        };
        let delivery = run.deliveryRunId
          ? await db.deliveryRun.findUnique({
              where: { id: run.deliveryRunId },
            })
          : await startScheduledDelivery(
              run.schedule.audienceId,
              run.pullRunId!,
              destination,
            );
        if (!delivery)
          throw new AppError("The scheduled delivery could not be found.");
        if (!run.deliveryRunId) {
          await db.syncRun.updateMany({
            where: { id, leaseUntil: lease },
            data: { deliveryRunId: delivery.id, attempts: 0, error: null },
          });
        }
        if (["completed", "completed_with_errors"].includes(delivery.status)) {
          await finishSync(
            id,
            lease,
            delivery.status as "completed" | "completed_with_errors",
            delivery.error,
          );
          return;
        }
        const waitingFor = delivery.activityId;
        delivery = await deliveryStep(delivery.id);
        await db.syncRun.updateMany({
          where: { id, leaseUntil: lease },
          data: { attempts: 0, error: null },
        });
        await db.syncSchedule.updateMany({
          where: { id: run.scheduleId },
          data: { error: null },
        });
        if (["completed", "completed_with_errors"].includes(delivery.status)) {
          await finishSync(
            id,
            lease,
            delivery.status as "completed" | "completed_with_errors",
            delivery.error,
          );
          return;
        }
        // ponytail: process one asynchronous import per minute; use a queue if 150k-contact schedules need lower latency.
        if (delivery.activityId || waitingFor) break;
      }
    }
    await db.syncRun.updateMany({
      where: { id, leaseUntil: lease, status: { in: active } },
      data: { leaseUntil: null },
    });
  } catch (error) {
    await failOrRetry(id, lease, error);
  }
}

export async function runScheduler() {
  const started = Date.now();
  const deadline = started + 50_000;
  await enqueueDue(new Date());
  const processed: string[] = [];
  while (Date.now() < deadline) {
    const claimed = await claimRun(processed);
    if (!claimed) break;
    processed.push(claimed.id);
    await processRun(claimed.id, claimed.lease, deadline);
  }
  return {
    ok: true,
    processed: processed.length,
    durationMs: Date.now() - started,
  };
}
