"use client";
import { useEffect, useRef, useState } from "react";
import type { TemplateContent } from "@templatical/types";
import type { AudienceSelection } from "@/lib/campaign-sends";
import { api, Button, Notice } from "./common";
import { FooterPreview } from "./footer-preview";

type Sample = {
  email: string;
  name: string | null;
  html?: string;
  missingFields?: string[];
};

export function CampaignRecipientPreview({
  id,
  selection,
  getContent,
  email,
  disabled,
}: {
  id: string;
  selection: AudienceSelection;
  getContent: () => TemplateContent;
  email: string;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Sample[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Sample[]>([]);
  const [previewContent, setPreviewContent] = useState<TemplateContent | null>(
    null,
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const version = useRef(0);
  const selectionKey = JSON.stringify(selection);
  useEffect(() => {
    version.current++;
    setContacts(null);
    setSelected([]);
    setPreviews([]);
    setPreviewContent(null);
    setError("");
    setMessage("");
    setBusy("");
  }, [selectionKey]);

  async function work(key: string, fn: (current: number) => Promise<void>) {
    const current = ++version.current;
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await fn(current);
    } catch (cause) {
      if (version.current === current) setError((cause as Error).message);
    } finally {
      if (version.current === current) setBusy("");
    }
  }
  async function loadContacts() {
    await work("load", async (current) => {
      const rows: Sample[] = await api(
        `campaigns/${id}/personalisation-preview`,
        "POST",
        { ...selection, search },
      );
      if (version.current !== current) return;
      setContacts(rows);
      setSelected(rows.slice(0, 2).map((row) => row.email));
      setPreviews([]);
    });
  }
  async function preview() {
    await work("preview", async (current) => {
      const content = getContent();
      const rows: Sample[] = await api(
        `campaigns/${id}/personalisation-preview`,
        "POST",
        { ...selection, emails: selected, content },
      );
      if (version.current !== current) return;
      setPreviewContent(content);
      setPreviews(rows);
    });
  }
  async function sendTest(sample: Sample) {
    await work(sample.email, async (current) => {
      await api(`campaigns/${id}/test`, "POST", {
        recipient: email,
        content: previewContent,
        sample: { ...selection, email: sample.email },
      });
      if (version.current === current)
        setMessage(
          `Test using ${sample.name || sample.email}'s data sent to ${email}.`,
        );
    });
  }
  return (
    <div className="recipient-personalisation">
      <h3>Preview as recipients</h3>
      <p>
        Choose up to two people from your send audiences to see their names,
        event details and fundraising links filled in. Audience exclusions and
        opt-outs apply.
      </p>
      <Notice message={error} />
      <Notice message={message} success />
      <label>
        Find a preview recipient
        <div className="inline-input">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email (optional)"
            disabled={disabled || !!busy}
          />
          <Button
            variant="secondary"
            busy={busy === "load"}
            disabled={disabled || !!busy || !selection.audienceIds.length}
            onClick={loadContacts}
          >
            Load recipients
          </Button>
        </div>
      </label>
      {contacts && (
        <>
          <div className="recipient-sample-options">
            {contacts.map((contact) => (
              <label className="consent-check" key={contact.email}>
                <input
                  type="checkbox"
                  checked={selected.includes(contact.email)}
                  disabled={
                    disabled ||
                    !!busy ||
                    (!selected.includes(contact.email) && selected.length === 2)
                  }
                  onChange={(e) => {
                    setSelected((values) =>
                      e.target.checked
                        ? [...values, contact.email]
                        : values.filter((value) => value !== contact.email),
                    );
                    setPreviews([]);
                  }}
                />
                <span>
                  {contact.name || "Unnamed contact"} · {contact.email}
                </span>
              </label>
            ))}
          </div>
          {!contacts.length && (
            <p>
              No eligible recipients match. Check the audiences, exclusions or
              search.
            </p>
          )}
          <Button
            variant="secondary"
            busy={busy === "preview"}
            disabled={disabled || !!busy || !selected.length}
            onClick={preview}
          >
            Preview current design ({selected.length})
          </Button>
        </>
      )}
      {!!previews.length && (
        <>
          <p className="muted">
            These previews reflect the design when generated. Refresh after
            editing. Unsubscribe links are disabled in previews and tests.
          </p>
          <div className="recipient-preview-grid">
            {previews.map((sample) => (
              <div className="footer-card" key={sample.email}>
                <div className="footer-card-body">
                  <strong>{sample.name || sample.email}</strong>
                  <p>{sample.email}</p>
                  {!!sample.missingFields?.length && (
                    <Notice
                      message={`Missing values: ${sample.missingFields.join(", ")}. These fields appear blank.`}
                    />
                  )}
                  <Button
                    variant="secondary"
                    busy={busy === sample.email}
                    disabled={disabled || !!busy}
                    onClick={() => sendTest(sample)}
                  >
                    Send this version to {email}
                  </Button>
                </div>
                <FooterPreview
                  html={sample.html!}
                  title={`Email preview for ${sample.email}`}
                  className="recipient-email-preview"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
