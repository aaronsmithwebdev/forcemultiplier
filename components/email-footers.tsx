"use client";
import { useEffect, useState } from "react";
import {
  Check,
  FilePenLine,
  MailCheck,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { api, Badge, Button, Empty, Heading, Loading, Notice } from "./common";
import { FooterPreview } from "./footer-preview";

type Footer = {
  id: string;
  name: string;
  html: string;
  isDefault: boolean;
  _count: { campaigns: number };
};

type Draft = {
  id?: string;
  name: string;
  html: string;
  isDefault: boolean;
};

const starterHtml =
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #dfe5dc;margin-top:24px"><tr><td style="padding:24px 20px;text-align:center;font-family:Arial,sans-serif;color:#5f6e66;font-size:12px;line-height:1.6"><p style="margin:0 0 4px"><strong style="color:#1d3029">Organisation name</strong></p><p style="margin:0 0 4px">A short organisation or legal message.</p><p style="margin:0"><a href="https://example.org" style="color:#256248">example.org</a></p></td></tr></table>';

export function EmailFooters() {
  const [rows, setRows] = useState<Footer[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api("footers")
      .then(setRows)
      .catch((cause) => setError(cause.message));
  }, []);

  function edit(row: Footer) {
    setDraft({
      id: row.id,
      name: row.name,
      html: row.html,
      isDefault: row.isDefault,
    });
    setError("");
    setMessage("");
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const saved: Footer = draft.id
        ? await api(`footers/${draft.id}`, "PATCH", draft)
        : await api("footers", "POST", draft);
      setRows((current) => {
        const next = (current || []).filter((row) => row.id !== saved.id);
        return [saved, ...next]
          .map((row) =>
            saved.isDefault && row.id !== saved.id
              ? { ...row, isDefault: false }
              : row,
          )
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      });
      setDraft(null);
      setMessage(saved.isDefault ? "Default footer saved." : "Footer saved.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function makeDefault(row: Footer) {
    setBusy(row.id);
    setError("");
    setMessage("");
    try {
      const saved: Footer = await api(`footers/${row.id}`, "PATCH", {
        isDefault: true,
      });
      setRows((current) =>
        (current || [])
          .map((item) => ({
            ...item,
            isDefault: item.id === saved.id,
          }))
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
      );
      setMessage(`“${saved.name}” is now the default for new campaigns.`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function remove(row: Footer) {
    if (!window.confirm(`Delete “${row.name}”?`)) return;
    setBusy(row.id);
    setError("");
    setMessage("");
    try {
      await api(`footers/${row.id}`, "DELETE");
      setRows((current) =>
        (current || []).filter((item) => item.id !== row.id),
      );
      setMessage("Footer deleted.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  const defaultIsLocked = Boolean(
    draft?.id && rows?.find((row) => row.id === draft.id)?.isDefault,
  );

  return (
    <>
      <Heading
        eyebrow="REUSABLE EMAIL DETAILS"
        title="Email footers"
        description="Create reusable footers, preview them at a glance, and choose a default for new campaigns."
        action={
          <Button
            onClick={() =>
              setDraft({
                name: "Untitled footer",
                html: starterHtml,
                isDefault: false,
              })
            }
          >
            <Plus size={17} /> New footer
          </Button>
        }
      />
      <Notice message={error} />
      <Notice message={message} success />
      {draft && (
        <section className="card footer-editor-card">
          <div className="section-toolbar">
            <div>
              <h2>{draft.id ? "Edit footer" : "Create footer"}</h2>
              <p>The preview updates as you edit the email-safe HTML.</p>
            </div>
            <button
              className="button ghost icon-button"
              aria-label="Close footer editor"
              onClick={() => setDraft(null)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="footer-editor-grid">
            <div>
              <label>
                Footer name
                <input
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current!,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Footer HTML
                <textarea
                  required
                  rows={12}
                  maxLength={50_000}
                  value={draft.html}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current!,
                      html: event.target.value,
                    }))
                  }
                />
                <small>
                  Use a fragment only. Scripts, forms, document tags, and merge
                  tags are blocked. Marketing unsubscribe links are added at
                  send.
                </small>
              </label>
              <label className="footer-default-choice">
                <input
                  type="checkbox"
                  checked={draft.isDefault}
                  disabled={defaultIsLocked}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current!,
                      isDefault: event.target.checked,
                    }))
                  }
                />
                {defaultIsLocked
                  ? "Default for new campaigns"
                  : "Make this the default for new campaigns"}
              </label>
            </div>
            <div className="footer-live-preview">
              <span>LIVE PREVIEW</span>
              <FooterPreview
                html={draft.html}
                title={`${draft.name || "Footer"} preview`}
              />
            </div>
          </div>
          <div className="settings-actions">
            <small>Every campaign must have one footer selected.</small>
            <div>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                busy={busy === "save"}
                disabled={!draft.name.trim() || !draft.html.trim()}
                onClick={() => void save()}
              >
                <Check size={16} /> Save footer
              </Button>
            </div>
          </div>
        </section>
      )}
      <section className="card footer-library-card">
        <div className="section-toolbar">
          <div>
            <h2>Footer library</h2>
            <p>
              The default is selected automatically when a campaign is created.
            </p>
          </div>
          <span className="row-icon">
            <MailCheck size={18} />
          </span>
        </div>
        {!rows ? (
          <Loading />
        ) : !rows.length ? (
          <Empty
            title="Create your first footer"
            description="Campaigns cannot send until a default footer exists."
          />
        ) : (
          <div className="footer-grid">
            {rows.map((row) => (
              <article className="footer-card" key={row.id}>
                <FooterPreview
                  html={row.html}
                  title={`${row.name} thumbnail`}
                  className="footer-thumbnail"
                />
                <div className="footer-card-body">
                  <div>
                    <h3>{row.name}</h3>
                    {row.isDefault && <Badge tone="green">Default</Badge>}
                  </div>
                  <small>
                    {row._count.campaigns} campaign
                    {row._count.campaigns === 1 ? "" : "s"} using this footer
                  </small>
                </div>
                <div className="footer-card-actions">
                  <Button variant="secondary" onClick={() => edit(row)}>
                    <FilePenLine size={15} /> Edit
                  </Button>
                  {!row.isDefault && (
                    <Button
                      variant="ghost"
                      busy={busy === row.id}
                      onClick={() => void makeDefault(row)}
                    >
                      <Star size={15} /> Make default
                    </Button>
                  )}
                  <button
                    className="button ghost icon-button"
                    aria-label={`Delete ${row.name}`}
                    disabled={busy === row.id || row.isDefault}
                    title={
                      row.isDefault
                        ? "Choose another default first"
                        : "Delete footer"
                    }
                    onClick={() => void remove(row)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
