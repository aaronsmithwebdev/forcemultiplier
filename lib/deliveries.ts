import { Prisma } from "@prisma/client";
import { db } from "./db";
import { normalizedEmail } from "./email";
import { AppError, publicError } from "./errors";
import { connection, providerRequest } from "./providers";

const active = ["pending", "running", "paused", "reconciling"];
type ImportBatch = {
  cursor: string;
  processed: number;
  submitted: number;
  skipped: number;
  contacts: SubmittedContact[];
  issues: DeliveryIssueInput[];
};
type RemovalBatch = { emails: string[]; contactIds: string[] };
type SubmittedContact = {
  salesforceId: string;
  name: string | null;
  email: string;
};
type DeliveryIssueInput = {
  key: string;
  category: "salesforce" | "validation" | "constant_contact";
  reason: string;
  salesforceId?: string | null;
  name?: string | null;
  email?: string | null;
  detail?: string | null;
};
export type FieldMapping = {
  source: string;
  targetId: string;
  targetName: string;
  targetLabel: string;
  targetType:
    | "string"
    | "text_area"
    | "number"
    | "currency"
    | "date"
    | "datetime"
    | "boolean"
    | "single_select"
    | "multi_select";
};
export type Destination = {
  accountId: string;
  listId: string;
  listName: string;
  mappings: FieldMapping[];
};

function valueAt(value: unknown, path: string) {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}

function customValue(value: unknown, mapping: FieldMapping) {
  if (value === null || value === undefined || value === "") return null;
  let result: string;
  if (["number", "currency"].includes(mapping.targetType)) {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number))
      throw new AppError(
        `${mapping.source} contains a value that is not a number.`,
      );
    result = String(number);
  } else if (mapping.targetType === "date") {
    result = String(value);
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(result))
      throw new AppError(
        `${mapping.source} contains a value that is not a date.`,
      );
    result = result.slice(0, 10);
  } else if (mapping.targetType === "datetime") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime()))
      throw new AppError(
        `${mapping.source} contains a value that is not a date and time.`,
      );
    result = date.toISOString();
  } else if (mapping.targetType === "boolean") {
    result = String(value).toLowerCase();
    if (!["true", "false"].includes(result))
      throw new AppError(
        `${mapping.source} contains a value that is not true or false.`,
      );
  } else if (["string", "number", "boolean"].includes(typeof value)) {
    result = String(value);
  } else {
    throw new AppError(
      `${mapping.source} contains a value that cannot be sent.`,
    );
  }
  if (result.length > 255)
    throw new AppError(
      `${mapping.source} contains a value longer than 255 characters.`,
    );
  return result;
}

export function importContact(
  member: {
    email: string | null;
    optedOut: boolean;
    data: unknown;
  },
  mappings: FieldMapping[] = [],
) {
  return prepareContact(member, mappings).contact;
}

export function prepareContact(
  member: {
    salesforceId?: string;
    name?: string | null;
    email: string | null;
    optedOut: boolean;
    data: unknown;
  },
  mappings: FieldMapping[] = [],
) {
  const issue = (
    category: DeliveryIssueInput["category"],
    reason: string,
    detail?: string,
  ) => ({
    contact: null,
    issue: {
      key: `salesforce:${member.salesforceId ?? member.email ?? reason}`,
      category,
      reason,
      salesforceId: member.salesforceId,
      name: member.name,
      email: member.email,
      detail,
    } satisfies DeliveryIssueInput,
  });
  if (member.optedOut) return issue("salesforce", "Opted out in Salesforce");
  if (!member.email?.trim())
    return issue("validation", "Missing email address");
  const email = normalizedEmail(member.email);
  if (!email) return issue("validation", "Invalid email address");
  const data = member.data as Record<string, unknown>;
  const contact: Record<string, string> = {
    email,
    ...(data.FirstName
      ? { first_name: String(data.FirstName).slice(0, 50) }
      : {}),
    ...(data.LastName ? { last_name: String(data.LastName).slice(0, 50) } : {}),
  };
  try {
    for (const mapping of mappings) {
      const value = customValue(valueAt(data, mapping.source), mapping);
      if (value !== null) contact[`cf:${mapping.targetName}`] = value;
    }
  } catch (error) {
    return issue(
      "validation",
      "Custom field value could not be sent",
      error instanceof Error ? error.message : String(error),
    );
  }
  return { contact, issue: null };
}

