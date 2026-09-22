import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { AppError } from "./errors";
import { rewriteArchiveImages } from "./archive-images";
import { supabase } from "./supabase";

export const imageBucket = "email-archive-images";
const maxBytes = 10 * 1024 * 1024;
const types: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")))
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)))
    return "image/gif";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw new Error("Unsupported or invalid image bytes.");
}

export async function fetchArchiveImage(url: string, folder: string) {
  let current = url;
  for (let redirects = 0; redirects < 4; redirects++) {
    const parsed = new URL(current);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "files.constantcontact.com" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      !parsed.pathname.startsWith(`/${folder}/`)
    )
      throw new Error("Image URL left the approved Constant Contact folder.");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Image redirect lacked a location.");
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok)
      throw new Error(`Image download returned ${response.status}.`);
    if (Number(response.headers.get("content-length") || 0) > maxBytes)
      throw new Error("Image exceeds the 10 MB limit.");
    if (!response.body) throw new Error("Image response has no body.");
    const chunks: Buffer[] = [];
    const reader = response.body.getReader();
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Image exceeds the 10 MB limit.");
      }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks, size);
    const contentType = imageType(bytes);
    const reportedType = response.headers.get("content-type")?.split(";")[0];
    if (
      reportedType &&
      reportedType !== contentType &&
      reportedType !== "application/octet-stream"
    )
      throw new Error("Image content type does not match its bytes.");
    return { bytes, contentType };
  }
  throw new Error("Image redirected too many times.");
}

export function archiveImageUrl(path: string) {
  const project = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!project) throw new AppError("Supabase Storage is not configured.", 503);
  return new URL(`/storage/v1/object/public/${imageBucket}/${path}`, project)
    .href;
}

export async function imageBackupState() {
  const job = await db.archiveImageImport.findUnique({
    where: { id: "constant-contact" },
  });
  if (!job) return { job: null, counts: {} };
  const counts = await db.archivedImage.groupBy({
    by: ["status"],
    where: { accountId: job.accountId },
    _count: { _all: true },
  });
  return {
    job,
    counts: Object.fromEntries(
      counts.map((row) => [row.status, row._count._all]),
    ),
  };
}

export async function startImageBackup() {
  const archive = await db.archiveImport.findUnique({
    where: { id: "constant-contact" },
  });
  if (!archive) throw new AppError("Import sent emails first.", 409);
  const current = await db.archiveImageImport.findUnique({
    where: { id: "constant-contact" },
  });
  if (current && current.accountId !== archive.accountId)
    throw new AppError(
      "The archived account changed. Review the image manifest.",
      409,
    );
  if (current && ["inventory", "copying"].includes(current.status))
    return imageBackupState();
  const cutoff = current?.cutoff || new Date();
  if (!current) cutoff.setFullYear(cutoff.getFullYear() - 5);
  const recent = await db.archivedEmail.findMany({
    where: { accountId: archive.accountId, sentAt: { gte: cutoff } },
    orderBy: { sentAt: "desc" },
    take: 10,
    select: { sourceHtml: true, previewHtml: true },
  });
  const folders = new Set(
    recent
      .flatMap((email) =>
        [email.sourceHtml, email.previewHtml].flatMap((html) =>
          html ? [...rewriteArchiveImages(html).urls] : [],
        ),
      )
      .map((value) => new URL(value))
      .filter((url) => url.hostname === "files.constantcontact.com")
      .map((url) => url.pathname.split("/")[1])
      .filter(Boolean),
  );
  const folder =
    current?.mediaFolder || (folders.size === 1 ? [...folders][0] : null);
  if (!folder || !/^[a-zA-Z0-9_-]+$/.test(folder))
    throw new AppError(
      "Could not identify one account image folder. Review the archive.",
      409,
    );
  await db.archivedImage.updateMany({
    where: { accountId: archive.accountId, status: "failed" },
    data: { status: "pending", error: null },
  });
  await db.archiveImageImport.upsert({
    where: { id: "constant-contact" },
    create: { accountId: archive.accountId, cutoff, mediaFolder: folder },
    update: { status: "inventory", cursor: null, scanned: 0, error: null },
  });
  return imageBackupState();
}

