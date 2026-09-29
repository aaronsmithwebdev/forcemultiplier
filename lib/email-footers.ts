import { Prisma } from "@prisma/client";
import {
  assertNoSlotInContent,
  assertNoWrapperInContent,
  createDefaultTemplateContent,
  createParagraphBlock,
  createSectionBlock,
  isRenderableTemplateContent,
  uniformBorder,
  type TemplateContent,
} from "@templatical/types";
import { db } from "./db";
import { AppError } from "./errors";
import { renderEmailHtml } from "./campaign-email";

type FooterInput = {
  name: string;
  content?: unknown;
  isDefault?: boolean;
};

const footerSelect = {
  id: true,
  name: true,
  content: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { campaigns: true } },
} as const;

export function createStarterFooterContent() {
  const content = createDefaultTemplateContent();
  const border = uniformBorder({
    width: 0,
    style: "solid",
    color: "#dfe5dc",
  });
  border.top.width = 1;
  content.blocks = [
    createSectionBlock({
      border,
      styles: { padding: { top: 24, right: 20, bottom: 24, left: 20 } },
      children: [
        [
          createParagraphBlock({
            content:
              '<p style="text-align:center"><strong style="color:#1d3029;font-size:12px">Organisation name</strong></p><p style="text-align:center"><span style="color:#5f6e66;font-size:12px">A short organisation or legal message.</span></p><p style="text-align:center"><a href="https://example.org" style="font-size:12px">example.org</a></p>',
            styles: { padding: { top: 0, right: 0, bottom: 0, left: 0 } },
          }),
        ],
      ],
    }),
  ];
  return content;
}

export function normalizeFooterContent(value: unknown): TemplateContent {
  if (!isRenderableTemplateContent(value) || !value.blocks.length)
    throw new AppError("Footer content is required.");
  try {
    assertNoSlotInContent(value);
    assertNoWrapperInContent(value);
  } catch {
    throw new AppError("Footer content contains unsupported layout blocks.");
  }
  return value;
}

async function withPreview<Row extends { content: unknown }>(row: Row) {
  return {
    ...row,
    previewHtml: await renderEmailHtml(normalizeFooterContent(row.content)),
  };
}

export async function listFooters(search = "") {
  const rows = await db.emailFooter.findMany({
    where: search
      ? { name: { contains: search.slice(0, 100), mode: "insensitive" } }
      : undefined,
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: footerSelect,
  });
  return Promise.all(rows.map(withPreview));
}

export async function getFooter(id: string) {
  const footer = await db.emailFooter.findUnique({
    where: { id },
    select: footerSelect,
  });
  if (!footer) throw new AppError("Email footer not found.", 404);
  return footer;
}

export async function getDefaultFooter() {
  const footer = await db.emailFooter.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  if (!footer)
    throw new AppError(
      "Create a default email footer before creating a campaign.",
      409,
    );
  return footer;
}

export async function createFooter(input: FooterInput, userId: string) {
  const content = normalizeFooterContent(
    input.content || createStarterFooterContent(),
  );
  await renderEmailHtml(content);
  const data = {
    name: input.name,
    content: content as unknown as Prisma.InputJsonValue,
    createdBy: userId,
  };
  if (!input.isDefault)
    return db.emailFooter.create({ data, select: footerSelect });
  return db.$transaction(async (tx) => {
    await tx.emailFooter.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    return tx.emailFooter.create({
      data: { ...data, isDefault: true },
      select: footerSelect,
    });
  });
}

export async function updateFooter(id: string, input: Partial<FooterInput>) {
  const current = await db.emailFooter.findUnique({
    where: { id },
    select: { id: true, isDefault: true },
  });
  if (!current) throw new AppError("Email footer not found.", 404);
  if (current.isDefault && input.isDefault === false)
    throw new AppError("Choose another default footer first.", 409);
  const content =
    input.content === undefined
      ? undefined
      : normalizeFooterContent(input.content);
  if (content) await renderEmailHtml(content);
  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(content
      ? { content: content as unknown as Prisma.InputJsonValue }
      : {}),
  };
  if (!input.isDefault)
    return db.emailFooter.update({ where: { id }, data, select: footerSelect });
  return db.$transaction(async (tx) => {
    await tx.emailFooter.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
    return tx.emailFooter.update({
      where: { id },
      data: { ...data, isDefault: true },
      select: footerSelect,
    });
  });
}

export async function deleteFooter(id: string) {
  const footer = await db.emailFooter.findUnique({
    where: { id },
    select: { isDefault: true, _count: { select: { campaigns: true } } },
  });
  if (!footer) throw new AppError("Email footer not found.", 404);
  if (footer.isDefault)
    throw new AppError(
      "Choose another default footer before deleting this one.",
      409,
    );
  if (footer._count.campaigns)
    throw new AppError(
      `This footer is selected by ${footer._count.campaigns} campaign${footer._count.campaigns === 1 ? "" : "s"}. Choose a different footer on those campaigns first.`,
      409,
    );
  try {
    await db.emailFooter.delete({ where: { id } });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    )
      throw new AppError(
        "This footer is still selected by a campaign. Choose a different footer first.",
        409,
      );
    throw error;
  }
  return { ok: true };
}
