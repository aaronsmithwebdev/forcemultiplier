import { randomUUID } from "node:crypto";
import { Prisma, type Person } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { AppError } from "./errors";
import { parseEmailCsv } from "./resubscribe-input";
import {
  applySalesforceExclusions,
  findSalesforceEmails,
  lockPeople,
  peopleOrg,
  saveSalesforcePeople,
} from "./people";

export const audienceImportInput = z.object({
  name: z.string().trim().min(1).max(120),
  audienceId: z.string().min(1).max(100).optional(),
  text: z.string().min(1).max(2_000_000),
  format: z.enum(["csv", "paste"]),
});
export type ImportRow = {
  row: number;
  email: string;
  firstName: string;
  lastName: string;
  status: "invalid" | "duplicate" | "matched" | "new" | "ambiguous";
  candidates: {
    id: string;
    name: string;
    salesforceId: string | null;
    currentEmail?: string | null;
  }[];
  existingMembership?: boolean;
  blocked: boolean;
  personId?: string;
};
export function parseAudienceImport(text: string, format: "csv" | "paste") {
  const rows: ImportRow[] = [];
  // ponytail: synchronous previews are limited to 2,000 rows / 2 MB; use a staged worker for larger lists.
  if (text.length > 2_000_000)
    throw new AppError("Import must be 2 MB or smaller.", 413);
  const csv =
    format === "paste"
      ? "Email\n" +
        text
          .split(/[\r\n;,]+/)
          .filter((v) => v.trim())
          .join("\n")
      : text;
  try {
    parseEmailCsv(csv, ({ values, headers, email, status }) => {
      if (rows.length >= 2000)
        throw new Error("Import at most 2,000 rows at a time.");
      const value = (key: string) =>
        (values[headers.indexOf(key)] || "").trim().slice(0, 150);
      rows.push({
        row: rows.length + 1,
        email: email || value("email") || value("emailaddress"),
        firstName: value("firstname"),
        lastName: value("lastname"),
        status: status === "valid" ? "new" : status,
        candidates: [],
        blocked: false,
      });
    });
  } catch (error) {
    throw new AppError((error as Error).message, 422);
  }
  return rows;
}

