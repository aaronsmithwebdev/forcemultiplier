"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, List, ArrowUpRight, X, Search, RefreshCw } from "lucide-react";
import { api, Badge, Button, Empty, Heading, Loading, Notice } from "./common";
export function ContactLists() {
  const [rows, setRows] = useState<any[]>([]),
    [cursor, setCursor] = useState(""),
    [connected, setConnected] = useState<boolean | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [members, setMembers] = useState<any[]>([]),
    [memberCursor, setMemberCursor] = useState(""),
    [fields, setFields] = useState<any[]>([]),
    [fieldCursor, setFieldCursor] = useState(""),
    [showFields, setShowFields] = useState(false);
  async function load(more = false) {
    setLoading(true);
    setError("");
    try {
      const data = await api(
        "constant-contact/lists" +
          (more && cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      setRows((previous) =>
        more ? [...previous, ...data.lists] : data.lists || [],
      );
      setCursor(data._links?.next?.href || "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    api("connections")
      .then((c) => {
        const ready = c.some(
          (r: any) => r.provider === "constant-contact" && r.connected,
        );
        setConnected(ready);
        if (ready) void load();
      })
      .catch((e) => setError(e.message));
  }, []);
  async function viewMembers(list: any, more = false) {
    setSelected(list);
    if (!more) setMembers([]);
    setBusy(true);
    setError("");
    try {
      const data = await api(
        `constant-contact/lists/${list.list_id}/members${more && memberCursor ? "?cursor=" + encodeURIComponent(memberCursor) : ""}`,
      );
      setMembers((previous) =>
        more ? [...previous, ...data.contacts] : data.contacts || [],
      );
      setMemberCursor(data._links?.next?.href || "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function viewFields(more = false) {
    setShowFields(true);
    setBusy(true);
    setError("");
    try {
      const d = await api(
        "constant-contact/fields" +
          (more && fieldCursor
            ? "?cursor=" + encodeURIComponent(fieldCursor)
            : ""),
      );
      setFields((previous) =>
        more
          ? [...previous, ...(d.custom_fields || [])]
          : d.custom_fields || [],
      );
      setFieldCursor(d._links?.next?.href || "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="YOUR DESTINATION"
        title="Lists, all in one place."
        description="Browse Constant Contact lists, inspect their members, or create a new list."
        action={
          <Button disabled={!connected} onClick={() => setCreating(true)}>
            <Plus size={17} />
            Create list
          </Button>
        }
      />
      <Notice message={error} />
      <Notice message={success} success />
      {connected === null ? (
        <Loading />
      ) : !connected ? (
        <section className="card">
          <Empty
            title="Connect Constant Contact"
            description="Authorize your account to bring your existing lists and custom fields into this workspace."
          >
            <Link className="button" href="/connections">
              Go to connections
              <ArrowUpRight size={16} />
            </Link>
          </Empty>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="section-toolbar">
              <div>
                <h2>Constant Contact lists</h2>
                <p>
                  {rows.length} lists loaded{cursor ? " · More available" : ""}
                </p>
              </div>
              <div className="toolbar-actions">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search loaded lists"
                    placeholder="Search loaded lists…"
                  />
                </div>
                <Button variant="ghost" busy={loading} onClick={() => load()}>
                  <RefreshCw size={15} />
                  Refresh
                </Button>
              </div>
            </div>
            {loading && !rows.length ? (
              <Loading />
            ) : rows.length === 0 ? (
              <Empty
                title="No lists yet"
                description="Create your first destination list when you’re ready."
              />
            ) : (
              <div className="list-grid">
                {rows
                  .filter((row) =>
                    row.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((row) => (
                    <button
                      className="list-card"
                      key={row.list_id}
                      disabled={busy}
                      onClick={() => viewMembers(row)}
                    >
                      <div>
                        <span className="row-icon">
                          <List size={18} />
                        </span>
                        <ArrowUpRight size={17} />
                      </div>
                      <h3>{row.name}</h3>
                      <p>{row.description || "Constant Contact list"}</p>
                      <small>
                        {typeof row.membership_count === "number"
                          ? row.membership_count.toLocaleString() + " members"
                          : "View members"}
                      </small>
                    </button>
                  ))}
              </div>
            )}
            {cursor && (
              <div className="pagination">
                <Button
                  variant="secondary"
                  busy={loading}
                  onClick={() => load(true)}
                >
                  Load more lists
                </Button>
              </div>
            )}
          </section>
          <div className="info-strip">
            <div>
              <strong>Custom fields</strong>
              <p>
                Review your account’s available fields before planning your
                mappings.
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => viewFields()}
            >
              Browse custom fields
            </Button>
          </div>
        </>
      )}
      {creating && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-list-title"
            className="modal"
          >
            <div className="modal-header">
              <h2 id="create-list-title">Create a list</h2>
              <button
                className="icon-button"
                aria-label="Close"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              This creates an empty list in your connected Constant Contact
              account.
            </p>
            <Notice message={error} />
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const data = Object.fromEntries(new FormData(e.currentTarget));
                try {
                  await api("constant-contact/lists", "POST", data);
                  setCreating(false);
                  setSuccess("Your new list is ready.");
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                List name
                <input
                  name="name"
                  required
                  maxLength={255}
                  autoFocus
                  placeholder="e.g. Active members"
                />
              </label>
              <label>
                Description
                <textarea name="description" maxLength={500} rows={3} />
              </label>
              <Button type="submit" busy={busy}>
                Create in Constant Contact
                <Plus size={16} />
              </Button>
            </form>
          </section>
        </div>
      )}
      {(selected || showFields) && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-detail-title"
            className="modal wide"
          >
            <div className="modal-header">
              <div>
                <h2 id="list-detail-title">
                  {selected?.name || "Account custom fields"}
                </h2>
                <p>
                  {selected
                    ? "Existing contacts and their email permission state."
                    : "Fields available in your connected Constant Contact account."}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setShowFields(false);
                }}
              >
                <X size={20} />
              </button>
            </div>
            <Notice message={error} />
            {busy && <Loading />}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {(selected
                      ? ["Name", "Email", "Permission"]
                      : ["Field", "Type", "Field ID"]
                    ).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected
                    ? members.map((m) => (
                        <tr key={m.contact_id}>
                          <td>
                            {[m.first_name, m.last_name]
                              .filter(Boolean)
                              .join(" ") || "—"}
                          </td>
                          <td>{m.email_address?.address || "—"}</td>
                          <td>
                            <Badge>
                              {m.email_address?.permission_to_send || "Unknown"}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    : fields.map((f) => (
                        <tr key={f.custom_field_id}>
                          <td>{f.label || f.name}</td>
                          <td>{f.type || "—"}</td>
                          <td>
                            <code>{f.custom_field_id}</code>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {!busy && (selected ? members : fields).length === 0 && (
              <p className="empty">
                No {selected ? "members" : "custom fields"} found.
              </p>
            )}
            {(selected ? memberCursor : fieldCursor) && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  selected ? viewMembers(selected, true) : viewFields(true)
                }
              >
                Load more
              </Button>
            )}
          </section>
        </div>
      )}
    </>
  );
}
