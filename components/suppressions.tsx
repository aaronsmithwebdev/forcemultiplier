"use client";
import { useEffect, useState } from "react";
import { Play, ShieldCheck } from "lucide-react";
import { parseEmailCsv } from "@/lib/resubscribe-input";
import { api, Badge, Button, date, Heading, Notice } from "./common";

type Event = {
  id: string;
  email: string | null;
  direction: string;
  source: string;
  sourceRef: string | null;
  occurredAt: string | null;
  recordedAt: string;
  salesforceId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  subject: string | null;
  providerMessageId: string | null;
  status: string;
  attempts: number;
  error: string | null;
  processedAt: string | null;
};

type State = {
  total: number;
  recentSuppressions: {
    email: string;
    source: string;
    sourceRef: string | null;
    occurredAt: string | null;
    createdAt: string;
  }[];
  recentEvents: Event[];
  sync: {
    enabled: boolean;
    field: string;
    scanning: boolean;
    lastRunAt: string | null;
    lastCompletedAt: string | null;
    error: string | null;
    schedulerReady: boolean;
    counts: Record<string, number>;
  };
};

const direction = (value: string) =>
  value === "salesforce_to_forcemultiplier"
    ? "Salesforce → ForceMultiplier"
    : value === "forcemultiplier_to_salesforce"
      ? "ForceMultiplier → Salesforce"
      : "CSV → ForceMultiplier";

const originatingEmail = (event: Event) =>
  event.subject ||
  event.campaignName ||
  event.providerMessageId ||
  "Not supplied by source";

