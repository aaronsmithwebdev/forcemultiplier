import { Prisma } from "@prisma/client";
import { db } from "./db";
import { AppError } from "./errors";

type FooterInput = {
  name: string;
  html: string;
  isDefault?: boolean;
};

const footerSelect = {
  id: true,
  name: true,
  html: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { campaigns: true } },
} as const;

export function normalizeFooterHtml(value: string) {
  const html = value.trim();
  if (!html) throw new AppError("Footer content is required.");
  if (
    /<\/?(?:html|head|body|script|iframe|object|embed|form|input|button|textarea|select|meta|link)\b/i.test(
      html,
    )
  )
    throw new AppError(
      "Use an email-safe HTML fragment without document, form, script, or iframe tags.",
    );
  if (/\son[a-z]+\s*=/i.test(html))
    throw new AppError("Event handlers are not allowed in email footers.");
  if (/(?:href|src)\s*=\s*["']?\s*(?:javascript|data):/i.test(html))
    throw new AppError("Footer links and images must use safe URLs.");
  if (/\{[{%]/.test(html))
    throw new AppError(
      "Footer merge tags are not supported. Marketing unsubscribe links are added automatically.",
    );
  return html;
}

export async function listFooters(search = "") {
  return db.emailFooter.findMany({
    where: search
      ? { name: { contains: search.slice(0, 100), mode: "insensitive" } }
      : undefined,
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: footerSelect,
  });
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
  const data = {
    name: input.name,
    html: normalizeFooterHtml(input.html),
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
  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.html !== undefined
      ? { html: normalizeFooterHtml(input.html) }
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
