import { Prisma } from "@prisma/client";
import { createDefaultTemplateContent } from "@templatical/types";
import type { TemplateContent } from "@templatical/types";
import { db } from "./db";
import { AppError } from "./errors";

export type CampaignPatch = Partial<{
  name: string;
  content: TemplateContent;
  subject: string;
  preheader: string;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
}>;

const campaignSelect = {
  id: true,
  name: true,
  content: true,
  status: true,
  subject: true,
  preheader: true,
  fromName: true,
  fromEmail: true,
  replyToEmail: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listCampaigns(search = "") {
  return db.campaign.findMany({
    where: search
      ? { name: { contains: search.slice(0, 100), mode: "insensitive" } }
      : undefined,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      subject: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getCampaign(id: string) {
  const campaign = await db.campaign.findUnique({
    where: { id },
    select: campaignSelect,
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);
  return campaign;
}

export async function createCampaign(
  name: string,
  userId: string,
  templateId?: string,
) {
  const template = templateId
    ? await db.emailTemplate.findUnique({
        where: { id: templateId },
        select: { content: true },
      })
    : null;
  if (templateId && !template)
    throw new AppError("Email template not found.", 404);
  const content = (template?.content ||
    createDefaultTemplateContent()) as Prisma.InputJsonValue;
  const preheader = String(
    (content as unknown as TemplateContent).settings?.preheaderText || "",
  );
  return db.campaign.create({
    data: { name, content, preheader, createdBy: userId },
    select: campaignSelect,
  });
}

export async function saveCampaign(id: string, patch: CampaignPatch) {
  const current = await getCampaign(id);
  let content = (patch.content ||
    current.content) as unknown as TemplateContent;
  if (patch.preheader !== undefined) {
    const settings = {
      ...content.settings,
      ...(patch.preheader
        ? { preheaderText: patch.preheader }
        : { preheaderText: undefined }),
    };
    content = JSON.parse(JSON.stringify({ ...content, settings }));
  }
  const preheader =
    patch.preheader ?? String(content.settings?.preheaderText || "");
  return db.campaign.update({
    where: { id },
    data: {
      ...patch,
      preheader,
      content: content as unknown as Prisma.InputJsonValue,
    },
    select: campaignSelect,
  });
}

export async function deleteCampaign(id: string) {
  const deleted = await db.campaign.deleteMany({ where: { id } });
  if (!deleted.count) throw new AppError("Campaign not found.", 404);
  return { ok: true };
}
