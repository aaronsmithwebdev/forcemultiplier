import { Prisma } from "@prisma/client";
import { createDefaultTemplateContent } from "@templatical/types";
import { db } from "./db";
import { AppError } from "./errors";
import { mergeTagCatalog } from "./template-merge-tags";

type TemplateInput = {
  name?: string;
  content?: unknown;
};

const templateSelect = {
  id: true,
  name: true,
  content: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function templateMergeTags() {
  const audiences = await db.audience.findMany({ select: { fields: true } });
  return mergeTagCatalog([
    "FirstName",
    "LastName",
    "Email",
    ...audiences.flatMap((audience) =>
      Array.isArray(audience.fields) ? audience.fields : [],
    ),
  ]);
}

export async function listTemplates(search = "") {
  return db.emailTemplate.findMany({
    where: search
      ? { name: { contains: search.slice(0, 100), mode: "insensitive" } }
      : undefined,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { revisions: true } },
    },
  });
}

export async function getTemplate(id: string) {
  const template = await db.emailTemplate.findUnique({
    where: { id },
    select: templateSelect,
  });
  if (!template) throw new AppError("Email template not found.", 404);
  return template;
}

export async function createTemplate(input: TemplateInput, userId: string) {
  const content = (input.content ||
    createDefaultTemplateContent()) as Prisma.InputJsonValue;
  return db.$transaction(async (tx) => {
    const template = await tx.emailTemplate.create({
      data: {
        name: input.name || "Untitled email",
        content,
        createdBy: userId,
      },
      select: templateSelect,
    });
    await tx.emailTemplateRevision.create({
      data: {
        templateId: template.id,
        content,
        label: "Created",
        createdBy: userId,
        automatic: false,
      },
    });
    return template;
  });
}

export async function saveTemplate(
  id: string,
  input: TemplateInput,
  userId: string,
) {
  const current = await getTemplate(id);
  const name = input.name || current.name;
  const content = (input.content || current.content) as Prisma.InputJsonValue;
  if (
    name === current.name &&
    JSON.stringify(content) === JSON.stringify(current.content)
  )
    return current;
  return db.$transaction(async (tx) => {
    if (input.content)
      await tx.emailTemplateRevision.create({
        data: { templateId: id, content, createdBy: userId },
      });
    return tx.emailTemplate.update({
      where: { id },
      data: { name, content },
      select: templateSelect,
    });
  });
}

export async function deleteTemplate(id: string) {
  const deleted = await db.emailTemplate.deleteMany({ where: { id } });
  if (!deleted.count) throw new AppError("Email template not found.", 404);
  return { ok: true };
}

export async function listTemplateVersions(templateId: string) {
  await getTemplate(templateId);
  // ponytail: the first release returns 100 saves; add cursor paging if histories grow past that.
  const versions = await db.emailTemplateRevision.findMany({
    where: { templateId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      createdAt: true,
      automatic: true,
      label: true,
      createdBy: true,
    },
  });
  return {
    versions: versions.map((version) => ({
      id: version.id,
      createdAt: version.createdAt,
      isAutomatic: version.automatic,
      label: version.label || undefined,
      author: { id: version.createdBy },
    })),
  };
}

export async function getTemplateVersion(templateId: string, id: string) {
  const version = await db.emailTemplateRevision.findFirst({
    where: { id, templateId },
    select: { content: true },
  });
  if (!version) throw new AppError("Template version not found.", 404);
  return version;
}

export async function restoreTemplateVersion(
  templateId: string,
  id: string,
  userId: string,
) {
  const version = await getTemplateVersion(templateId, id);
  return saveTemplate(templateId, { content: version.content }, userId);
}
