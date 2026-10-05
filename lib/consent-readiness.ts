import { db } from "./db";

const MAX_CONSENT_AGE_MS = 15 * 60 * 1000;
const SALESFORCE_SOURCES = new Set(["soql", "report", "listview", "campaign"]);

// Check small metadata records only; audience age and recipient count do not
// determine consent freshness. New sources must establish their own baseline.
export async function marketingConsentReadiness(runIds?: string[]) {
  const ids = [...new Set(runIds ?? [])];
  const [sync, account, runs] = await Promise.all([
    db.salesforceSuppressionSync.findUnique({ where: { id: "salesforce" } }),
    db.connection.findUnique({
      where: { provider: "salesforce" },
      select: { externalId: true, tokens: true },
    }),
    runIds
      ? db.pullRun.findMany({
          where: { id: { in: ids } },
          select: {
            orgId: true,
            status: true,
            audience: { select: { sourceType: true } },
          },
        })
      : [],
  ]);
  const now = Date.now();
  const webhookKey = process.env.RESEND_WEBHOOK_SECRET?.slice(6) ?? "";
  let reason: string | null = null;
  if (!account?.tokens || !account.externalId)
    reason = "Connect Salesforce to verify marketing consent.";
  else if (!sync?.enabled || sync.orgId !== account.externalId)
    reason =
      "Enable Salesforce opt-out sync for the connected org in Suppressions.";
  else if (!process.env.CRON_SECRET?.trim())
    reason = "Configure the scheduled opt-out worker before marketing sends.";
  else if (
    !process.env.RESEND_WEBHOOK_SECRET?.startsWith("whsec_") ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(webhookKey) ||
    Buffer.from(webhookKey, "base64").length < 16
  )
    reason = "Configure the Resend unsubscribe webhook before marketing sends.";
  else if (!sync.baselineConfirmedAt)
    reason =
      "Confirm the historical unsubscribe baseline and webhook test in Suppressions.";
  else if (!sync.cursor || !sync.lastCompletedAt)
    reason =
      "Wait for the first complete Salesforce opt-out scan in Suppressions.";
  else if (sync.error)
    reason =
      "Resolve the Salesforce opt-out sync error in Suppressions before sending.";
  else if (
    sync.cursor.getTime() > now ||
    now - sync.cursor.getTime() > MAX_CONSENT_AGE_MS
  )
    reason =
      "Salesforce consent is more than 15 minutes behind or its clock is invalid. Run opt-out sync in Suppressions; the audience does not need refreshing.";
  else if (
    runIds &&
    (!ids.length ||
      runs.length !== ids.length ||
      runs.some(
        (run) =>
          run.status !== "completed" ||
          run.orgId !== sync.orgId ||
          !SALESFORCE_SOURCES.has(run.audience.sourceType),
      ))
  )
    reason =
      "Selected snapshots must belong to the verified Salesforce org. Other sources need their own consent integration before marketing sends.";

  return {
    ready: reason === null,
    reason,
    verifiedThrough: sync?.cursor ?? null,
    baselineConfirmedAt: sync?.baselineConfirmedAt ?? null,
  };
}
