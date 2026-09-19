"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Code2,
  FileChartColumn,
  ListFilter,
  Flag,
  ArrowLeft,
  Eye,
  Save,
  Search,
  ArrowRight,
} from "lucide-react";
import { api, Badge, Button, Heading, Notice, valueAt } from "./common";
import { FieldBrowser } from "./field-browser";
const types = [
  ["soql", "SOQL query", "Write exactly who you need.", Code2],
  [
    "report",
    "Report criteria",
    "Use a saved report’s filters.",
    FileChartColumn,
  ],
  ["listview", "List view", "Use a Contact list view.", ListFilter],
  ["campaign", "Campaign", "Pull Contact members.", Flag],
] as const;
export function AudienceBuilder() {
  const [type, setType] = useState("soql"),
    [name, setName] = useState(""),
    [query, setQuery] = useState("SELECT Id FROM Contact\nWHERE Email != null"),
    [sourceId, setSourceId] = useState(""),
    [fields, setFields] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [notes, setNotes] = useState<string[]>([]),
    [records, setRecords] = useState<any[] | null>(null),
    [sources, setSources] = useState<any[]>([]),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState(""),
    [showFields, setShowFields] = useState(false);
  async function work(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function changeType(value: string) {
    setType(value);
    setSources([]);
    setSourceId("");
    setNotes([]);
    setRecords(null);
    setCursor("");
    setQuery(
      value === "soql" ? "SELECT Id FROM Contact\nWHERE Email != null" : "",
    );
  }
  async function loadSources(more = false) {
    await work("sources", async () => {
      const kind =
        type === "report"
          ? "reports"
          : type === "campaign"
            ? "campaigns"
            : "listviews";
      const d = await api(
        `salesforce/catalog?kind=${kind}&search=${encodeURIComponent(search)}${more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      );
      setSources((previous) =>
        more
          ? [...previous, ...(d.records || d.listviews || [])]
          : d.records || d.listviews || [],
      );
      setCursor(d.nextRecordsUrl || "");
    });
  }
  async function selectSource(id: string) {
    setSourceId(id);
    setQuery("");
    setNotes([]);
    setRecords(null);
    const source = sources.find((s) => (s.Id || s.id) === id);
    if (!name) setName(source?.Name || source?.label || "");
    await work("resolve", async () => {
      const data = await api("salesforce/source", "POST", { kind: type, id });
      setQuery(data.query || "");
      setNotes(data.notes || []);
    });
  }
  return (
    <>
      <Link className="back-link" href="/audiences">
        <ArrowLeft size={15} />
        Audience library
      </Link>
      <Heading
        eyebrow="BUILD AN AUDIENCE"
        title="Start with the right people."
        description="Choose your criteria, add the fields you need, and preview the results."
      />
      <Notice message={error} />
      <div className="source-types">
        {types.map(([key, label, description, Icon]) => (
          <button
            type="button"
            key={key}
            className={type === key ? "selected" : ""}
            disabled={!!busy}
            onClick={() => changeType(key)}
          >
            <Icon size={21} />
            <strong>{label}</strong>
            <small>{description}</small>
          </button>
        ))}
      </div>
      <div className="builder-grid">
        <section className="card builder-main">
          <div className="section-title">
            <span className="step-number">1</span>
            <h2>Define your audience</h2>
          </div>
          <label>
            Audience name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Active members · New South Wales"
              maxLength={120}
            />
          </label>
          {type !== "soql" && (
            <div className="source-picker">
              <label>
                Find a Salesforce{" "}
                {types.find((t) => t[0] === type)?.[1].toLowerCase()}
                <div className="inline-input">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name"
                  />
                  <Button
                    variant="secondary"
                    busy={busy === "sources"}
                    disabled={!!busy}
                    onClick={() => loadSources()}
                  >
                    <Search size={16} />
                    Browse
                  </Button>
                </div>
              </label>
              {sources.length > 0 && (
                <label>
                  Source
                  <select
                    value={sourceId}
                    onChange={(e) => selectSource(e.target.value)}
                    disabled={!!busy}
                  >
                    <option value="">Choose a source…</option>
                    {sources.map((s) => (
                      <option key={s.Id || s.id} value={s.Id || s.id}>
                        {s.Name || s.label || s.developerName}
                        {s.FolderName ? " · " + s.FolderName : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {cursor && (
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => loadSources(true)}
                >
                  Load more sources
                </Button>
              )}
            </div>
          )}
          {notes.length > 0 && (
            <div className={`notice ${query ? "success" : "error"}`}>
              <div>
                {notes.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
                {!query && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setType("soql");
                      setSourceId("");
                      setQuery("SELECT Id FROM Contact\nWHERE Email != null");
                      setNotes([]);
                    }}
                  >
                    Use an independent SOQL query
                  </Button>
                )}
              </div>
            </div>
          )}
          <label>
            {type === "soql" ? "Audience query" : "Generated audience query"}
            <textarea
              className="code-editor"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setRecords(null);
              }}
              readOnly={type !== "soql"}
              rows={8}
              spellCheck={false}
              placeholder="Choose a source to generate its query…"
            />
          </label>
          <small className="muted">
            Select Id from Contact. Full pulls follow every result page; preview
            displays at most 25 contacts.
          </small>
          {type !== "soql" && query && (
            <Button
              variant="ghost"
              onClick={() => {
                setType("soql");
                setSourceId("");
                setNotes([
                  "This is now an independent query. Future report or list-view edits will not change it.",
                ]);
              }}
            >
              Copy to editable SOQL
              <ArrowRight size={15} />
            </Button>
          )}
          <div className="section-title second">
            <span className="step-number">2</span>
            <h2>Choose additional fields</h2>
          </div>
          <p className="muted">
            Names, email addresses and opt-outs are included automatically.
          </p>
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => setShowFields(!showFields)}
          >
            {showFields
              ? "Close field explorer"
              : "Explore related objects & custom fields"}
            <ArrowRight size={16} />
          </Button>
          {showFields && (
            <FieldBrowser selected={fields} onChange={setFields} />
          )}{" "}
          {!showFields && fields.length > 0 && (
            <div className="selected-fields">
              {fields.map((f) => (
                <Badge key={f}>{f}</Badge>
              ))}
            </div>
          )}
          <div className="builder-actions">
            <Button
              variant="secondary"
              busy={busy === "preview"}
              disabled={!query || !!busy}
              onClick={() =>
                work("preview", async () => {
                  const data = await api("salesforce/preview", "POST", {
                    query,
                    fields,
                  });
                  setRecords(data.records);
                })
              }
            >
              <Eye size={17} />
              Preview contacts
            </Button>
            <Button
              busy={busy === "save"}
              disabled={!name.trim() || !query || !!busy}
              onClick={() =>
                work("save", async () => {
                  const row = await api("audiences", "POST", {
                    name,
                    sourceType: type,
                    sourceId: sourceId || undefined,
                    query,
                    fields,
                  });
                  window.location.assign("/audiences/" + row.id);
                })
              }
            >
              <Save size={17} />
              Save audience
            </Button>
          </div>
        </section>
        <aside className="builder-aside">
          <div className="card">
            <span className="eyebrow">HOW IT WORKS</span>
            <h3>A definition you can reuse.</h3>
            <ol className="how-list">
              <li>
                <strong>Choose who belongs</strong>
                <p>Use Salesforce criteria to find matching Contact records.</p>
              </li>
              <li>
                <strong>Bring the useful details</strong>
                <p>Pick custom fields and follow parent relationships.</p>
              </li>
              <li>
                <strong>Pull a complete snapshot</strong>
                <p>
                  Save, then pull your audience. You can pause and resume page
                  by page.
                </p>
              </li>
            </ol>
          </div>
          <div className="aside-note">
            Report and list-view sources follow their saved Salesforce
            definitions on each new pull. Unsupported report rules are flagged
            for review.
          </div>
        </aside>
      </div>
      {records && (
        <section className="card preview-section">
          <div className="section-toolbar">
            <div>
              <h2>Contact preview</h2>
              <p>
                A sample of up to 25 contacts. No provider data has been
                changed.
              </p>
            </div>
            <Badge>{records.length} shown</Badge>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {["Name", "Email", "Email opt-out", ...fields].map((f) => (
                    <th key={f}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.Id}>
                    <td>
                      {[r.FirstName, r.LastName].filter(Boolean).join(" ") ||
                        r.Id}
                    </td>
                    <td>{r.Email || "—"}</td>
                    <td>{r.HasOptedOutOfEmail ? "Opted out" : "No"}</td>
                    {fields.map((f) => (
                      <td key={f}>{String(valueAt(r, f) ?? "—")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length === 0 && (
              <div className="empty">
                <p>No matching contacts.</p>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
