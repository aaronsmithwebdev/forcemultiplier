"use client";
import { useEffect, useState } from "react";
import { api, Badge, Button, date, Heading, Notice } from "./common";
import { parseResubscribeCsv } from "@/lib/resubscribe-input";

type Field = { name: string; label: string; type: string };
type Job = {
  id: string;
  name: string;
  status: string;
  listName: string;
  error: string | null;
  presentField: string | null;
  amountField: string | null;
  minimumAmount: number | null;
  createdAt: string;
  _count?: { members: number };
};
type Detail = Job & {
  counts: Record<string, number>;
  total: number;
  members: {
    email: string;
    status: string;
    error: string | null;
    data: Record<string, unknown> | null;
  }[];
};
type State = {
  jobs: Job[];
  today: { contacts: number; calls: number } | null;
  schedulerReady: boolean;
};
const label = (value: string) => value.replaceAll("_", " ");

export function Resubscriptions() {
  const [state, setState] = useState<State | null>(null);
  const [lists, setLists] = useState<{ list_id: string; name: string }[]>([]);
  const [listCursor, setListCursor] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [csv, setCsv] = useState<ReturnType<typeof parseResubscribeCsv> | null>(
    null,
  );
  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
  const [presentField, setPresentField] = useState("");
  const [amountField, setAmountField] = useState("");
  const [minimum, setMinimum] = useState("100");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadLists(cursor = "") {
    const data = await api(
      "constant-contact/lists" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    setLists((previous) =>
      cursor ? [...previous, ...data.lists] : data.lists || [],
    );
    setListCursor(data._links?.next?.href || "");
  }
  useEffect(() => {
    loadLists().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await api("resubscriptions");
        const nextDetail = selected
          ? await api(
              `resubscriptions/${selected}?status=${encodeURIComponent(status)}&offset=${offset}`,
            )
          : null;
        if (alive) {
          setState(next);
          setDetail(nextDetail);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) timer = setTimeout(refresh, 10000);
      }
    }
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selected, status, offset]);

  async function action(job: Job, action: string) {
    setBusy(true);
    setError("");
    try {
      await api(`resubscriptions/${job.id}/status`, "POST", { action });
      setState(await api("resubscriptions"));
      if (selected === job.id)
        setDetail(
          await api(
            `resubscriptions/${job.id}?status=${encodeURIComponent(status)}&offset=${offset}`,
          ),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!csv) return;
    setBusy(true);
    setError("");
    let jobId = "";
    try {
      const job = await api("resubscriptions", "POST", {
        name,
        listId,
        presentField: presentField || null,
        amountField: amountField || null,
        minimumAmount: amountField ? Number(minimum) : null,
      });
      jobId = job.id;
      setSelected(job.id);
      setStatus("");
      setOffset(0);
      for (let start = 0; start < csv.emails.length; start += 500) {
        const chunk = {
          index: start / 500,
          emails: csv.emails.slice(start, start + 500),
        };
        for (let attempt = 0; ; attempt++) {
          try {
            await api(`resubscriptions/${job.id}/chunk`, "POST", chunk);
            break;
          } catch (e) {
            if (attempt === 2) throw e;
          }
        }
        setMessage(
          `Uploaded ${Math.min(start + 500, csv.emails.length).toLocaleString()} of ${csv.emails.length.toLocaleString()} emails. Keep this page open until the upload finishes.`,
        );
      }
      await api(`resubscriptions/${job.id}/finish`, "POST");
      setMessage(
        "Upload complete. Review the job below, then start daily resubscription when it is ready.",
      );
      setCsv(null);
      setState(await api("resubscriptions"));
      setDetail(await api(`resubscriptions/${job.id}`));
    } catch (e) {
      setError(
        `${(e as Error).message}${jobId ? " The incomplete job will not resubscribe anyone. Cancel it below and upload again." : ""}`,
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading
        eyebrow="CONTACT RECOVERY"
        title="Resubscriptions"
        description="Restore email subscriptions requested through your app, up to 2,500 contacts per day across all jobs."
      />
      <Notice message={error} />
      <Notice message={message} success />
      {state && !state.schedulerReady && (
        <Notice message="Scheduled processing needs CRON_SECRET configured in your hosting environment." />
      )}
      <section className="card schedule-card">
        <h2>Upload requested resubscriptions</h2>
        <p>
          CSV with an Email or Email Address header, up to 100,000 rows and 20
          MB. Existing contact details and list memberships are preserved.
        </p>
        <form onSubmit={upload}>
          <fieldset disabled={busy} className="resubscribe-fields">
            <div className="schedule-fields">
              <label>
                CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  required
                  onChange={async (e) => {
                    setCsv(null);
                    setError("");
                    setMessage("");
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > 20 * 1024 * 1024)
                        throw new Error("CSV must be 20 MB or smaller.");
                      setCsv(parseResubscribeCsv(await file.text()));
                      setName(file.name.replace(/\.csv$/i, "").slice(0, 120));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              </label>
              <label>
                Job name
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Destination list (required)
                <select
                  required
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                >
                  <option value="">Choose a list</option>
                  {lists.map((list) => (
                    <option key={list.list_id} value={list.list_id}>
                      {list.name}
                    </option>
                  ))}
                </select>
                <small>
                  Every successful resubscription adds the contact to this list
                  while preserving their existing list memberships.
                </small>
              </label>
            </div>
            {listCursor && (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  loadLists(listCursor).catch((e) => setError(e.message))
                }
              >
                Load more lists
              </Button>
            )}
            {csv && (
              <p role="status">
                {csv.emails.length.toLocaleString()} unique emails ·{" "}
                {csv.duplicates.toLocaleString()} duplicates removed ·{" "}
                {csv.invalid.toLocaleString()} invalid rows excluded.
              </p>
            )}
            <details>
              <summary>Optional Salesforce filters</summary>
              <p>
                Match by email. Only unique Salesforce matches satisfying both
                selected filters are queued. With an amount field, larger
                amounts run first. Filters use a snapshot prepared before the
                job starts.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  try {
                    const data = await api(
                      "salesforce/metadata?object=Contact",
                    );
                    setFields(data.fields);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Load Salesforce fields
              </Button>
              <div className="schedule-fields">
                <label>
                  Require a value / checked box
                  <select
                    value={presentField}
                    onChange={(e) => setPresentField(e.target.value)}
                  >
                    <option value="">No filter</option>
                    {fields
                      .filter((f) =>
                        [
                          "string",
                          "textarea",
                          "picklist",
                          "multipicklist",
                          "boolean",
                          "currency",
                          "double",
                          "int",
                          "percent",
                        ].includes(f.type),
                      )
                      .map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label} ({f.name})
                        </option>
                      ))}
                  </select>
                  <small>
                    For example All_Mito_Connections__c. Text must be nonempty,
                    checkboxes true, or numbers greater than zero.
                  </small>
                </label>
                <label>
                  Donation / amount field
                  <select
                    value={amountField}
                    onChange={(e) => setAmountField(e.target.value)}
                  >
                    <option value="">No amount filter</option>
                    {fields
                      .filter((f) =>
                        ["currency", "double", "int", "percent"].includes(
                          f.type,
                        ),
                      )
                      .map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label} ({f.name})
                        </option>
                      ))}
                  </select>
                </label>
                {amountField && (
                  <label>
                    Amount greater than
                    <input
                      type="number"
                      required
                      min="0"
                      step="any"
                      value={minimum}
                      onChange={(e) => setMinimum(e.target.value)}
                    />
                  </label>
                )}
              </div>
            </details>
            <p>
              This job changes Constant Contact email permission to explicit.
              Salesforce opt-out fields are shown for context and are not
              changed.
            </p>
            <Button type="submit" busy={busy} disabled={!csv || !listId}>
              Upload and prepare
            </Button>
          </fieldset>
        </form>
      </section>
      <section className="card schedule-card">
        <div className="section-toolbar">
          <div>
            <h2>Daily processing</h2>
            <p>
              {state?.today?.contacts ?? 0} / 2,500 contact attempts ·{" "}
              {state?.today?.calls ?? 0} / 5,000 job API calls today. Resets at
              midnight UTC; retries count toward these limits.
            </p>
          </div>
        </div>
        <p>
          After starting, jobs continue in the background. Pausing stops new
          requests; an update already in flight may finish.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Contacts</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state?.jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => {
                        setSelected(job.id);
                        setDetail(null);
                        setStatus("");
                        setOffset(0);
                      }}
                    >
                      {job.name}
                    </button>
                    <small>
                      {job.listName} · {date(job.createdAt)}
                    </small>
                    {job.error && <Notice message={job.error} />}
                  </td>
                  <td>{job._count?.members.toLocaleString()}</td>
                  <td>
                    <Badge>{label(job.status)}</Badge>
                  </td>
                  <td>
                    <div className="button-row">
                      {["ready", "paused"].includes(job.status) && (
                        <Button
                          busy={busy}
                          disabled={!state.schedulerReady}
                          onClick={() => action(job, "start")}
                        >
                          {job.status === "paused"
                            ? "Resume"
                            : "Start daily resubscription"}
                        </Button>
                      )}
                      {job.status === "running" && (
                        <Button
                          variant="secondary"
                          busy={busy}
                          onClick={() => action(job, "pause")}
                        >
                          Pause
                        </Button>
                      )}
                      {!["completed", "cancelled"].includes(job.status) && (
                        <Button
                          variant="ghost"
                          busy={busy}
                          onClick={() => action(job, "cancel")}
                        >
                          Cancel job
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {state?.jobs.length === 0 && (
                <tr>
                  <td colSpan={4}>No resubscription jobs yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {detail && (
        <section className="card schedule-card">
          <h2>{detail.name}</h2>
          <p>
            {detail.presentField ? `${detail.presentField} has a value. ` : ""}
            {detail.amountField
              ? `${detail.amountField} > ${detail.minimumAmount}, highest amounts first.`
              : ""}
          </p>
          {detail.status === "preparing" && (
            <p>
              Matching Salesforce contacts in the background. This job becomes
              ready after all uploaded emails have been checked.
            </p>
          )}
          <p>
            {Object.entries(detail.counts)
              .map(([key, count]) => `${count.toLocaleString()} ${label(key)}`)
              .join(" · ")}
          </p>
          {!!detail.counts.uncertain && (
            <Notice message="Some updates have an uncertain outcome. Check those contacts in Constant Contact before submitting any new resubscription request." />
          )}
          <label>
            Show results
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All rows</option>
              {[
                "pending",
                "queued",
                "checking",
                "writing",
                "completed",
                "excluded",
                "unmatched",
                "skipped",
                "failed",
                "uncertain",
              ].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Salesforce values</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {detail.members.map((member) => (
                  <tr key={member.email}>
                    <td>{member.email}</td>
                    <td>
                      <Badge>{label(member.status)}</Badge>
                    </td>
                    <td>
                      {member.data
                        ? Object.entries(member.data)
                            .filter(([key]) => !["Email", "Id"].includes(key))
                            .map(([key, value]) => (
                              <div key={key}>
                                <strong>{key}: </strong>
                                {String(value ?? "—")}
                              </div>
                            ))
                        : "—"}
                    </td>
                    <td>{member.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {detail.total ? offset + 1 : 0}–
              {Math.min(offset + 50, detail.total)} of{" "}
              {detail.total.toLocaleString()}
            </span>
            <Button
              variant="secondary"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={offset + 50 >= detail.total}
              onClick={() => setOffset(offset + 50)}
            >
              Next
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
