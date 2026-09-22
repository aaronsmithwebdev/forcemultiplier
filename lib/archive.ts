import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { AppError } from "./errors";
import { connection, providerRequest } from "./providers";
import { archiveImageUrl } from "./archive-image-import";
import { rewriteArchiveImages } from "./archive-images";

const pageSize = 1;
const selected = {
  id: true,
  campaignName: true,
  campaignType: true,
  role: true,
  subject: true,
  preheader: true,
  fromName: true,
  fromEmail: true,
  sentAt: true,
  sendCount: true,
  warning: true,
  permalink: true,
  previewText: true,
  createdAt: true,
} as const;

export function archiveNextPath(href: string) {
  const url = new URL(href, "https://api.cc.email");
  if (url.origin !== "https://api.cc.email" || url.pathname !== "/v3/emails")
    throw new AppError(
      "Constant Contact returned an invalid archive cursor.",
      502,
    );
  url.searchParams.set("limit", String(pageSize));
  return url.pathname + url.search;
}

export function completedSends(history: unknown) {
  if (!Array.isArray(history))
    throw new AppError(
      "Constant Contact returned incomplete send history.",
      502,
    );
  return history.filter((run) => run?.send_status === "COMPLETED");
}

export function retryableArchiveError(error: unknown) {
  return error instanceof AppError && error.status === 429;
}

async function account() {
  const cc = await connection("constant-contact");
  if (!cc.tokens || !cc.externalId)
    throw new AppError(
      "Connect Constant Contact before importing history.",
      409,
    );
  return cc.externalId;
}

