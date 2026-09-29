"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FilePenLine, MailCheck, Plus, Star, Trash2 } from "lucide-react";
import { api, Badge, Button, Empty, Heading, Loading, Notice } from "./common";
import { FooterPreview } from "./footer-preview";

type Footer = {
  id: string;
  name: string;
  previewHtml: string;
  isDefault: boolean;
  _count: { campaigns: number };
};

export function EmailFooters() {
  const [rows, setRows] = useState<Footer[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setRows(null);
    setError("");
    try {
      setRows(await api("footers"));
    } catch (cause) {
      setRows([]);
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setBusy("create");
    setError("");
    try {
      const footer = await api("footers", "POST", {
        name: "Untitled footer",
      });
      window.location.assign(`/footers/${footer.id}`);
    } catch (cause) {
      setError((cause as Error).message);
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

  return (
    <>
      <Heading
        eyebrow="REUSABLE EMAIL DETAILS"
        title="Email footers"
        description="Build required campaign footers with Templatical and choose the default for new campaigns."
        action={
          <Button busy={busy === "create"} onClick={() => void create()}>
            <Plus size={17} /> New footer
          </Button>
        }
      />
      <Notice message={error} />
      <Notice message={message} success />
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
        ) : error && !rows.length ? (
          <Empty
            title="Footers could not load"
            description="The footer library is temporarily unavailable. Try again after the connection is restored."
          >
            <Button onClick={() => void load()}>Try again</Button>
          </Empty>
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
                  html={row.previewHtml}
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
                  <Link
                    className="button secondary"
                    href={`/footers/${row.id}`}
                  >
                    <FilePenLine size={15} /> Edit
                  </Link>
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
