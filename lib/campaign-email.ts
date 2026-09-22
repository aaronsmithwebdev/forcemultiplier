import mjml2html from "mjml";
import type { TemplateContent } from "@templatical/types";
import { AppError } from "./errors";

export type CampaignEmailSettings = {
  subject: string;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
};

export function resendTestPayload(
  settings: CampaignEmailSettings,
  recipient: string,
  html: string,
) {
  return {
    from: `${settings.fromName} <${settings.fromEmail}>`,
    to: [recipient],
    subject: `[TEST] ${settings.subject}`,
    html,
    reply_to: settings.replyToEmail,
  };
}

export async function renderCampaignHtml(content: TemplateContent) {
  const { renderToMjml } = await import("@templatical/renderer");
  const mjml = await renderToMjml(content, { allowHtmlBlocks: true });
  const result = await mjml2html(mjml, { validationLevel: "strict" });
  if (result.errors.length)
    throw new AppError(
      `Email rendering failed: ${result.errors[0]?.formattedMessage || "Invalid email content."}`,
      422,
    );
  return result.html;
}

export async function sendResendTest(
  settings: CampaignEmailSettings,
  recipient: string,
  content: TemplateContent,
  key = process.env.RESEND_API_KEY,
  request: typeof fetch = fetch,
) {
  if (!key?.trim())
    throw new AppError(
      "Resend is not configured. Add RESEND_API_KEY, then try again.",
      409,
    );
  const html = await renderCampaignHtml(content);
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resendTestPayload(settings, recipient, html)),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    redirect: "error",
  });
  if (response.ok) return response.json();
  let message = "";
  try {
    const data = await response.json();
    message = typeof data?.message === "string" ? data.message : "";
  } catch {}
  if (response.status === 401)
    throw new AppError("Resend rejected RESEND_API_KEY.", 409);
  if (response.status === 429)
    throw new AppError(
      "Resend rate-limited this test. Try again shortly.",
      429,
    );
  throw new AppError(
    message || `Resend could not send the test (${response.status}).`,
    response.status === 403 || response.status === 422 ? 409 : 502,
  );
}