export function Suppressions() {
  const [state, setState] = useState<State | null>(null);
  const [csv, setCsv] = useState<ReturnType<typeof parseEmailCsv> | null>(null);
  const [sourceRef, setSourceRef] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh(query = search) {
    setState(
      await api(
        `suppressions${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      ),
    );
  }

  useEffect(() => {
    const timer = setTimeout(
      () => refresh(search).catch((e) => setError(e.message)),
      search ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [search]);

  async function syncAction(
    name: string,
    request: () => Promise<any>,
    success: string | ((result: any) => string),
  ) {
    setBusy(name);
    setError("");
    setMessage("");
    try {
      const result = await request();
      await refresh();
      setMessage(typeof success === "function" ? success(result) : success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!csv) return;
    setBusy("import");
    setError("");
    setMessage("");
    let added = 0;
    let existing = 0;
    try {
      for (let start = 0; start < csv.emails.length; start += 500) {
        const result = await api("suppressions/import", "POST", {
          sourceRef,
          emails: csv.emails.slice(start, start + 500),
        });
        added += result.added;
        existing += result.existing;
        setMessage(
          `Imported ${Math.min(start + 500, csv.emails.length).toLocaleString()} of ${csv.emails.length.toLocaleString()} emails.`,
        );
      }
      await refresh();
      setCsv(null);
      setMessage(
        `${added.toLocaleString()} new global unsubscribes imported; ${existing.toLocaleString()} were already suppressed.`,
      );
    } catch (e) {
      setError(
        `${(e as Error).message} Successfully imported chunks remain suppressed; retrying the same file is safe.`,
      );
    } finally {
      setBusy("");
    }
  }

  const sync = state?.sync;
  const inbound = sync?.counts["salesforce_to_forcemultiplier:recorded"] || 0;
  const written =
    (sync?.counts["forcemultiplier_to_salesforce:written"] || 0) +
    (sync?.counts["forcemultiplier_to_salesforce:already_opted_out"] || 0);
  const unresolved = ["failed", "unmatched", "ambiguous"].reduce(
    (total, status) =>
      total + (sync?.counts[`forcemultiplier_to_salesforce:${status}`] || 0),
    0,
  );

  return (
    <>
      <Heading
        eyebrow="CONSENT"
        title="Suppressions"
        description="Maintain and audit the global do-not-email list used by every campaign and legacy delivery."
      />
      <Notice message={error} />
      <Notice message={message} success />
      {sync && !sync.schedulerReady && (
        <Notice message="Scheduled Salesforce opt-out sync needs CRON_SECRET configured in the hosting environment." />
      )}
      <section className="card schedule-card">
        <div className="writeback-title">
          <span>
            <ShieldCheck size={17} />
            <strong>Salesforce two-way opt-out sync</strong>
          </span>
          <Badge tone={sync?.enabled ? "green" : ""}>
            {sync?.enabled ? "Active" : "Off"}
          </Badge>
        </div>
        <p>
          Imports existing and new Salesforce <code>{sync?.field}</code> values
          into ForceMultiplier, and writes confirmed global suppressions back as{" "}
          <code>true</code>. Automated sync never clears an opt-out.
        </p>
        <Notice message={sync?.error || ""} />
        {sync?.enabled ? (
          <>
            <small>
              Last checked {date(sync.lastRunAt)} · Last complete Salesforce
              scan {date(sync.lastCompletedAt)}
              {sync.scanning ? " · Baseline scan in progress" : ""}
            </small>
            <div className="writeback-counts">
              <span>
                <strong>{inbound.toLocaleString()}</strong>
                from Salesforce
              </span>
              <span>
                <strong>{written.toLocaleString()}</strong>
                written or already opted out
              </span>
              <span>
                <strong>{unresolved.toLocaleString()}</strong>
                needs review
              </span>
            </div>
            <div className="button-row">
              <Button
                variant="secondary"
                busy={busy === "run"}
                disabled={!!busy}
                onClick={() =>
                  syncAction(
                    "run",
                    () => api("suppressions/salesforce-sync/run", "POST"),
                    "Salesforce opt-out sync completed.",
                  )
                }
              >
                <Play size={15} /> Run now
              </Button>
              <Button
                variant="ghost"
                busy={busy === "retry"}
                disabled={!!busy || !unresolved}
                onClick={() =>
                  syncAction(
                    "retry",
                    () => api("suppressions/salesforce-sync/retry", "POST"),
                    (result) =>
                      `${result.retried} unresolved opt-out${result.retried === 1 ? "" : "s"} queued to retry.`,
                  )
                }
              >
                Retry unresolved
              </Button>
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={() =>
                  syncAction(
                    "disable",
                    () =>
                      api("suppressions/salesforce-sync", "PUT", {
                        enabled: false,
                      }),
                    "Salesforce opt-out sync turned off. Existing suppressions remain active.",
                  )
                }
              >
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="secondary"
            busy={busy === "enable"}
            disabled={!!busy}
            onClick={() =>
              syncAction(
                "enable",
                () =>
                  api("suppressions/salesforce-sync", "PUT", {
                    enabled: true,
                  }),
                "Salesforce opt-out sync enabled. Run now starts the baseline import; the scheduled worker checks every five minutes.",
              )
            }
          >
            Enable Salesforce opt-out sync
          </Button>
        )}
      </section>
      <section className="card schedule-card">
        <h2>Mass import unsubscribes</h2>
        <p>
          Upload a CSV with exactly one Email or Email Address column. Imports
          are additive: an upload can suppress an address but cannot resubscribe
          it. If Salesforce sync is active, unique matching Contacts will be
          updated on its next run.
        </p>
        <form onSubmit={upload}>
          <fieldset disabled={!!busy} className="resubscribe-fields">
            <label>
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                required
                onChange={async (event) => {
                  setCsv(null);
                  setError("");
                  setMessage("");
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    const parsed = parseEmailCsv(await file.text());
                    setCsv(parsed);
                    setSourceRef(file.name.slice(0, 120));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            </label>
            {csv && (
              <p role="status">
                {csv.emails.length.toLocaleString()} unique emails ·{" "}
                {csv.duplicates.toLocaleString()} duplicates removed ·{" "}
                {csv.invalid.toLocaleString()} invalid rows excluded
              </p>
            )}
            <Button type="submit" busy={busy === "import"} disabled={!csv}>
              Import global unsubscribes
            </Button>
          </fieldset>
        </form>
      </section>
      <section className="card schedule-card">
        <h2>Unsubscribe activity log</h2>
        <p>
          Timestamps and direction are retained for every recorded source. The
          originating campaign or message appears when the source provides it;
          Salesforce Contact opt-outs do not include that detail.
        </p>
        <label>
          Search by email address
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="person@example.org"
          />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Direction</th>
                <th>Unsubscribed / observed</th>
                <th>Originating email</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {state?.recentEvents.map((event) => (
                <tr key={event.id}>
                  <td>
                    {event.email || "No valid email"}
                    <small>{event.salesforceId || event.sourceRef}</small>
                  </td>
                  <td>{direction(event.direction)}</td>
                  <td>{date(event.occurredAt || event.recordedAt)}</td>
                  <td>{originatingEmail(event)}</td>
                  <td>
                    <Badge
                      tone={
                        ["recorded", "written", "already_opted_out"].includes(
                          event.status,
                        )
                          ? "green"
                          : ["failed", "unmatched", "ambiguous"].includes(
                                event.status,
                              )
                            ? "amber"
                            : ""
                      }
                    >
                      {event.status.replaceAll("_", " ")}
                    </Badge>
                    {event.error && <small>{event.error}</small>}
                  </td>
                </tr>
              ))}
              {state?.recentEvents.length === 0 && (
                <tr>
                  <td colSpan={5}>No unsubscribe activity recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card schedule-card">
        <h2>{state?.total.toLocaleString() ?? "—"} global suppressions</h2>
        <p>
          These addresses remain excluded even if they still qualify for a
          Salesforce audience.
        </p>
        {!!state?.recentSuppressions.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>First source</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {state.recentSuppressions.map((row) => (
                  <tr key={row.email}>
                    <td>{row.email}</td>
                    <td>{row.sourceRef || row.source.replaceAll("_", " ")}</td>
                    <td>{date(row.occurredAt || row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
