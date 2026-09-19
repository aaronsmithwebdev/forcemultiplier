"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Pause, X, RefreshCw } from "lucide-react";
import {
  api,
  Badge,
  Button,
  date,
  Empty,
  Heading,
  Loading,
  Notice,
  valueAt,
} from "./common";
export function AudienceDetail({ id }: { id: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<any>(null),
    [offset, setOffset] = useState(0);
  const stop = useRef(false);
  const load = async () => {
    const row = await api(`audiences/${id}?offset=${offset}`);
    setData(row);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    return () => {
      stop.current = true;
    };
  }, [id, offset]);
  async function pull() {
    setBusy(true);
    stop.current = false;
    setError("");
    try {
      let run = await api(`audiences/${id}/pull`, "POST");
      setProgress(run);
      while (!stop.current && run.status !== "completed") {
        run = await api(`runs/${run.id}/step`, "POST");
        setProgress(run);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <>
        <Notice message={error} />
        <Loading />
      </>
    );
  const active = data.runs.find((r: any) =>
    ["pending", "running", "paused"].includes(r.status),
  );
  const run = busy ? progress : active;
  return (
    <>
      <Link className="back-link" href="/audiences">
        <ArrowLeft size={15} />
        Audience library
      </Link>
      <Heading
        eyebrow={`${data.sourceType.toUpperCase()} AUDIENCE`}
        title={data.name}
        description="Pull contacts into your workspace and inspect a complete snapshot."
        action={
          <Button busy={busy} disabled={busy} onClick={pull}>
            <Download size={17} />
            {active ? "Resume pull" : "Pull contacts"}
          </Button>
        }
      />
      <Notice message={error} />
      {run && (
        <section className="card pull-progress">
          <div>
            <h3>
              {busy
                ? "Pulling your contacts…"
                : run.status === "paused"
                  ? "Pull paused"
                  : "Pull ready to resume"}
            </h3>
            <p>
              {run.processed.toLocaleString()} of{" "}
              {run.total ? run.total.toLocaleString() : "…"} records processed
            </p>
          </div>
          <div className="progress-track">
            <div
              style={{
                width: run.total
                  ? Math.min(100, (run.processed / run.total) * 100) + "%"
                  : "0%",
              }}
            />
          </div>
          <Notice message={run.error || ""} />
          <div className="button-row">
            {busy ? (
              <Button
                variant="secondary"
                onClick={() => {
                  stop.current = true;
                }}
              >
                <Pause size={15} />
                Pause after this page
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await api(`runs/${run.id}/cancel`, "POST");
                    setProgress(null);
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <X size={15} />
                Cancel this pull
              </Button>
            )}
          </div>
        </section>
      )}
      <div className="audience-meta">
        <Badge>{data.sourceType}</Badge>
        <span>
          {data.memberCount.toLocaleString()} contacts in last complete snapshot
        </span>
        <span>Updated {date(data.completeRun?.finishedAt)}</span>
      </div>
      <details className="card query-details">
        <summary>Audience criteria and selected fields</summary>
        <pre>{data.query}</pre>
        <div className="selected-fields">
          {data.fields.map((f: string) => (
            <Badge key={f}>{f}</Badge>
          ))}
        </div>
        {data.sourceType !== "soql" && (
          <p className="muted">
            Saved criteria shown above. A new pull reads the current Salesforce
            definition and records its executed query in pull history.
          </p>
        )}
      </details>
      <section className="card">
        <div className="section-toolbar">
          <div>
            <h2>Contacts</h2>
            <p>
              {data.completeRun
                ? "Showing the last successfully completed pull."
                : "Your contacts will appear after the first complete pull."}
            </p>
          </div>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => load().catch((e) => setError(e.message))}
          >
            <RefreshCw size={15} />
            Refresh
          </Button>
        </div>
        {!data.completeRun ? (
          <Empty
            title="Ready for your first pull"
            description="Pull the full audience from Salesforce. This saves contacts here without adding them to Constant Contact."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Email</th>
                    <th>Consent</th>
                    {data.fields.map((f: string) => (
                      <th key={f}>{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m: any) => (
                    <tr key={m.salesforceId}>
                      <td>
                        <strong>{m.name || "Unnamed contact"}</strong>
                        <small className="block muted">{m.salesforceId}</small>
                      </td>
                      <td>{m.email || "No email"}</td>
                      <td>
                        <Badge tone={m.optedOut ? "amber" : ""}>
                          {m.optedOut ? "Opted out" : "Not opted out in SF"}
                        </Badge>
                      </td>
                      {data.fields.map((f: string) => (
                        <td key={f}>{String(valueAt(m.data, f) ?? "—")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {data.memberCount === 0
                  ? "No contacts"
                  : `${offset + 1}–${Math.min(offset + 50, data.memberCount)} of ${data.memberCount}`}
              </span>
              <Button
                variant="ghost"
                disabled={offset === 0 || busy}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                disabled={offset + 50 >= data.memberCount || busy}
                onClick={() => setOffset(offset + 50)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>
      <section className="card history-section">
        <div className="section-toolbar">
          <h2>Recent pulls</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th>Records</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r: any) => (
                <tr key={r.id}>
                  <td>{date(r.createdAt)}</td>
                  <td>
                    <Badge tone={r.status === "completed" ? "green" : ""}>
                      {r.status}
                    </Badge>
                  </td>
                  <td>{r.processed}</td>
                  <td>
                    <details>
                      <summary>View query</summary>
                      <pre>{r.query}</pre>
                      {r.error && <p>{r.error}</p>}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
