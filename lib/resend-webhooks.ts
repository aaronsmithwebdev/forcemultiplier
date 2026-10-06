import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { normalizedEmail } from "./email";
import { AppError } from "./errors";

const MAX_AGE_SECONDS = 5 * 60;

function invalidWebhook(): never {
  throw new AppError("Invalid Resend webhook.", 400);
}

function verify(
  payload: string,
  headers: Headers,
  secret = process.env.RESEND_WEBHOOK_SECRET,
  now = Date.now(),
) {
  if (!secret?.startsWith("whsec_"))
    throw new AppError("Resend webhook signing is not configured.", 503);
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp))
    invalidWebhook();
  const seconds = Number(timestamp);
  if (
    !Number.isSafeInteger(seconds) ||
    Math.abs(Math.floor(now / 1000) - seconds) > MAX_AGE_SECONDS
  )
    invalidWebhook();
  const encodedKey = secret.slice(6);
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encodedKey)) invalidWebhook();
  const key = Buffer.from(encodedKey, "base64");
  if (key.length < 16) invalidWebhook();
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest();
  const valid = signatures.split(" ").some((item) => {
    const [version, value] = item.split(",", 2);
    if (version !== "v1" || !value) return false;
    const supplied = Buffer.from(value, "base64");
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  });
  if (!valid) invalidWebhook();
  return id;
}

export async function receiveResendWebhook(
  payload: string,
  headers: Headers,
  secret = process.env.RESEND_WEBHOOK_SECRET,
  now = Date.now(),
) {
  const webhookId = verify(payload, headers, secret, now);
  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    throw new AppError("Invalid Resend webhook payload.", 400);
  }
  if (event?.type !== "contact.updated") return { received: true };
  const contact = event.data;
  const email = normalizedEmail(contact?.email);
  const occurredAt = new Date(contact?.updated_at ?? "");
  if (
    typeof contact?.id !== "string" ||
    !contact.id ||
    contact.id.length > 100 ||
    !email ||
    typeof contact?.unsubscribed !== "boolean" ||
    typeof contact?.updated_at !== "string" ||
    contact.updated_at.length > 50 ||
    Number.isNaN(occurredAt.getTime())
  )
    throw new AppError("Invalid Resend contact update.", 400);
  if (!contact.unsubscribed) return { received: true };
  const recordedAt = new Date(now);
  const suppressed = await db.$transaction(async (tx) => {
    const event = await tx.suppressionEvent.createMany({
      data: [
        {
          dedupeKey: `resend:${webhookId}`,
          email,
          direction: "resend_to_forcemultiplier",
          source: "resend",
          sourceRef: contact.id,
          occurredAt,
          recordedAt,
          processedAt: recordedAt,
        },
      ],
      skipDuplicates: true,
    });
    // A retried delivery of an already-recorded webhook is not a new opt-out.
    if (!event.count) return false;
    await tx.suppression.upsert({
      where: { email },
      create: { email, source: "resend", sourceRef: contact.id, occurredAt },
      update: { revision: { increment: 1 } },
    });
    return true;
  });
  return { received: true, suppressed };
}