export async function imageBackupStep() {
  const job = await db.archiveImageImport.findUnique({
    where: { id: "constant-contact" },
  });
  if (!job || !["inventory", "copying"].includes(job.status))
    return imageBackupState();
  const lease = new Date(Date.now() + 90000);
  const acquired = await db.archiveImageImport.updateMany({
    where: {
      id: job.id,
      status: { in: ["inventory", "copying"] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: lease },
  });
  if (!acquired.count) return imageBackupState();
  try {
    if (job.status === "inventory") {
      const emails = await db.archivedEmail.findMany({
        where: { accountId: job.accountId, sentAt: { gte: job.cutoff } },
        orderBy: { id: "asc" },
        take: 50,
        ...(job.cursor ? { cursor: { id: job.cursor }, skip: 1 } : {}),
        select: { id: true, sourceHtml: true, previewHtml: true },
      });
      const references = new Map<string, Set<string>>();
      for (const email of emails) {
        const urls = new Set(
          [email.sourceHtml, email.previewHtml].flatMap((html) =>
            html ? [...rewriteArchiveImages(html).urls] : [],
          ),
        );
        for (const url of urls) {
          if (!references.has(url)) references.set(url, new Set());
          references.get(url)!.add(email.id);
        }
      }
      if (references.size) {
        const values = [...references].map(([url, ids]) => {
          const parsed = new URL(url);
          const approved =
            parsed.hostname === "files.constantcontact.com" &&
            parsed.pathname.startsWith(`/${job.mediaFolder}/`);
          return Prisma.sql`(${job.accountId}, ${url}, ${approved ? "pending" : "excluded"}, ${approved ? null : "Shared or external image; ownership needs review."}, ARRAY[${Prisma.join([...ids])}]::text[], CURRENT_TIMESTAMP)`;
        });
        await db.$executeRaw(Prisma.sql`
          INSERT INTO "forcemultiplier"."ArchivedImage"
            ("accountId", "url", "status", "error", "emailIds", "updatedAt")
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("accountId", "url") DO UPDATE SET
            "emailIds" = ARRAY(SELECT DISTINCT unnest("ArchivedImage"."emailIds" || EXCLUDED."emailIds")),
            "updatedAt" = CURRENT_TIMESTAMP
        `);
      }
      await db.archiveImageImport.update({
        where: { id: job.id },
        data: {
          cursor: emails.at(-1)?.id || job.cursor,
          scanned: { increment: emails.length },
          status: emails.length ? "inventory" : "copying",
          leaseUntil: null,
        },
      });
    } else {
      const image = await db.archivedImage.findFirst({
        where: { accountId: job.accountId, status: "pending" },
        orderBy: { url: "asc" },
      });
      if (!image) {
        await db.archiveImageImport.update({
          where: { id: job.id },
          data: { status: "completed", leaseUntil: null },
        });
      } else {
        let bytes: Buffer;
        let contentType: string;
        try {
          ({ bytes, contentType } = await fetchArchiveImage(
            image.url,
            job.mediaFolder,
          ));
        } catch (error) {
          await db.archivedImage.update({
            where: {
              accountId_url: { accountId: job.accountId, url: image.url },
            },
            data: { status: "failed", error: String(error).slice(0, 500) },
          });
          await db.archiveImageImport.update({
            where: { id: job.id },
            data: { leaseUntil: null },
          });
          return imageBackupState();
        }
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const path = `${createHash("sha256").update(image.url).digest("hex")}.${types[contentType]}`;
        const storage = (await supabase()).storage.from(imageBucket);
        const { error } = await storage.upload(path, bytes, {
          contentType,
          cacheControl: "31536000",
          upsert: false,
        });
        if (error) {
          if (!/already exists|duplicate/i.test(error.message)) throw error;
          const response = await fetch(archiveImageUrl(path), {
            signal: AbortSignal.timeout(30000),
          });
          if (
            !response.ok ||
            createHash("sha256")
              .update(Buffer.from(await response.arrayBuffer()))
              .digest("hex") !== sha256
          )
            throw new Error(
              "Existing storage object does not match the source image.",
            );
        }
        await db.archivedImage.update({
          where: {
            accountId_url: { accountId: job.accountId, url: image.url },
          },
          data: {
            status: "copied",
            storagePath: path,
            sha256,
            contentType,
            error: null,
          },
        });
        await db.archiveImageImport.update({
          where: { id: job.id },
          data: { leaseUntil: null },
        });
      }
    }
  } catch (error) {
    await db.archiveImageImport.updateMany({
      where: { id: job.id, leaseUntil: lease },
      data: {
        status: "paused",
        error: String(error).slice(0, 500),
        leaseUntil: null,
      },
    });
    throw error;
  }
  return imageBackupState();
}
