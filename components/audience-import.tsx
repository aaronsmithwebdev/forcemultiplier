"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ImportRow } from "@/lib/audience-imports";
import { api, Badge, Button, Notice } from "./common";
export function AudienceImport({
  audienceId,
  onImported,
}: {
  audienceId?: string;
  onImported?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("Imported audience"),
    [text, setText] = useState(""),
    [format, setFormat] = useState<"csv" | "paste">("paste");
  const [preview, setPreview] = useState<{
    id: string;
    rows: ImportRow[];
  } | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [page, setPage] = useState(0);
  async function inspect() {
    setBusy(true);
    setError("");
    setMessage("");
    setPreview(null);
    setResolutions({});
    setPage(0);
    try {
      setPreview(
        await api("audience-imports", "POST", {
          name,
          audienceId,
          text,
          format,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `audience-imports/${preview.id}/commit`,
        "POST",
        { resolutions, permissionConfirmed: confirmed },
      );
      setPreview(null);
      setText("");
      setConfirmed(false);
      if (audienceId) {
        setMessage(
          `Added ${result.added ?? 0} memberships. ${result.held ?? 0} ambiguous rows held. Pull the audience to review the new snapshot.`,
        );
        onImported?.();
      } else router.push(`/audiences/${result.audienceId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows = preview?.rows || [];
  const ready = rows.filter(
    (r) =>
      r.status === "new" ||
      r.status === "matched" ||
      resolutions[String(r.row)],
  ).length;
  return (
    <section className="card audience-import-card">
      <div className="section-toolbar">
        <div>
          <h2>Import list</h2>
          <p>
            Match existing people by email or create local people. Salesforce
            Contact IDs are optional.
          </p>
        </div>
      </div>
      <div className="audience-import-body">
        <Notice message={error} />
        <Notice message={message} success />
        {!preview ? (
          <>
            {!audienceId && (
              <label>
                Audience name
                <input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <label>
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2_000_000) {
                    setError("Import must be 2 MB or smaller.");
                    return;
                  }
                  try {
                    setText(await file.text());
                    setFormat("csv");
                    if (!audienceId)
                      setName(file.name.replace(/\.csv$/i, "").slice(0, 120));
                    setError("");
                  } catch {
                    setError("Could not read this file.");
                  }
                }}
              />
            </label>
            <p className="muted">
              CSV needs an Email or Email Address column. First Name and Last
              Name are optional. Up to 2,000 rows per import.
            </p>
            <label>
              Input format
              <select
                value={format}
                disabled={busy}
                onChange={(e) => setFormat(e.target.value as "csv" | "paste")}
              >
                <option value="paste">Pasted email addresses</option>
                <option value="csv">CSV with a header row</option>
              </select>
            </label>
            <label>
              {format === "paste"
                ? "Email addresses (one per line, or separated by commas or semicolons)"
                : "CSV content"}
              <textarea
                rows={7}
                value={text}
                disabled={busy}
                maxLength={2_000_000}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <Button
              busy={busy}
              disabled={!text.trim() || !name.trim()}
              onClick={inspect}
            >
              Preview matches
            </Button>
          </>
        ) : (
          <>
            <p role="status">
              {rows.filter((r) => r.status === "matched").length} matched ·{" "}
              {rows.filter((r) => r.status === "new").length} new ·{" "}
              {rows.filter((r) => r.status === "ambiguous").length} need review
              · {rows.filter((r) => r.status === "duplicate").length} duplicates
              · {rows.filter((r) => r.status === "invalid").length} invalid ·{" "}
              {rows.filter((r) => r.blocked).length} blocked from marketing
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Email</th>
                    <th>Result</th>
                    <th>Person / review match</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(page * 50, page * 50 + 50).map((row) => (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td>{row.email}</td>
                      <td>
                        <Badge>{row.status}</Badge>
                        {row.blocked && (
                          <small className="block">
                            Blocked from marketing
                          </small>
                        )}
                      </td>
                      <td>
                        {row.status === "ambiguous" ? (
                          <select
                            aria-label={`Match for row ${row.row}`}
                            value={resolutions[String(row.row)] || ""}
                            disabled={busy}
                            onChange={(e) =>
                              setResolutions({
                                ...resolutions,
                                [String(row.row)]: e.target.value,
                              })
                            }
                          >
                            <option value="">Hold for review</option>
                            {row.candidates.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} · {p.salesforceId || `Local ${p.id}`}
                              </option>
                            ))}
                          </select>
                        ) : row.status === "matched" ? (
                          <Link href={`/contacts/${row.candidates[0].id}`}>
                            {row.candidates[0].name} ·{" "}
                            {row.candidates[0].salesforceId
                              ? "Salesforce"
                              : "Local"}
                            {row.candidates[0].currentEmail &&
                              row.candidates[0].currentEmail !== row.email && (
                                <small className="block">
                                  Current email:{" "}
                                  {row.candidates[0].currentEmail}
                                </small>
                              )}
                          </Link>
                        ) : row.status === "new" ? (
                          "New local person"
                        ) : (
                          "Skipped"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {page * 50 + 1}–{Math.min(page * 50 + 50, rows.length)} of{" "}
                {rows.length}
              </span>
              <div className="button-row">
                <Button
                  variant="secondary"
                  disabled={!page || busy}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={(page + 1) * 50 >= rows.length || busy}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
            <p>
              Importing preserves unsubscribe and delivery blocks. Unresolved
              matches stay out of this import. No Salesforce Contacts will be
              created.
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I have reviewed these matches and have permission to use this
              list.
            </label>
            <div className="button-row">
              <Button
                busy={busy}
                disabled={!confirmed || !ready}
                onClick={commit}
              >
                Import {ready} people
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Back to list
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
