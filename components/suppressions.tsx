"use client";
import { useEffect, useState } from "react";
import { parseEmailCsv } from "@/lib/resubscribe-input";
import { api, Button, date, Heading, Notice } from "./common";

type State = {
  total: number;
  recent: {
    email: string;
    source: string;
    sourceRef: string | null;
    occurredAt: string | null;
    createdAt: string;
  }[];
};

export function Suppressions() {
  const [state, setState] = useState<State | null>(null);
  const [csv, setCsv] = useState<ReturnType<typeof parseEmailCsv> | null>(null);
  const [sourceRef, setSourceRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    setState(await api("suppressions"));
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!csv) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <>
      <Heading
        eyebrow="CONSENT"
        title="Suppressions"
        description="Maintain the global do-not-email list used by every campaign and legacy delivery."
      />
      <Notice message={error} />
      <Notice message={message} success />
      <section className="card schedule-card">
        <h2>Mass import unsubscribes</h2>
        <p>
          Upload a CSV with exactly one Email or Email Address column. Imports
          are additive: an upload can suppress an address but cannot resubscribe
          it. No provider is contacted.
        </p>
        <form onSubmit={upload}>
          <fieldset disabled={busy} className="resubscribe-fields">
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
            <Button type="submit" busy={busy} disabled={!csv}>
              Import global unsubscribes
            </Button>
          </fieldset>
        </form>
      </section>
      <section className="card schedule-card">
        <h2>{state?.total.toLocaleString() ?? "—"} global suppressions</h2>
        <p>
          These addresses are excluded even if they still qualify for a
          Salesforce audience.
        </p>
        {!!state?.recent.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Source</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {state.recent.map((row) => (
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