export async function resolveDestination(
  sourceFields: unknown,
  listId: string,
  requestedMappings: { source: string; targetId: string }[],
): Promise<Destination> {
  const config = await connection("constant-contact");
  if (!config.tokens || !config.externalId)
    throw new AppError("Connect Constant Contact first.", 409);
  const sources = Array.isArray(sourceFields)
    ? sourceFields.filter((field): field is string => typeof field === "string")
    : [];
  if (
    new Set(requestedMappings.map((mapping) => mapping.source)).size !==
      requestedMappings.length ||
    new Set(requestedMappings.map((mapping) => mapping.targetId)).size !==
      requestedMappings.length ||
    requestedMappings.some((mapping) => !sources.includes(mapping.source))
  )
    throw new AppError("The custom field mapping is invalid.");
  const list = await providerRequest(
    "constant-contact",
    `/v3/contact_lists/${listId}`,
  );
  if (!list?.list_id || typeof list.name !== "string")
    throw new AppError(
      "Constant Contact did not return the selected list.",
      502,
    );
  const catalog = await providerRequest(
    "constant-contact",
    "/v3/contact_custom_fields?limit=100",
  );
  const fields = Array.isArray(catalog?.custom_fields)
    ? catalog.custom_fields
    : [];
  const mappings = requestedMappings.map((requested): FieldMapping => {
    const field = fields.find(
      (candidate: any) => candidate.custom_field_id === requested.targetId,
    );
    if (
      !field ||
      typeof field.name !== "string" ||
      typeof field.label !== "string" ||
      ![
        "string",
        "text_area",
        "number",
        "currency",
        "date",
        "datetime",
        "boolean",
        "single_select",
        "multi_select",
      ].includes(field.type)
    )
      throw new AppError(
        "A selected Constant Contact custom field is unavailable.",
      );
    return {
      ...requested,
      targetName: field.name,
      targetLabel: field.label,
      targetType: field.type,
    };
  });
  return {
    accountId: config.externalId,
    listId,
    listName: list.name,
    mappings,
  };
}

export async function startDelivery(
  audienceId: string,
  listId: string,
  requestedMappings: { source: string; targetId: string }[],
) {
  const source = await db.pullRun.findFirst({
    where: { audienceId, status: "completed" },
    orderBy: { createdAt: "desc" },
  });
  if (!source)
    throw new AppError("Complete a Salesforce pull before sending.", 409);
  const destination = await resolveDestination(
    source.fields,
    listId,
    requestedMappings,
  );
  return createDelivery(audienceId, source.id, destination);
}

export async function startScheduledDelivery(
  audienceId: string,
  sourceRunId: string,
  destination: Destination,
) {
  const config = await connection("constant-contact");
  if (!config.tokens || config.externalId !== destination.accountId)
    throw new AppError(
      "Reconnect the Constant Contact account used by this schedule.",
      409,
    );
  const source = await db.pullRun.findFirst({
    where: { id: sourceRunId, audienceId, status: "completed" },
  });
  if (!source)
    throw new AppError("The scheduled Salesforce pull is not complete.", 409);
  return createDelivery(audienceId, source.id, destination);
}