async function matchRows(
  rows: ImportRow[],
  orgId: string,
  audienceId?: string | null,
) {
  const emails = rows
    .filter((r) => !["invalid", "duplicate"].includes(r.status))
    .map((r) => r.email);
  const records = await findSalesforceEmails(emails, orgId);
  const linked = await saveSalesforcePeople(orgId, records);
  await applySalesforceExclusions(orgId, linked);
  const memberships = audienceId
    ? await db.manualAudienceMember.findMany({
        where: { audienceId, email: { in: emails } },
        include: { person: true },
      })
    : [];
  const memberIds = memberships.map((m) => m.person.mergedIntoId || m.personId);
  const [people, suppressions] = await Promise.all([
    db.person.findMany({
      where: {
        orgId,
        OR: [{ email: { in: emails } }, { id: { in: memberIds } }],
        mergedIntoId: null,
      },
      orderBy: { id: "asc" },
    }),
    db.suppression.findMany({ where: { email: { in: emails } } }),
  ]);
  const byEmail = new Map<string, Person[]>();
  for (const p of people)
    if (p.email) byEmail.set(p.email, [...(byEmail.get(p.email) || []), p]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const pinned = new Map(
    memberships.map((m) => [
      m.email,
      byId.get(m.person.mergedIntoId || m.personId),
    ]),
  );
  const blocked = new Set(suppressions.map((s) => s.email));
  return rows.map((r) => {
    if (["invalid", "duplicate"].includes(r.status)) return r;
    const member = pinned.get(r.email);
    const candidates = member ? [member] : byEmail.get(r.email) || [];
    return {
      ...r,
      existingMembership: !!member,
      status: (candidates.length > 1
        ? "ambiguous"
        : candidates.length
          ? "matched"
          : "new") as ImportRow["status"],
      blocked:
        blocked.has(r.email) ||
        candidates.some((p) => p.optedOut || p.unavailable),
      candidates: candidates.map((p) => ({
        id: p.id,
        name: [p.firstName, p.lastName].filter(Boolean).join(" ") || r.email,
        salesforceId: p.salesforceId,
        currentEmail: p.email,
      })),
    };
  });
}

export async function previewAudienceImport(
  input: z.infer<typeof audienceImportInput>,
  userId: string,
) {
  const { orgId } = await peopleOrg();
  if (
    input.audienceId &&
    !(await db.audience.findFirst({ where: { id: input.audienceId, orgId } }))
  )
    throw new AppError("Audience not found in this Salesforce org.", 404);
  const rows = await matchRows(
    parseAudienceImport(input.text, input.format),
    orgId,
    input.audienceId,
  );
  return db.audienceImport.create({
    data: {
      orgId,
      audienceId: input.audienceId,
      name: input.name,
      createdBy: userId,
      rows: rows as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function commitAudienceImport(
  id: string,
  resolutions: Record<string, string>,
  userId: string,
) {
  const { orgId } = await peopleOrg();
  const preview = await db.audienceImport.findUnique({ where: { id } });
  if (!preview || preview.orgId !== orgId || preview.createdBy !== userId)
    throw new AppError("Import preview not found.", 404);
  if (preview.status === "committed") {
    if (!preview.audienceId)
      throw new AppError("The imported audience is no longer available.", 409);
    return {
      audienceId: preview.audienceId,
      added: 0,
      held: (preview.rows as unknown as ImportRow[]).filter(
        (r) => r.status === "ambiguous" && !r.personId,
      ).length,
    };
  }
  if (Date.now() - preview.createdAt.getTime() > 60 * 60_000)
    throw new AppError("This preview expired. Preview the list again.", 409);
  const before = preview.rows as unknown as ImportRow[];
  const rows = await matchRows(before, orgId, preview.audienceId);
  for (let i = 0; i < rows.length; i++)
    if (
      JSON.stringify(rows[i].candidates) !==
      JSON.stringify(before[i].candidates)
    )
      throw new AppError(
        "Matches changed. Preview this list again before importing.",
        409,
      );
  return db.$transaction(
    async (tx) => {
      await lockPeople(tx, orgId);
      const owned = await tx.audienceImport.updateMany({
        where: { id, status: "preview" },
        data: { status: "committing" },
      });
      if (!owned.count)
        throw new AppError("Import already changed. Refresh the page.", 409);
      const audience = preview.audienceId
        ? await tx.audience.findFirst({
            where: { id: preview.audienceId, orgId },
          })
        : await tx.audience.create({
            data: {
              name: preview.name,
              orgId,
              sourceType: "import",
              query: "import",
              fields: ["FirstName", "LastName"],
            },
          });
      if (!audience) throw new AppError("Audience no longer exists.", 409);
      const emails = rows
        .filter((r) => !["invalid", "duplicate"].includes(r.status))
        .map((r) => r.email);
      const people = await tx.person.findMany({
        where: {
          orgId,
          OR: [
            { email: { in: emails } },
            { id: { in: rows.flatMap((r) => r.candidates.map((p) => p.id)) } },
          ],
          mergedIntoId: null,
        },
        orderBy: { id: "asc" },
      });
      const byEmail = new Map<string, Person[]>();
      for (const p of people)
        if (p.email) byEmail.set(p.email, [...(byEmail.get(p.email) || []), p]);
      const existingMembers = await tx.manualAudienceMember.findMany({
        where: { audienceId: audience.id, email: { in: emails } },
        include: { person: true },
      });
      const pinned = new Map(
        existingMembers.map((m) => [
          m.email,
          m.person.mergedIntoId || m.personId,
        ]),
      );
      const byId = new Map(people.map((p) => [p.id, p]));
      const created: Prisma.PersonCreateManyInput[] = [];
      const members: Prisma.ManualAudienceMemberCreateManyInput[] = [];
      for (const row of rows) {
        if (["invalid", "duplicate"].includes(row.status)) continue;
        const selected =
          resolutions[String(row.row)] ||
          (row.status === "matched" ? row.candidates[0]?.id : undefined);
        if (row.status === "ambiguous" && !selected) continue;
        if (selected && !row.candidates.some((p) => p.id === selected))
          throw new AppError("Choose one of the reviewed matches.", 422);
        const pinnedId = pinned.get(row.email);
        const pinnedPerson = pinnedId ? byId.get(pinnedId) : undefined;
        const candidates =
          row.existingMembership && pinnedPerson
            ? [pinnedPerson]
            : byEmail.get(row.email) || [];
        if (
          JSON.stringify(candidates.map((p) => p.id).sort()) !==
          JSON.stringify(row.candidates.map((p) => p.id).sort())
        )
          throw new AppError(
            "People changed during import. Preview the list again.",
            409,
          );
        const personId = selected || randomUUID();
        if (!selected)
          created.push({
            id: personId,
            orgId,
            email: row.email,
            firstName: row.firstName || null,
            lastName: row.lastName || null,
            source: "import",
          });
        row.personId = personId;
        members.push({ audienceId: audience.id, email: row.email, personId });
      }
      if (created.length) await tx.person.createMany({ data: created });
      if (members.length)
        await tx.personEmail.createMany({
          data: members.map((m) => ({ personId: m.personId, email: m.email })),
          skipDuplicates: true,
        });
      const { count: added } = members.length
        ? await tx.manualAudienceMember.createMany({
            data: members,
            skipDuplicates: true,
          })
        : { count: 0 };
      if (added)
        await tx.audience.update({
          where: { id: audience.id },
          data: { manualVersion: { increment: 1 } },
        });
      await tx.audienceImport.update({
        where: { id },
        data: {
          status: "committed",
          audienceId: audience.id,
          committedAt: new Date(),
          rows: rows as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        audienceId: audience.id,
        added,
        held: rows.filter((r) => r.status === "ambiguous" && !r.personId)
          .length,
      };
    },
    { maxWait: 15000, timeout: 60000 },
  );
}
