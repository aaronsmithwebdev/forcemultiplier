import { AppError } from "./errors";

async function resendRequest(
  path: string,
  init: RequestInit = {},
  key = process.env.RESEND_API_KEY,
  request: typeof fetch = fetch,
) {
  if (!key?.trim())
    throw new AppError("Resend is not configured. Add RESEND_API_KEY.", 409);
  const response = await request(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
    redirect: "error",
  });
  let data: any = {};
  try {
    data = await response.json();
  } catch {}
  if (!response.ok)
    throw new AppError(
      typeof data?.message === "string"
        ? data.message
        : `Resend request failed (${response.status}).`,
      response.status === 429 ? 429 : response.status < 500 ? 409 : 502,
    );
  return data;
}

export async function resendStatus(
  key = process.env.RESEND_API_KEY,
  request: typeof fetch = fetch,
) {
  if (!key?.trim()) return { configured: false, domains: [], hasMore: false };
  const response = await request("https://api.resend.com/domains?limit=100", {
    headers: { Authorization: `Bearer ${key.trim()}` },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
    redirect: "error",
  });
  if (response.status === 401)
    throw new AppError(
      "Resend rejected the API key. Check RESEND_API_KEY.",
      409,
    );
  if (response.status === 403)
    throw new AppError("The Resend API key needs access to list domains.", 403);
  if (!response.ok)
    throw new AppError(`Resend domain check failed (${response.status}).`, 502);
  const data = await response.json();
  if (!Array.isArray(data?.data))
    throw new AppError("Resend returned an unexpected domain list.", 502);
  return {
    configured: true,
    domains: data.data.map((domain: any) => ({
      name: String(domain.name ?? "").slice(0, 253),
      status: String(domain.status ?? "unknown").slice(0, 50),
      sending: domain.capabilities?.sending === "enabled",
    })),
    hasMore: data.has_more === true,
  };
}

export async function createResendSegment(name: string) {
  const data = await resendRequest("/segments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.slice(0, 120) }),
  });
  if (typeof data.id !== "string")
    throw new AppError("Resend did not create the campaign segment.", 502);
  return data.id as string;
}

export async function createResendContactImport(
  segmentId: string,
  csv: string,
) {
  if (Buffer.byteLength(csv) > 200_000_000)
    throw new AppError("This recipient import exceeds Resend's 200 MB limit.");
  const form = new FormData();
  form.set("file", new Blob([csv], { type: "text/csv" }), "recipients.csv");
  form.set(
    "column_map",
    JSON.stringify({
      email: "Email",
      first_name: "First Name",
      last_name: "Last Name",
    }),
  );
  form.set("on_conflict", "upsert");
  form.set("segments", JSON.stringify([{ id: segmentId }]));
  const data = await resendRequest("/contacts/imports", {
    method: "POST",
    body: form,
  });
  if (typeof data.id !== "string")
    throw new AppError("Resend did not start the recipient import.", 502);
  return data.id as string;
}

export async function getResendContactImport(id: string) {
  return resendRequest(`/contacts/imports/${encodeURIComponent(id)}`);
}

export async function createResendBroadcast(input: {
  segmentId: string;
  name: string;
  from: string;
  subject: string;
  html: string;
}) {
  const data = await resendRequest("/broadcasts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      segment_id: input.segmentId,
      name: input.name,
      from: input.from,
      subject: input.subject,
      html: input.html,
    }),
  });
  if (typeof data.id !== "string")
    throw new AppError("Resend did not create the broadcast.", 502);
  return data.id as string;
}

export async function sendResendBroadcast(id: string) {
  return resendRequest(`/broadcasts/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}