async function createDelivery(
  audienceId: string,
  sourceRunId: string,
  destination: Destination,
) {
  const total = await db.audienceMember.count({
    where: { runId: sourceRunId },
  });
  const existing = await db.deliveryRun.findFirst({
    where: { audienceId, status: { in: active } },
  });
  if (existing) {
    if (
      existing.listId !== destination.listId ||
      existing.sourceRunId !== sourceRunId
    )
      throw new AppError(
        `Finish the current delivery to ${existing.listName} before choosing another list.`,
        409,
      );
    const managedList = await claimManagedList(audienceId, destination);
    return existing.managedListId
      ? existing
      : db.deliveryRun.update({
          where: { id: existing.id },
          data: { managedListId: managedList.id },
        });
  }
  const managedList = await claimManagedList(audienceId, destination);
  try {
    return await db.deliveryRun.create({
      data: {
        audienceId,
        sourceRunId,
        accountId: destination.accountId,
        listId: destination.listId,
        listName: destination.listName,
        managedListId: managedList.id,
        mappings: destination.mappings as unknown as Prisma.InputJsonValue,
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
      if (run?.listId === destination.listId && run.sourceRunId === sourceRunId)
        return run;
      if (run)
        throw new AppError(
          `Finish the current delivery to ${run.listName} before choosing another list.`,
          409,
        );
    }
    throw error;
  }
}

export async function assertDestinationAvailable(
  audienceId: string,
  destination: Destination,
) {
  const where = {
    accountId_listId: {
      accountId: destination.accountId,
      listId: destination.listId,
    },
  };
  const existing = await db.managedList.findUnique({
    where,
    include: { audience: { select: { name: true } } },
  });
  if (existing) {
    if (existing.audienceId !== audienceId)
      throw new AppError(
        `This list is already managed by the ${existing.audience.name} audience. Choose another list so one audience cannot remove another audience's contacts.`,
        409,
      );
    return existing;
  }
  return null;
}

async function claimManagedList(
  audienceId: string,
  destination: Destination,
): Promise<{ id: string }> {
  const existing = await assertDestinationAvailable(audienceId, destination);
  if (existing) {
    if (existing.listName !== destination.listName)
      await db.managedList.update({
        where: { id: existing.id },
        data: { listName: destination.listName },
      });
    return existing;
  }
  try {
    return await db.managedList.create({
      data: {
        audienceId,
        accountId: destination.accountId,
        listId: destination.listId,
        listName: destination.listName,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return claimManagedList(audienceId, destination);
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
    data: { leaseUntil: lease, error: null },
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
    let run = await db.deliveryRun.findUniqueOrThrow({ where: { id } });
    const config = await connection("constant-contact");
    if (!config.tokens || config.externalId !== run.accountId)
      throw new AppError(
        "Reconnect the Constant Contact account that owns this delivery.",
        409,
      );
    if (!run.managedListId) {
      const managedList = await claimManagedList(run.audienceId, {
        accountId: run.accountId,
        listId: run.listId,
        listName: run.listName,
        mappings: [],
      });
      run = await db.deliveryRun.update({
        where: { id: run.id },
        data: { managedListId: managedList.id },
      });
    }
    if (run.activityId) return await finishActivity(run, lease);
    if (run.status === "reconciling") return await reconcileStep(run, lease);
    await db.deliveryRun.updateMany({
      where: { id: run.id, leaseUntil: lease },
      data: { status: "running" },
    });

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
      return beginReconciliation(run.id, lease);
    }
    const mappings = Array.isArray(run.mappings)
      ? (run.mappings as unknown as FieldMapping[])
      : [];
    const prepared = members.map((member) => prepareContact(member, mappings));
    const contacts = prepared.flatMap((row) =>
      row.contact ? [row.contact] : [],
    );
    const batch: ImportBatch = {
      cursor: members.at(-1)!.salesforceId,
      processed: members.length,
      submitted: contacts.length,
      skipped: members.length - contacts.length,
      contacts: prepared.flatMap((row, index) =>
        row.contact
          ? [
              {
                salesforceId: members[index].salesforceId,
                name: members[index].name,
                email: row.contact.email,
              },
            ]
          : [],
      ),
      issues: prepared.flatMap((row) => (row.issue ? [row.issue] : [])),
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
        activityKind: "import",
        activityProgress: Number(activity.percent_done) || 0,
        batch: batch as unknown as Prisma.InputJsonValue,
        leaseUntil: null,
      },
    });
    return db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
  } catch (error) {
    await db.deliveryRun.updateMany({
      where: { id, leaseUntil: lease, status: { in: active } },
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
  const removing = run.activityKind === "remove";
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
          errors.join(" ").slice(0, 1000) ||
          `${removing ? "List cleanup" : "Import"} ${state || "failed"}.`,
        leaseUntil: null,
      },
    });
    throw new AppError(
      `Constant Contact could not finish this ${removing ? "list cleanup" : "import"} batch. Resume to retry it.`,
      502,
    );
  }
  const failed = Math.max(
    Number(activity.status?.error_count) || 0,
    Number(activity.status?.cannot_add_to_list_count) || 0,
    errors.length,
  );
  if (removing) {
    if (failed) {
      await db.deliveryRun.updateMany({
        where: { id: run.id, leaseUntil: lease },
        data: {
          status: "paused",
          activityId: null,
          activityKind: null,
          activityProgress: 0,
          batch: Prisma.JsonNull,
          error: `${failed} list memberships could not be removed. Resume to retry them.`,
          leaseUntil: null,
        },
      });
      throw new AppError(
        "Constant Contact could not remove every stale list membership. Resume to retry them.",
        502,
      );
    }
    const batch = run.batch as unknown as RemovalBatch;
    await db.$transaction([
      db.managedListMember.deleteMany({
        where: {
          managedListId: run.managedListId!,
          email: { in: batch.emails },
        },
      }),
      db.deliveryRun.updateMany({
        where: { id: run.id, leaseUntil: lease },
        data: {
          removed: { increment: batch.emails.length },
          activityId: null,
          activityKind: null,
          activityProgress: 0,
          batch: Prisma.JsonNull,
          leaseUntil: null,
        },
      }),
    ]);
    return db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
  }
  const batch = run.batch as unknown as ImportBatch;
  batch.issues = [
    ...(batch.issues ?? []),
    ...activityIssues(errors, batch.contacts ?? [], batch.cursor),
  ];
  return commitBatch(run, lease, batch, failed);
}

export function activityIssues(
  errors: string[],
  contacts: SubmittedContact[],
  batchKey: string,
): DeliveryIssueInput[] {
  return errors.map((detail, index) => {
    const line = Number(detail.match(/\bLine\s+(\d+)/i)?.[1]);
    const contact = Number.isInteger(line) ? contacts[line - 2] : undefined;
    return {
      key: contact?.email
        ? `provider:${contact.email}`
        : `provider:${batchKey}:${index}`,
      category: "constant_contact",
      reason: "Constant Contact rejected this contact's data",
      salesforceId: contact?.salesforceId,
      name: contact?.name,
      email: contact?.email,
      detail,
    };
  });
}

async function commitBatch(
  run: Awaited<ReturnType<typeof db.deliveryRun.findUniqueOrThrow>>,
  lease: Date,
  batch: ImportBatch,
  failed: number,
) {
  const processed = run.processed + batch.processed;
  const totalFailed = run.failed + failed;
  const done = processed === run.total;
  if (processed > run.total)
    throw new AppError("Delivery progress exceeds the source snapshot.", 409);
  await db.$transaction([
    db.deliveryRun.updateMany({
      where: { id: run.id, leaseUntil: lease },
      data: {
        cursor: batch.cursor,
        processed,
        submitted: { increment: batch.submitted },
        skipped: { increment: batch.skipped },
        failed: { increment: failed },
        activityId: null,
        activityKind: null,
        activityProgress: 0,
        batch: Prisma.JsonNull,
        status: done ? "reconciling" : "running",
        error: null,
        leaseUntil: null,
      },
    }),
    ...((batch.issues ?? []).length
      ? [
          db.deliveryIssue.createMany({
            data: batch.issues.map((issue) => ({
              deliveryId: run.id,
              ...issue,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
  return db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
}

async function beginReconciliation(id: string, lease: Date) {
  await db.deliveryRun.updateMany({
    where: { id, leaseUntil: lease },
    data: {
      status: "reconciling",
      activityId: null,
      activityKind: null,
      activityProgress: 0,
      batch: Prisma.JsonNull,
      leaseUntil: null,
    },
  });
  return db.deliveryRun.findUniqueOrThrow({ where: { id } });
}

type ListContact = {
  contact_id?: unknown;
  email_address?: { address?: unknown };
};

export function managedContactRows(
  contacts: ListContact[],
  desired: Set<string>,
  managed: Map<string, { desiredDeliveryId: string | null }>,
  deliveryId: string,
) {
  return contacts.flatMap((contact) => {
    const email = normalizedEmail(
      typeof contact.email_address?.address === "string"
        ? contact.email_address.address
        : null,
    );
    if (!email || typeof contact.contact_id !== "string") return [];
    const current = managed.get(email);
    if (!desired.has(email) && !current) return [];
    return [
      {
        email,
        contactId: contact.contact_id,
        seenDeliveryId: deliveryId,
        desiredDeliveryId: desired.has(email)
          ? deliveryId
          : current!.desiredDeliveryId,
      },
    ];
  });
}

async function reconcileStep(
  run: Awaited<ReturnType<typeof db.deliveryRun.findUniqueOrThrow>>,
  lease: Date,
) {
  const managedList = await db.managedList.findUniqueOrThrow({
    where: { id: run.managedListId! },
  });
  const previousDelivery = !managedList.initializedAt
    ? await db.deliveryRun.findFirst({
        where: {
          id: { not: run.id },
          audienceId: run.audienceId,
          accountId: run.accountId,
          listId: run.listId,
          status: { in: ["completed", "completed_with_errors"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, sourceRunId: true },
      })
    : null;
  if (!run.reconcileScannedAt) {
    const path =
      run.reconcileCursor ||
      `/v3/contacts?lists=${encodeURIComponent(run.listId)}&status=all&limit=500`;
    const page = await providerRequest("constant-contact", path);
    if (!Array.isArray(page?.contacts))
      throw new AppError(
        "Constant Contact returned an incomplete list page. No contacts were removed.",
        502,
      );
    const emails = page.contacts
      .map((contact: ListContact) =>
        normalizedEmail(
          typeof contact.email_address?.address === "string"
            ? contact.email_address.address
            : null,
        ),
      )
      .filter((email: string | null): email is string => Boolean(email));
    const sourceRunIds = [
      run.sourceRunId,
      ...(previousDelivery ? [previousDelivery.sourceRunId] : []),
    ];
    const [sourceMembers, existingMembers] = await Promise.all([
      db.audienceMember.findMany({
        where: {
          runId: { in: sourceRunIds },
          optedOut: false,
          normalizedEmail: { in: emails },
        },
        distinct: ["runId", "normalizedEmail"],
        select: { runId: true, normalizedEmail: true },
      }),
      db.managedListMember.findMany({
        where: { managedListId: managedList.id, email: { in: emails } },
        select: { email: true, desiredDeliveryId: true },
      }),
    ]);
    const desired = new Set(
      sourceMembers.flatMap((member) =>
        member.runId === run.sourceRunId && member.normalizedEmail
          ? [member.normalizedEmail]
          : [],
      ),
    );
    const managed = new Map(
      existingMembers.map((member) => [member.email, member]),
    );
    if (previousDelivery)
      for (const member of sourceMembers)
        if (
          member.runId === previousDelivery.sourceRunId &&
          member.normalizedEmail &&
          !managed.has(member.normalizedEmail)
        )
          managed.set(member.normalizedEmail, {
            email: member.normalizedEmail,
            desiredDeliveryId: previousDelivery.id,
          });
    const rows = managedContactRows(page.contacts, desired, managed, run.id);
    if (rows.length) {
      const values = Prisma.join(
        rows.map(
          (row) =>
            Prisma.sql`(${managedList.id}, ${row.email}, ${row.contactId}, ${row.seenDeliveryId}, ${row.desiredDeliveryId})`,
        ),
      );
      await db.$executeRaw(Prisma.sql`
        INSERT INTO "forcemultiplier"."ManagedListMember"
          ("managedListId", "email", "contactId", "seenDeliveryId", "desiredDeliveryId")
        VALUES ${values}
        ON CONFLICT ("managedListId", "email") DO UPDATE SET
          "contactId" = EXCLUDED."contactId",
          "seenDeliveryId" = EXCLUDED."seenDeliveryId",
          "desiredDeliveryId" = EXCLUDED."desiredDeliveryId"
      `);
    }
    const next =
      typeof page?._links?.next?.href === "string"
        ? page._links.next.href
        : null;
    if (next && next === path)
      throw new AppError(
        "Constant Contact list pagination did not advance. No contacts were removed.",
        502,
      );
    if (next) {
      await db.deliveryRun.updateMany({
        where: { id: run.id, leaseUntil: lease },
        data: { reconcileCursor: next, leaseUntil: null },
      });
      return db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    }
    await db.$transaction([
      db.managedListMember.deleteMany({
        where: {
          managedListId: managedList.id,
          OR: [
            { seenDeliveryId: { not: run.id } },
            { seenDeliveryId: { equals: "" } },
          ],
        },
      }),
      db.deliveryRun.updateMany({
        where: { id: run.id, leaseUntil: lease },
        data: { reconcileScannedAt: new Date() },
      }),
      ...(previousDelivery
        ? [
            db.managedList.updateMany({
              where: { id: managedList.id, initializedAt: null },
              data: { initializedAt: new Date() },
            }),
          ]
        : []),
    ]);
    await recordMissingContacts(run);
    if (!managedList.initializedAt && !previousDelivery)
      return finishReconciliation(run.id, lease);
    await db.deliveryRun.updateMany({
      where: { id: run.id, leaseUntil: lease },
      data: { leaseUntil: null },
    });
    return db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
  }

  const stale = await db.managedListMember.findMany({
    where: {
      managedListId: managedList.id,
      seenDeliveryId: run.id,
      OR: [{ desiredDeliveryId: null }, { desiredDeliveryId: { not: run.id } }],
    },
    take: 500,
  });
  if (!stale.length) return finishReconciliation(run.id, lease);
  const batch: RemovalBatch = {
    emails: stale.map((member) => member.email),
    contactIds: stale.map((member) => member.contactId),
  };
  const activity = await providerRequest(
    "constant-contact",
    "/v3/activities/remove_list_memberships",
    {
      method: "POST",
      body: JSON.stringify({
        source: { contact_ids: batch.contactIds },
        list_ids: [run.listId],
      }),
    },
  );
  if (typeof activity?.activity_id !== "string")
    throw new AppError("Constant Contact did not start list cleanup.", 502);
  await db.deliveryRun.updateMany({
    where: { id: run.id, leaseUntil: lease, activityId: null },
    data: {
      activityId: activity.activity_id,
      activityKind: "remove",
      activityProgress: Number(activity.percent_done) || 0,
      batch: batch as unknown as Prisma.InputJsonValue,
      leaseUntil: null,
    },
  });
  return db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
}

async function recordMissingContacts(
  run: Awaited<ReturnType<typeof db.deliveryRun.findUniqueOrThrow>>,
) {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "forcemultiplier"."DeliveryIssue"
      ("deliveryId", "key", "category", "reason", "salesforceId", "name", "email", "detail")
    SELECT
      ${run.id},
      'provider:' || member."normalizedEmail",
      'constant_contact',
      'Not added to the selected Constant Contact list',
      min(member."salesforceId"),
      min(member."name"),
      min(member."email"),
      CASE WHEN count(*) > 1
        THEN count(*)::text || ' Salesforce contacts share this email address.'
        ELSE NULL
      END
    FROM "forcemultiplier"."AudienceMember" member
    WHERE member."runId" = ${run.sourceRunId}
      AND member."optedOut" = false
      AND member."normalizedEmail" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "forcemultiplier"."ManagedListMember" managed
        WHERE managed."managedListId" = ${run.managedListId}
          AND managed."email" = member."normalizedEmail"
          AND managed."desiredDeliveryId" = ${run.id}
      )
    GROUP BY member."normalizedEmail"
    ON CONFLICT ("deliveryId", "key") DO NOTHING
  `);

  // ponytail: diagnose 25 addresses inline; add a queued diagnostic phase if large failed imports become common.
  const issues = await db.deliveryIssue.findMany({
    where: {
      deliveryId: run.id,
      category: "constant_contact",
      reason: "Not added to the selected Constant Contact list",
      email: { not: null },
    },
    take: 25,
  });
  const results = await Promise.allSettled(
    issues.map(async (issue) => {
      const page = await providerRequest(
        "constant-contact",
        `/v3/contacts?email=${encodeURIComponent(issue.email!)}&status=all&limit=1`,
      );
      const contact = Array.isArray(page?.contacts) ? page.contacts[0] : null;
      const permission = String(
        contact?.email_address?.permission_to_send || "",
      );
      const labels: Record<string, string> = {
        unsubscribed: "Unsubscribed in Constant Contact",
        temp_hold: "On temporary hold in Constant Contact",
        pending_confirmation: "Awaiting confirmation in Constant Contact",
        not_set: "No email permission in Constant Contact",
        deleted: "Deleted in Constant Contact",
      };
      const optOutReason = contact?.email_address?.opt_out_reason;
      return {
        key: issue.key,
        reason:
          labels[permission] ||
          (contact
            ? "Constant Contact did not add this contact to the selected list"
            : "Constant Contact did not create this contact"),
        detail:
          [
            issue.detail,
            typeof optOutReason === "string" && optOutReason
              ? `Opt-out reason: ${optOutReason}`
              : null,
          ]
            .filter(Boolean)
            .join(" ") || null,
      };
    }),
  );
  const diagnosed = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (diagnosed.length)
    await db.$transaction(
      diagnosed.map((issue) =>
        db.deliveryIssue.update({
          where: { deliveryId_key: { deliveryId: run.id, key: issue.key } },
          data: { reason: issue.reason, detail: issue.detail },
        }),
      ),
    );
}

async function finishReconciliation(id: string, lease: Date) {
  const run = await db.deliveryRun.findUniqueOrThrow({ where: { id } });
  const status = run.failed ? "completed_with_errors" : "completed";
  await db.$transaction([
    db.managedList.updateMany({
      where: { id: run.managedListId!, initializedAt: null },
      data: { initializedAt: new Date() },
    }),
    db.deliveryRun.updateMany({
      where: { id, status: "reconciling", leaseUntil: lease },
      data: {
        status,
        finishedAt: new Date(),
        leaseUntil: null,
        error: run.failed
          ? `${run.failed} contact rows could not be imported.`
          : null,
      },
    }),
  ]);
  return db.deliveryRun.findUniqueOrThrow({ where: { id } });
}
