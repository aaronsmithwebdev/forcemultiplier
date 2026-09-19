"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Pause,
  X,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
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
    [offset, setOffset] = useState(0),
    [searchInput, setSearchInput] = useState(""),
    [search, setSearch] = useState(""),
    [contactsLoading, setContactsLoading] = useState(false),
    [lists, setLists] = useState<any[]>([]),
    [listSearch, setListSearch] = useState(""),
    [showSend, setShowSend] = useState(false),
    [sending, setSending] = useState(false),
    [delivery, setDelivery] = useState<any>(null),
    [message, setMessage] = useState("");
  const stop = useRef(false);
  const loadVersion = useRef(0);
  const load = async () => {
    const version = ++loadVersion.current;
    setContactsLoading(true);
    try {
      const row = await api(
        `audiences/${id}?offset=${offset}&search=${encodeURIComponent(search)}`,
      );
      if (version === loadVersion.current) setData(row);
    } finally {
      if (version === loadVersion.current) setContactsLoading(false);
    }
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [id, offset, search]);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setOffset(0);
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);
  useEffect(() => {
    return () => {
      stop.current = true;
    };
  }, []);
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
  async function openDelivery() {
    setShowSend(true);
    if (lists.length) return;
    setSending(true);
    setError("");
    try {
      const loaded: any[] = [];
      let cursor = "";
      do {
        const page = await api(
          "constant-contact/lists" +
            (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
        );
        loaded.push(...(page.lists || []));
        const next = page._links?.next?.href || "";
        if (next && next === cursor)
          throw new Error("List pagination did not advance.");
        cursor = next;
      } while (cursor && loaded.length < 5000); // ponytail: add a server-side list picker if an account reaches 5,000 lists.
      setLists(loaded);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function send(run?: any, listId?: string) {
    setSending(true);
    setError("");
    setMessage("");
    try {
      let current =
        run ||
        (await api(`audiences/${id}/deliveries`, "POST", {
          listId,
          permissionConfirmed: true,
        }));
      setShowSend(false);
      setDelivery(current);
      while (
        !stop.current &&
        ["pending", "running", "paused"].includes(current.status)
      ) {
        current = await api(`deliveries/${current.id}/step`, "POST");
        setDelivery(current);
        if (current.activityId)
          await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      setMessage(
        current.status === "completed"
          ? `${current.submitted.toLocaleString()} contacts were sent to ${current.listName}.`
          : `Delivery finished with ${current.failed.toLocaleString()} import errors.`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setSending(false);
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
  const activeDelivery = data.deliveries.find((r: any) =>
    ["pending", "running", "paused"].includes(r.status),
  );
  const run = busy ? progress : active;
  const sendingRun = delivery || activeDelivery;
  const matchingLists = lists.filter((list) =>
    list.name.toLowerCase().includes(listSearch.trim().toLowerCase()),
  );
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
          <div className="button-row">
            <Button busy={busy} disabled={busy || sending} onClick={pull}>
              <Download size={17} />
              {active ? "Resume pull" : "Pull contacts"}
            </Button>
            {data.completeRun && (
              <Button
                variant="secondary"
                busy={sending}
                disabled={busy || sending}
                onClick={() =>
                  activeDelivery ? send(activeDelivery) : openDelivery()
                }
              >
                <Send size={16} />
                {activeDelivery ? "Resume delivery" : "Send to a list"}
              </Button>
            )}
          </div>
        }
      />
      <Notice message={error} />
      <Notice message={message} success />
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
      {sendingRun &&
        ["pending", "running", "paused"].includes(sendingRun.status) && (
          <section className="card pull-progress">
            <div>
              <h3>Sending to {sendingRun.listName}…</h3>
              <p>
                {sendingRun.processed.toLocaleString()} of{" "}
                {sendingRun.total.toLocaleString()} Salesforce contacts checked
                · {sendingRun.submitted.toLocaleString()} submitted ·{" "}
                {sendingRun.skipped.toLocaleString()} excluded
              </p>
            </div>
            <div className="progress-track">
              <div
                style={{
                  width:
                    Math.min(
                      100,
                      (sendingRun.processed / sendingRun.total) * 100,
                    ) + "%",
                }}
              />
            </div>
            <Notice message={sendingRun.error || ""} />
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
          <div className="toolbar-actions">
            <div className="search-box">
              <Search size={16} />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search pulled contacts"
                placeholder="Search names or emails…"
              />
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
        </div>
        {!data.completeRun ? (
          <Empty
            title="Ready for your first pull"
            description="Pull the full audience from Salesforce. This saves contacts here without adding them to Constant Contact."
          />
        ) : contactsLoading ? (
          <Loading />
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
                {data.filteredCount === 0
                  ? "No contacts"
                  : `${offset + 1}–${Math.min(offset + 50, data.filteredCount)} of ${data.filteredCount}${search ? " matches" : ""}`}
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
                disabled={offset + 50 >= data.filteredCount || busy}
                onClick={() => setOffset(offset + 50)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>
      {data.deliveries.length > 0 && (
        <section className="card history-section">
          <div className="section-toolbar">
            <h2>Constant Contact deliveries</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>List</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Excluded</th>
                </tr>
              </thead>
              <tbody>
                {data.deliveries.map((r: any) => (
                  <tr key={r.id}>
                    <td>{date(r.createdAt)}</td>
                    <td>{r.listName}</td>
                    <td>
                      <Badge
                        tone={r.status === "completed" ? "green" : "amber"}
                      >
                        {r.status.replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td>{r.submitted.toLocaleString()}</td>
                    <td>{r.skipped.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
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
      {showSend && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-list-title"
            className="modal"
          >
            <div className="modal-header">
              <div>
                <h2 id="send-list-title">Send to Constant Contact</h2>
                <p>
                  Add eligible contacts from the last complete pull to one list.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                disabled={sending}
                onClick={() => setShowSend(false)}
              >
                <X size={20} />
              </button>
            </div>
            <Notice message={error} />
            {sending && lists.length === 0 ? (
              <Loading />
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = new FormData(event.currentTarget);
                  void send(undefined, String(values.get("listId")));
                }}
              >
                <label>Destination list</label>
                <div className="search-box modal-list-search">
                  <Search size={16} />
                  <input
                    value={listSearch}
                    onChange={(event) => setListSearch(event.target.value)}
                    aria-label="Search Constant Contact lists"
                    placeholder="Search Constant Contact lists…"
                    autoFocus
                  />
                </div>
                <div className="destination-list-picker">
                  {matchingLists.map((list) => (
                    <label key={list.list_id}>
                      <input
                        name="listId"
                        type="radio"
                        value={list.list_id}
                        required
                      />
                      <span>
                        <strong>{list.name}</strong>
                        <small>
                          {typeof list.membership_count === "number"
                            ? `${list.membership_count.toLocaleString()} members`
                            : "Constant Contact list"}
                        </small>
                      </span>
                    </label>
                  ))}
                  {matchingLists.length === 0 && (
                    <p className="empty-list-message">
                      {lists.length
                        ? "No lists match that search."
                        : "No Constant Contact lists were found."}
                    </p>
                  )}
                </div>
                <label className="consent-check">
                  <input name="permission" type="checkbox" required />
                  <span>
                    These contacts have permission to receive email. Salesforce
                    email opt-outs, missing emails, and invalid emails will be
                    excluded. Existing Constant Contact unsubscribe status will
                    be preserved.
                  </span>
                </label>
                <Button type="submit" busy={sending}>
                  <Send size={16} />
                  Start delivery
                </Button>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}
