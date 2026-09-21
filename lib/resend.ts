import { AppError } from "./errors";

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
