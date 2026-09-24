"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MailPlus, Plus, Search, Trash2 } from "lucide-react";
import { api, Button, Empty, Heading, Loading, Notice, date } from "./common";

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  subject: string;
  updatedAt: string;
};
type TemplateRow = { id: string; name: string };

export function Campaigns() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api("campaigns"), api("templates")])
      .then(([campaignRows, templateRows]) => {
        setRows(campaignRows);
        setTemplates(templateRows);
      })
      .catch((cause) => setError(cause.message));
  }, []);

  const filtered = rows?.filter((row) =>
    `${row.name} ${row.subject}`.toLowerCase().includes(search.toLowerCase()),
  );

  async function create() {
    setBusy("create");
    setError("");
    try {
      const campaign = await api("campaigns", "POST", {
        name,
        ...(templateId ? { templateId } : {}),
      });
      window.location.assign(`/campaigns/${campaign.id}/design`);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy("");
    }
  }

  async function remove(row: CampaignRow) {
    if (!window.confirm(`Delete the draft campaign “${row.name}”?`)) return;
    setBusy(row.id);
    setError("");
    try {
      await api(`campaigns/${row.id}`, "DELETE");
      setRows((current) => current?.filter((item) => item.id !== row.id) || []);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <Heading
        eyebrow="BUILD, CHECK, THEN SEND"
        title="Campaigns"
        description="Create, preview, test, and send campaigns to saved Salesforce audiences."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={17} /> New campaign
          </Button>
        }
      />
      <Notice message={error} />
      {creating && (
        <section className="card campaign-create-card">
          <div>
            <span className="step-number">1</span>
            <div>
              <h2>Name your campaign</h2>
              <p>This internal name helps you find the draft later.</p>
            </div>
          </div>
          <label>
            Campaign name
            <input
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. September supporter update"
            />
          </label>
          <label>
            Starting design <small>Optional</small>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">Blank email</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              busy={busy === "create"}
              disabled={!name.trim()}
              onClick={() => void create()}
            >
              Continue to design
            </Button>
          </div>
        </section>
      )}
      <section className="card">
        <div className="section-toolbar">
          <div>
            <h2>Campaign drafts</h2>
            <p>Build the email, review recipients, and send through Resend.</p>
          </div>
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label="Search campaigns"
              placeholder="Search campaigns…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {!rows ? (
          <Loading />
        ) : !filtered?.length ? (
          <Empty
            title={
              search ? "No matching campaigns" : "Create your first campaign"
            }
            description="Name the campaign, build the email, add sending details, then preview and test it."
          >
            {!search && (
              <Button onClick={() => setCreating(true)}>
                <MailPlus size={17} /> Create a campaign
              </Button>
            )}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Subject</th>
                  <th>Last updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link
                        className="audience-name"
                        href={`/campaigns/${row.id}/design`}
                      >
                        <span className="row-icon">
                          <MailPlus size={17} />
                        </span>
                        <div>
                          <strong>{row.name}</strong>
                          <small>{row.status}</small>
                        </div>
                      </Link>
                    </td>
                    <td>
                      {row.subject || <span className="muted">Not set</span>}
                    </td>
                    <td>{date(row.updatedAt)}</td>
                    <td className="template-row-actions">
                      <Link
                        className="button secondary"
                        href={`/campaigns/${row.id}/design`}
                      >
                        Open
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
