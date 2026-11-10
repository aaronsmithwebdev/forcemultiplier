import { randomUUID } from "node:crypto";
import { Prisma, type Person } from "@prisma/client";
import { db } from "./db";
import { normalizedEmail } from "./email";
import { AppError } from "./errors";
import { connection, sfQuery } from "./providers";
import { quote } from "./soql";
import {
  buildContactCondition,
  buildContactQuery,
  type QueryGroup,
} from "./query-builder";
import { enrich } from "./salesforce";

type Store = Prisma.TransactionClient;
export async function peopleOrg() {
  const account = await connection("salesforce");
  if (!account.tokens || !account.externalId)
    throw new AppError("Connect Salesforce first.", 409);
  return { orgId: account.externalId, version: account.version };
}

export async function saveSalesforcePeople(
  orgId: string,
  records: Record<string, any>[],
  tx: Store = db,
): Promise<Person[]> {
  if (!records.length) return [];
  if (tx === db)
    return db.$transaction(
      async (store) => {
        await lockPeople(store, orgId);
        return saveSalesforcePeople(orgId, records, store);
      },
      { timeout: 15000 },
    );
  const unique = [...new Map(records.map((r) => [r.Id, r])).values()];
  for (const r of unique)
    if (
      typeof r.Id !== "string" ||
      !/^003[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(r.Id) ||
      typeof r.HasOptedOutOfEmail !== "boolean" ||
      (r.Email != null &&
        (typeof r.Email !== "string" || r.Email.length > 254)) ||
      [r.FirstName, r.LastName].some(
        (value) =>
          value != null && (typeof value !== "string" || value.length > 255),
      )
    )
      throw new AppError("Salesforce returned invalid person details.", 502);
  const rows = await tx.$queryRaw<Person[]>(Prisma.sql`
    INSERT INTO "forcemultiplier"."Person" (id, "orgId", "salesforceId", email, "firstName", "lastName", "optedOut", source, "updatedAt")
    VALUES ${Prisma.join(unique.map((r) => Prisma.sql`(${randomUUID()}, ${orgId}, ${r.Id}, ${normalizedEmail(r.Email)}, ${r.FirstName || null}, ${r.LastName || null}, ${r.HasOptedOutOfEmail}, 'salesforce', NOW())`))}
    ON CONFLICT ("orgId", "salesforceId") DO UPDATE SET
      email = EXCLUDED.email, "firstName" = EXCLUDED."firstName", "lastName" = EXCLUDED."lastName",
      "optedOut" = EXCLUDED."optedOut", "updatedAt" = NOW()
    RETURNING *
  `);
  await rememberEmails(rows, tx);
  return rows;
}

async function rememberEmails(people: Person[], tx: Store) {
  const data = people.flatMap((p) =>
    p.email ? [{ personId: p.id, email: p.email }] : [],
  );
  if (data.length)
    await tx.personEmail.createMany({ data, skipDuplicates: true });
}

// All import and source writers use the same transaction lock to avoid duplicate local identities.
export async function lockPeople(tx: Store, orgId: string) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`people:${orgId}`}, 0))`,
  );
}

type SourceRow = {
  id: string;
  salesforceId?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};
export async function sourcePeople(
  tx: Store,
  orgId: string,
  source: string,
  rows: SourceRow[],
) {
  const identities = await tx.personSource.findMany({
    where: { orgId, source, sourceId: { in: rows.map((r) => r.id) } },
    include: { person: true },
  });
  const existing = await tx.person.findMany({
    where: {
      orgId,
      mergedIntoId: null,
      OR: [
        {
          salesforceId: {
            in: rows.flatMap((r) => (r.salesforceId ? [r.salesforceId] : [])),
          },
        },
        { email: { in: rows.flatMap((r) => (r.email ? [r.email] : [])) } },
      ],
    },
  });
  const bySource = new Map(identities.map((i) => [i.sourceId, i.person]));
  const bySalesforce = new Map(
    existing.filter((p) => p.salesforceId).map((p) => [p.salesforceId!, p]),
  );
  const byEmail = new Map<string, Person[]>();
  for (const person of existing)
    if (person.email)
      byEmail.set(person.email, [...(byEmail.get(person.email) || []), person]);
  const created: Prisma.PersonCreateManyInput[] = [];
  const sources: Prisma.PersonSourceCreateManyInput[] = [];
  const result = new Map<string, string>();
  for (const row of rows) {
    let person = bySource.get(row.id);
    if (person?.mergedIntoId)
      person =
        existing.find((p) => p.id === person!.mergedIntoId) ||
        (await tx.person.findUniqueOrThrow({
          where: { id: person.mergedIntoId },
        }));
    const crm = row.salesforceId
      ? bySalesforce.get(row.salesforceId)
      : undefined;
    if (person && crm && person.id !== crm.id) {
      if (person.salesforceId)
        throw new AppError(
          "Funraisin changed an established Salesforce link. Review this source record.",
          409,
        );
      // ponytail: verified link transfers run per person within the 1,000-row / 60-second source page; batch transfers if link-heavy pages reach that ceiling.
      person = await linkPeople(tx, person.id, crm.id, source);
      for (const [sourceId, id] of result)
        if (id === crm.id) result.set(sourceId, person.id);
      for (const pending of sources)
        if (pending.personId === crm.id) pending.personId = person.id;
      bySalesforce.set(row.salesforceId!, person);
      for (const [key, p] of bySource)
        if (p.id === crm.id || p.id === person.id) bySource.set(key, person);
      for (const [email, people] of byEmail)
        byEmail.set(
          email,
          people.filter((p) => p.id !== crm.id && p.id !== person!.id),
        );
      if (person.email)
        byEmail.set(person.email, [
          ...(byEmail.get(person.email) || []),
          person,
        ]);
    }
    if (!person) {
      const candidates = row.email ? byEmail.get(row.email) || [] : [];
      person = crm || (candidates.length === 1 ? candidates[0] : undefined);
      if (!person) {
        person = {
          id: randomUUID(),
          orgId,
          salesforceId: null,
          email: normalizedEmail(row.email),
          firstName: row.firstName || row.name || null,
          lastName: row.lastName || null,
          optedOut: false,
          unavailable: false,
          mergedIntoId: null,
          source,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        created.push(person);
        if (person.email)
          byEmail.set(person.email, [
            ...(byEmail.get(person.email) || []),
            person,
          ]);
      }
      sources.push({ orgId, source, sourceId: row.id, personId: person.id });
    }
    result.set(row.id, person.id);
  }
  if (created.length) await tx.person.createMany({ data: created });
  if (sources.length) await tx.personSource.createMany({ data: sources });
  const emails = rows.flatMap((row) =>
    row.email ? [{ personId: result.get(row.id)!, email: row.email }] : [],
  );
  if (emails.length)
    await tx.personEmail.createMany({ data: emails, skipDuplicates: true });
  const profiles = [
    ...new Map(rows.map((row) => [result.get(row.id)!, row])).entries(),
  ];
  if (profiles.length)
    await tx.$executeRaw(Prisma.sql`
    UPDATE "forcemultiplier"."Person" p SET
      email=CASE WHEN p.source=${source} THEN COALESCE(r.email,p.email) ELSE COALESCE(p.email,r.email) END,
      "firstName"=CASE WHEN p.source=${source} THEN COALESCE(r.name,p."firstName") ELSE COALESCE(p."firstName",r.name) END,
      "lastName"=CASE WHEN p.source=${source} THEN COALESCE(r.last_name,p."lastName") ELSE COALESCE(p."lastName",r.last_name) END,
      "updatedAt"=NOW()
    FROM (VALUES ${Prisma.join(profiles.map(([id, row]) => Prisma.sql`(${id},${normalizedEmail(row.email)},${row.firstName || row.name || null},${row.lastName || null})`))}) r(id,email,name,last_name)
    WHERE p.id=r.id AND p."salesforceId" IS NULL AND p."mergedIntoId" IS NULL
  `);
  return result;
}

export async function findSalesforceEmails(emails: string[], orgId: string) {
  const records: Record<string, any>[] = [];
  for (let i = 0; i < emails.length; i += 100) {
    const query = `SELECT Id, Email, FirstName, LastName, HasOptedOutOfEmail FROM Contact WHERE Email IN (${emails
      .slice(i, i + 100)
      .map(quote)
      .join(",")})`;
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await sfQuery(query, cursor, orgId);
      if (
        !Array.isArray(page.records) ||
        typeof page.done !== "boolean" ||
        (!page.done && (!page.nextRecordsUrl || seen.has(page.nextRecordsUrl)))
      )
        throw new AppError(
          "Salesforce matching was incomplete. Try again.",
          502,
        );
      records.push(...page.records);
      cursor = page.done ? undefined : page.nextRecordsUrl;
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  const current = await peopleOrg();
  if (current.orgId !== orgId)
    throw new AppError("Salesforce org changed during matching.", 409);
  return records;
}

export async function refreshPeople(people: Person[], orgId: string) {
  const linked = people.filter((p) => p.salesforceId);
  if (!linked.length) return people;
  const records = await enrich(
    linked.map((p) => ({ Id: p.salesforceId })),
    [],
    orgId,
    true,
  );
  const updated = await saveSalesforcePeople(orgId, records);
  await applySalesforceExclusions(orgId, updated);
  const visible = new Set(records.map((r) => r.Id));
  const byId = new Map(updated.map((p) => [p.id, p]));
  return people.map(
    (p) =>
      byId.get(p.id) ||
      (p.salesforceId && !visible.has(p.salesforceId)
        ? { ...p, optedOut: true, unavailable: true }
        : p),
  );
}

export function personRecord(person: Person) {
  return {
    PersonId: person.id,
    Id: person.salesforceId,
    Email: person.email,
    FirstName: person.firstName,
    LastName: person.lastName,
    HasOptedOutOfEmail: person.optedOut || person.unavailable,
  };
}

export async function linkPeople(
  tx: Store,
  localId: string,
  crmId: string,
  createdBy: string,
) {
  const local = await tx.person.findUniqueOrThrow({ where: { id: localId } });
  const crm = await tx.person.findUniqueOrThrow({ where: { id: crmId } });
  if (
    local.orgId !== crm.orgId ||
    local.mergedIntoId ||
    crm.mergedIntoId ||
    !crm.salesforceId ||
    local.salesforceId
  )
    throw new AppError(
      "These people cannot be linked. Refresh their details.",
      409,
    );
  await tx.person.update({
    where: { id: crm.id },
    data: { salesforceId: null, mergedIntoId: local.id },
  });
  await tx.person.updateMany({
    where: { mergedIntoId: crm.id },
    data: { mergedIntoId: local.id },
  });
  const updated = await tx.person.update({
    where: { id: local.id },
    data: {
      salesforceId: crm.salesforceId,
      email: crm.email,
      firstName: crm.firstName,
      lastName: crm.lastName,
      optedOut: local.optedOut || crm.optedOut,
      unavailable: crm.unavailable,
    },
  });
  await tx.personSource.updateMany({
    where: { personId: crm.id },
    data: { personId: local.id },
  });
  await tx.funraisinParticipant.updateMany({
    where: { personId: crm.id },
    data: { personId: local.id },
  });
  await tx.funraisinDonation.updateMany({
    where: { personId: crm.id },
    data: { personId: local.id },
  });
  const emails = await tx.personEmail.findMany({ where: { personId: crm.id } });
  await tx.personEmail.createMany({
    data: emails.map((e) => ({ personId: local.id, email: e.email })),
    skipDuplicates: true,
  });
  await tx.personSource.create({
    data: {
      orgId: local.orgId,
      source: "salesforce-link",
      sourceId: `${local.id}:${crm.salesforceId}:${createdBy}`,
      personId: local.id,
    },
  });
  // Previous unmatched opt-outs must be considered again now that a CRM link exists.
  await tx.suppressionEvent.updateMany({
    where: {
      orgId: local.orgId,
      direction: "forcemultiplier_to_salesforce",
      status: { in: ["queued", "unmatched", "ambiguous"] },
      email: {
        in: [local.email, ...emails.map((e) => e.email)].filter(
          (v): v is string => !!v,
        ),
      },
    },
    data: {
      status: "pending",
      salesforceId: crm.salesforceId,
      attempts: 0,
      error: null,
      availableAt: new Date(),
    },
  });
  return updated;
}

export async function personLinkCandidates(id: string) {
  const { orgId } = await peopleOrg();
  const person = await db.person.findFirst({
    where: { id, orgId, mergedIntoId: null },
  });
  if (!person || person.salesforceId)
    throw new AppError("Choose an unlinked local person.", 409);
  const records = person.email
    ? await findSalesforceEmails([person.email], orgId)
    : [];
  const people = await saveSalesforcePeople(orgId, records);
  await applySalesforceExclusions(orgId, people);
  return people.map((p) => ({
    id: p.id,
    salesforceId: p.salesforceId!,
    name: [p.firstName, p.lastName].filter(Boolean).join(" "),
    email: p.email,
    optedOut: p.optedOut,
  }));
}

export async function confirmPersonLink(
  id: string,
  salesforceId: string,
  createdBy: string,
) {
  const candidates = await personLinkCandidates(id);
  const crm = candidates.find((p) => p.salesforceId === salesforceId);
  if (!crm)
    throw new AppError(
      "This Contact no longer matches. Review the link again.",
      409,
    );
  const { orgId } = await peopleOrg();
  return db.$transaction(
    async (tx) => {
      await lockPeople(tx, orgId);
      return linkPeople(tx, id, crm.id, createdBy);
    },
    { timeout: 15000 },
  );
}

export async function applySalesforceExclusions(
  orgId: string,
  people: Person[],
) {
  const sync = await db.contactMirrorSync.findUnique({
    where: { id: "salesforce" },
  });
  const rules =
    sync?.exclusions && sync.orgId === orgId
      ? (sync.exclusions as unknown as QueryGroup)
      : ({ conjunction: "AND", items: [] } as QueryGroup);
  buildContactQuery(rules);
  const condition = buildContactCondition(rules);
  const ids = people.flatMap((p) => (p.salesforceId ? [p.salesforceId] : []));
  if (!ids.length) return;
  const excluded = new Set<string>();
  for (let i = 0; condition && i < ids.length; i += 100) {
    const query = `SELECT Id FROM Contact WHERE Id IN (${ids
      .slice(i, i + 100)
      .map(quote)
      .join(",")}) AND (${condition})`;
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await sfQuery(query, cursor, orgId);
      if (
        !Array.isArray(page.records) ||
        typeof page.done !== "boolean" ||
        (!page.done && (!page.nextRecordsUrl || seen.has(page.nextRecordsUrl)))
      )
        throw new AppError("Salesforce exclusions were incomplete.", 502);
      for (const r of page.records) excluded.add(r.Id);
      cursor = page.done ? undefined : page.nextRecordsUrl;
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  const blocked = people.filter(
    (p) => p.salesforceId && excluded.has(p.salesforceId),
  );
  const allowed = people.filter(
    (p) => p.salesforceId && !excluded.has(p.salesforceId),
  );
  for (const [group, unavailable] of [
    [blocked, true],
    [allowed, false],
  ] as const) {
    if (!group.length) continue;
    await db.person.updateMany({
      where: { orgId, id: { in: group.map((p) => p.id) } },
      data: { unavailable },
    });
    group.forEach((p) => (p.unavailable = unavailable));
  }
}