export async function archiveState(search = "", offset = 0) {
  const importJob = await db.archiveImport.findUnique({
    where: { id: "constant-contact" },
  });
  const accountId = importJob?.accountId || "";
  const query = search.trim().slice(0, 100);
  // ponytail: ILIKE scans this ~3k-item archive; add a full-text index if search slows down.
  const where: Prisma.ArchivedEmailWhereInput = {
    accountId,
    ...(query
      ? {
          OR: ["campaignName", "subject", "previewText"].map((field) => ({
            [field]: { contains: query, mode: "insensitive" },
          })),
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    db.archivedEmail.count({ where }),
    db.archivedEmail.findMany({
      where,
      select: selected,
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      skip: Math.max(0, Math.min(offset, 100000)),
      take: 25,
    }),
  ]);
  return {
    importJob,
    total,
    items,
  };
}

export async function startArchiveImport() {
  const accountId = await account();
  const current = await db.archiveImport.findUnique({
    where: { id: "constant-contact" },
  });
  if (current && ["pending", "running"].includes(current.status)) {
    if (current.accountId !== accountId)
      throw new AppError("Another account's archive import is active.", 409);
    return current;
  }
  if (current?.status === "paused" && current.accountId === accountId)
    return db.archiveImport.update({
      where: { id: current.id },
      data: { status: "pending", error: null },
    });
  return db.archiveImport.upsert({
    where: { id: "constant-contact" },
    create: { accountId },
    update: {
      accountId,
      status: "pending",
      cursor: null,
      scanned: 0,
      stored: 0,
      missing: 0,
      leaseUntil: null,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
    },
  });
}

export async function archiveStep() {
  const current = await db.archiveImport.findUnique({
    where: { id: "constant-contact" },
  });
  if (!current || !["pending", "running"].includes(current.status))
    return current;
  const lease = new Date(Date.now() + 90000);
  const acquired = await db.archiveImport.updateMany({
    where: {
      id: current.id,
      status: { in: ["pending", "running"] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { status: "running", leaseUntil: lease, error: null },
  });
  if (!acquired.count) return current;
  const call = (path: string) =>
    providerRequest(
      "constant-contact",
      path,
      {},
      { externalId: current.accountId },
    );
  try {
    const path = current.cursor
      ? archiveNextPath(current.cursor)
      : `/v3/emails?limit=${pageSize}`;
    const page = await call(path);
    if (!Array.isArray(page.campaigns))
      throw new AppError(
        "Constant Contact returned an incomplete campaign page.",
        502,
      );
    const next = page._links?.next?.href
      ? archiveNextPath(page._links.next.href)
      : null;
    if (
      (next && (!page.campaigns.length || next === path)) ||
      page.campaigns.length > pageSize
    )
      throw new AppError(
        "Constant Contact campaign pagination did not advance.",
        502,
      );
    const importCampaign = async (campaign: any) => {
      if (typeof campaign.campaign_id !== "string" || !campaign.campaign_id)
        throw new AppError(
          "Constant Contact returned a campaign without an ID.",
          502,
        );
      if (String(campaign.current_status).toLowerCase() !== "done") return;
      const detail = await call(
        `/v3/emails/${encodeURIComponent(campaign.campaign_id)}`,
      );
      if (!Array.isArray(detail.campaign_activities))
        throw new AppError(
          "Constant Contact returned incomplete campaign activities.",
          502,
        );
      for (const item of detail.campaign_activities) {
        if (item.role === "permalink") continue;
        if (typeof item.campaign_activity_id !== "string")
          throw new AppError(
            "Constant Contact returned an activity without an ID.",
            502,
          );
        const activityId = item.campaign_activity_id;
        const path = `/v3/emails/activities/${encodeURIComponent(activityId)}`;
        const sends = completedSends(await call(path + "/send_history"));
        if (!sends.length) continue;
        const dates = sends.map((send) => new Date(send.run_date));
        if (dates.some((date) => Number.isNaN(date.getTime())))
          throw new AppError(
            "Constant Contact returned a send without a valid date.",
            502,
          );
        const [activity, preview] = await Promise.all([
          call(path + "?include=html_content,permalink_url"),
          call(path + "/previews"),
        ]);
        const sourceHtml =
          typeof activity.html_content === "string"
            ? activity.html_content
            : null;
        const previewHtml =
          typeof preview.preview_html_content === "string"
            ? preview.preview_html_content
            : null;
        if (
          Math.max(sourceHtml?.length || 0, previewHtml?.length || 0) > 2000000
        )
          throw new AppError(
            "An archived email exceeds the 2 MB import limit.",
            422,
          );
        const sourceHash = sourceHtml
          ? createHash("sha256").update(sourceHtml).digest("hex")
          : null;
        const existing = await db.archivedEmail.findUnique({
          where: {
            accountId_activityId: { accountId: current.accountId, activityId },
          },
          select: { id: true, sourceHash: true, sourceHtml: true },
        });
        if (
          existing?.sourceHash &&
          sourceHash &&
          existing.sourceHash !== sourceHash
        )
          throw new AppError(
            "A previously archived email changed at its source. Review it before resuming.",
            409,
          );
        if (existing?.sourceHtml) continue;
        const data = {
          accountId: current.accountId,
          campaignId: campaign.campaign_id,
          activityId,
          role: item.role || "email",
          campaignType: campaign.type || "UNKNOWN",
          campaignName: campaign.name || "Untitled campaign",
          subject: String(activity.subject || preview.subject || ""),
          preheader: activity.preheader || preview.preheader || null,
          fromName: activity.from_name || null,
          fromEmail: activity.from_email || null,
          sentAt: new Date(Math.min(...dates.map((date) => date.getTime()))),
          sendCount: sends.reduce(
            (count, send) => count + (Number(send.count) || 0),
            0,
          ),
          sourceHtml,
          previewHtml,
          previewText:
            typeof preview.preview_text_content === "string"
              ? preview.preview_text_content
              : null,
          permalink: activity.permalink_url || null,
          sourceHash,
          warning:
            !sourceHtml || !previewHtml
              ? "Source or preview HTML is missing."
              : null,
        };
        if (existing)
          await db.archivedEmail.update({ where: { id: existing.id }, data });
        else await db.archivedEmail.create({ data });
      }
    };
    for (const campaign of page.campaigns) await importCampaign(campaign);
    const stored = await db.archivedEmail.count({
      where: { accountId: current.accountId },
    });
    const missing = await db.archivedEmail.count({
      where: {
        accountId: current.accountId,
        OR: [{ sourceHtml: null }, { previewHtml: null }],
      },
    });
    const updated = await db.archiveImport.updateMany({
      where: { id: current.id, leaseUntil: lease },
      data: {
        cursor: next,
        scanned: { increment: page.campaigns.length },
        stored,
        missing,
        status: next ? "running" : "completed",
        finishedAt: next ? null : new Date(),
        leaseUntil: null,
      },
    });
    if (!updated.count)
      throw new AppError("Archive import lease expired; retry the page.", 409);
    // Rescan images as the archive grows, including its final partial page.
    if (
      !next ||
      Math.floor((current.scanned + page.campaigns.length) / 50) >
        Math.floor(current.scanned / 50)
    ) {
      try {
        await db.archiveImageImport.updateMany({
          where: {
            id: "constant-contact",
            accountId: current.accountId,
            status: { in: ["copying", "completed"] },
          },
          data: { status: "inventory" },
        });
      } catch {
        // The archive is committed; image inventory can be resumed separately.
      }
    }
    return db.archiveImport.findUnique({ where: { id: current.id } });
  } catch (error) {
    const retry = retryableArchiveError(error);
    await db.archiveImport.updateMany({
      where: { id: current.id, leaseUntil: lease },
      data: {
        status: retry ? "pending" : "paused",
        error: retry
          ? null
          : error instanceof Error
            ? error.message.slice(0, 500)
            : "Archive import failed.",
        leaseUntil: null,
      },
    });
    if (retry)
      return db.archiveImport.findUnique({ where: { id: current.id } });
    throw error;
  }
}

export async function archivePreview(id: string) {
  const item = await db.archivedEmail.findFirst({
    where: { id },
    select: { accountId: true, previewHtml: true, sourceHtml: true },
  });
  if (!item) throw new AppError("Archived email not found.", 404);
  const html =
    item.previewHtml ||
    item.sourceHtml ||
    "<p>No HTML was available for this email.</p>";
  const found = rewriteArchiveImages(html).urls;
  const images = found.size
    ? await db.archivedImage.findMany({
        where: {
          accountId: item.accountId,
          url: { in: [...found] },
          status: "copied",
        },
        select: { url: true, storagePath: true },
      })
    : [];
  const mapped = new Map(
    images
      .filter((image) => image.storagePath)
      .map((image) => [image.url, archiveImageUrl(image.storagePath!)]),
  );
  return {
    html: rewriteArchiveImages(html, mapped, true).html,
    unresolved: found.size - mapped.size,
  };
}
