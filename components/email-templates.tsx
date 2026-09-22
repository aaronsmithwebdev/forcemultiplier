"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FilePenLine, Plus, Search, Trash2 } from "lucide-react";
import { api, Button, Empty, Heading, Loading, Notice, date } from "./common";

type TemplateRow = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  _count: { revisions: number };
};

export function EmailTemplates() {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("templates")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  const filtered = rows?.filter((row) =>
    row.name.toLowerCase().includes(search.toLowerCase()),
  );

  async function create() {
    setBusy("create");
    setError("");
    try {
      const template = await api("templates", "POST", {
        name: "Untitled email",
      });
      window.location.assign(`/templates/${template.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }

  async function remove(row: TemplateRow) {
    if (!window.confirm(`Delete “${row.name}” and its version history?`))
      return;
    setBusy(row.id);
    setError("");
    try {
      await api(`templates/${row.id}`, "DELETE");
      setRows((current) => current?.filter((item) => item.id !== row.id) || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <Heading
        eyebrow="DESIGN ONCE, PERSONALISE EVERY SEND"
        title="Email templates"
        description="Build responsive emails with reusable content and Salesforce merge tags."
        action={
          <Button busy={busy === "create"} onClick={() => void create()}>
            <Plus size={17} /> New template
          </Button>
        }
      />
      <Notice message={error} />
      <section className="card">
        <div className="section-toolbar">
          <div>
            <h2>Template library</h2>
            <p>Drafts stay editable and every saved design keeps a version.</p>
          </div>
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label="Search templates"
              placeholder="Search templates…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {!rows ? (
          <Loading />
        ) : !filtered?.length ? (
          <Empty
            title={search ? "No matching templates" : "Create your first email"}
            description="Start with a blank canvas, then add text, images, buttons, columns, HTML, and personalised fields."
          >
            {!search && (
              <Button busy={busy === "create"} onClick={() => void create()}>
                <Plus size={17} /> Create a template
              </Button>
            )}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Last updated</th>
                  <th>Saved versions</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link
                        className="audience-name"
                        href={`/templates/${row.id}`}
                      >
                        <span className="row-icon">
                          <FilePenLine size={17} />
                        </span>
                        <div>
                          <strong>{row.name}</strong>
                          <small>Created {date(row.createdAt)}</small>
                        </div>
                      </Link>
                    </td>
                    <td>{date(row.updatedAt)}</td>
                    <td>{row._count.revisions.toLocaleString()}</td>
                    <td className="template-row-actions">
                      <Link
                        className="button secondary"
                        href={`/templates/${row.id}`}
                      >
                        Edit
                      </Link>
                      <button
                        className="button ghost icon-button"
                        aria-label={`Delete ${row.name}`}
                        disabled={busy === row.id}
                        onClick={() => void remove(row)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
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
