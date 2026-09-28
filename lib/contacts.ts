import { db } from "./db";
import { sfId } from "./soql";

type FieldSnapshot = {
  data: unknown;
  run: {
    fields: unknown;
    finishedAt: Date | null;
    createdAt: Date;
    audience: { id: string; name: string };
  };
};

function valueAt(record: unknown, path: string) {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      record,
    );
}

export function contactFieldValues(snapshots: FieldSnapshot[]) {
  const values = new Map<
    string,
    {
      field: string;
      value: unknown;
      audience: FieldSnapshot["run"]["audience"];
      capturedAt: Date;
    }
  >();
  for (const snapshot of snapshots) {
    const fields = Array.isArray(snapshot.run.fields)
      ? snapshot.run.fields.filter(
          (field): field is string => typeof field === "string",
        )
      : [];
    for (const field of fields)
      if (!values.has(field))
        values.set(field, {
          field,
          value: valueAt(snapshot.data, field),
          audience: snapshot.run.audience,
          capturedAt: snapshot.run.finishedAt ?? snapshot.run.createdAt,
        });
  }
  return [...values.values()].sort((a, b) => a.field.localeCompare(b.field));
}

export function displayContactValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export async function getContactDetail(salesforceId: string) {
  if (!sfId(salesforceId)) return null;
  // ponytail: this scans contact history by Salesforce ID; add a dedicated index if snapshot volume makes the detail view slow.
  const snapshots = await db.audienceMember.findMany({
    where: { salesforceId, run: { status: "completed" } },
    orderBy: { run: { createdAt: "desc" } },
    include: {
      run: {
        select: {
          id: true,
          audienceId: true,
          orgId: true,
          fields: true,
          createdAt: true,
          finishedAt: true,
          audience: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!snapshots.length) return null;

  const audienceIds = [...new Set(snapshots.map((row) => row.run.audienceId))];
  const emails = [
    ...new Set(
      snapshots
        .map((row) => row.normalizedEmail)
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const [
    latestRuns,
    campaigns,
    suppressions,
    suppressionEvents,
    unsubscribeEvents,
    deliveryIssues,
    resubscriptions,
    salesforce,
  ] = await Promise.all([
    db.pullRun.findMany({
      where: { audienceId: { in: audienceIds }, status: "completed" },
      orderBy: [{ audienceId: "asc" }, { createdAt: "desc" }],
      distinct: ["audienceId"],
      select: { id: true, audienceId: true },
    }),
    db.campaignRecipient.findMany({
      where: { salesforceId },
      orderBy: { updatedAt: "desc" },
      include: {
        send: {
          select: {
            id: true,
            status: true,
            serviceNotice: true,
            subject: true,
            fromName: true,
            fromEmail: true,
            createdAt: true,
            updatedAt: true,
            finishedAt: true,
            campaign: { select: { id: true, name: true } },
          },
        },
      },
    }),
    emails.length
      ? db.suppression.findMany({
          where: { email: { in: emails } },
          orderBy: { createdAt: "desc" },
        })
      : [],
    db.suppressionEvent.findMany({
      where: {
        OR: [
          { salesforceId },
          ...(emails.length ? [{ email: { in: emails } }] : []),
        ],
      },
      orderBy: { recordedAt: "desc" },
      take: 100,
    }),
    emails.length
      ? db.unsubscribeEvent.findMany({
          where: { OR: [{ salesforceId }, { email: { in: emails } }] },
          orderBy: { discoveredAt: "desc" },
          take: 50,
        })
      : [],
    db.deliveryIssue.findMany({
      where: { salesforceId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        delivery: {
          select: {
            id: true,
            listName: true,
            audience: { select: { id: true, name: true } },
          },
        },
      },
    }),
    db.resubscribeMember.findMany({
      where: { salesforceId },
      orderBy: { processedAt: "desc" },
      take: 50,
      include: {
        job: { select: { id: true, name: true, createdAt: true } },
      },
    }),
    db.connection.findUnique({
      where: { provider: "salesforce" },
      select: { externalId: true, instanceUrl: true },
    }),
  ]);

  const latest = snapshots[0]!;
  const latestByAudience = new Map(
    latestRuns.map((run) => [run.audienceId, run.id]),
  );
  const audienceMemberships = [
    ...new Map(
      snapshots.map((snapshot) => [snapshot.run.audienceId, snapshot]),
    ).values(),
  ].map((snapshot) => ({
    id: snapshot.run.audience.id,
    name: snapshot.run.audience.name,
    current: latestByAudience.get(snapshot.run.audienceId) === snapshot.run.id,
    lastSeenAt: snapshot.run.finishedAt ?? snapshot.run.createdAt,
  }));
  const currentSuppression = suppressions.find(
    (row) => row.email === latest.normalizedEmail,
  );
  const activity = [
    ...suppressionEvents.map((event) => ({
      id: `suppression:${event.id}`,
      at: event.recordedAt,
      type: "Consent",
      title: event.source.replaceAll("_", " "),
      detail: [event.direction.replaceAll("_", " "), event.status]
        .filter(Boolean)
        .join(" · "),
    })),
    ...unsubscribeEvents.map((event) => ({
      id: `unsubscribe:${event.accountId}:${event.contactId}`,
      at: event.discoveredAt,
      type: "Unsubscribe",
      title: event.optOutSource || "Constant Contact",
      detail: event.status.replaceAll("_", " "),
    })),
    ...deliveryIssues.map((issue) => ({
      id: `delivery:${issue.deliveryId}:${issue.key}`,
      at: issue.createdAt,
      type: "Delivery issue",
      title: issue.reason,
      detail: `${issue.delivery.listName} · ${issue.delivery.audience.name}${issue.detail ? ` · ${issue.detail}` : ""}`,
    })),
    ...resubscriptions.map((member) => ({
      id: `resubscribe:${member.jobId}:${member.email}`,
      at: member.processedAt ?? member.job.createdAt,
      type: "Resubscription",
      title: member.job.name,
      detail: member.status.replaceAll("_", " "),
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 100);

  return {
    salesforceId,
    name: latest.name || "Unnamed contact",
    email: latest.email,
    normalizedEmail: latest.normalizedEmail,
    optedOut: latest.optedOut,
    orgId: latest.run.orgId,
    capturedAt: latest.run.finishedAt ?? latest.run.createdAt,
    firstSeenAt:
      snapshots.at(-1)!.run.finishedAt ?? snapshots.at(-1)!.run.createdAt,
    historicalEmails: emails,
    fields: contactFieldValues(snapshots),
    audiences: audienceMemberships,
    campaigns,
    suppressions,
    currentSuppression,
    activity,
    salesforceUrl:
      salesforce?.externalId === latest.run.orgId && salesforce.instanceUrl
        ? `${salesforce.instanceUrl}/lightning/r/Contact/${salesforceId}/view`
        : null,
  };
}
