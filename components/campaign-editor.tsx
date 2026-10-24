"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, Send } from "lucide-react";
import { init, type TemplaticalEditor } from "@templatical/editor";
import type { MergeTag, TemplateContent } from "@templatical/types";
import type { ImportReport } from "@templatical/import-html";
import "@templatical/editor/style.css";
import { api, Button, Loading, Notice } from "./common";
import { CampaignSteps } from "./campaign-steps";
import { templateMediaProvider } from "./template-editor";
import { CampaignRecipients } from "./campaign-recipients";
import { footerLayout } from "@/lib/email-layout";
import { showTemplaticalIssueTooltips } from "./templatical-issue-tooltips";

type Footer = {
  id: string;
  name: string;
  isDefault: boolean;
};

export function CampaignEditor({
  id,
  email,
  preview = false,
}: {
  id: string;
  email: string;
  preview?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TemplaticalEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [archive, setArchive] = useState<{
    name: string;
    report: ImportReport;
  } | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [footers, setFooters] = useState<Footer[]>([]);
  const [footerId, setFooterId] = useState("");
  const [changingFooter, setChangingFooter] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let editor: TemplaticalEditor | null = null;
    let stopIssueTooltips = () => {};
    async function mount() {
      try {
        const [tags, campaign, footerRows]: [
          MergeTag[],
          {
            id: string;
            name: string;
            content: TemplateContent;
            footerId: string;
            footer: { content: TemplateContent };
            sourceArchiveId: string | null;
            sourceArchive: { campaignName: string } | null;
            conversionReport: ImportReport | null;
          },
          Footer[],
        ] = await Promise.all([
          api("templates/merge-tags"),
          api(`campaigns/${id}`),
          preview ? Promise.resolve([]) : api("footers"),
        ]);
        if (cancelled || !container.current) return;
        setFooters(footerRows);
        setFooterId(campaign.footerId);
        if (campaign.sourceArchiveId && campaign.conversionReport)
          setArchive({
            name: campaign.sourceArchive?.campaignName || campaign.name,
            report: campaign.conversionReport,
          });
        const instance = await init({
          container: container.current,
          layout: footerLayout(campaign.content, campaign.footer.content),
          mergeTags: { syntax: "liquid", tags },
          media: templateMediaProvider(),
          templates: {
            load: async (campaignId) => {
              return campaignId === id
                ? campaign
                : api(`campaigns/${campaignId}`);
            },
            create: false,
            save: (
              campaignId: string,
              patch: Partial<{ name: string; content: TemplateContent }>,
            ) => api(`campaigns/${campaignId}`, "PATCH", patch),
            autoSave: false,
          },
          lint: {},
          htmlBlockPreview: true,
          testEmail: {
            allowedRecipients: [email],
            defaultRecipient: email,
            send: ({ recipient, content }) =>
              api(`campaigns/${id}/test`, "POST", { recipient, content }),
          },
          onError: (cause) => setError(cause.message),
        });
        if (cancelled) {
          instance.unmount();
          return;
        }
        editor = instance;
        editorRef.current = instance;
        stopIssueTooltips = showTemplaticalIssueTooltips(
          container.current!,
          instance,
        );
        await editor.load(id);
        if (!cancelled) setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setError((cause as Error).message);
          setLoading(false);
        }
      }
    }
    void mount();
    return () => {
      cancelled = true;
      editorRef.current = null;
      stopIssueTooltips();
      editor?.unmount();
    };
  }, [email, id, preview]);

  async function chooseFooter(nextId: string) {
    if (!editorRef.current || nextId === footerId) return;
    const previousId = footerId;
    setFooterId(nextId);
    setSaving(true);
    setChangingFooter(true);
    setError("");
    try {
      await editorRef.current.save();
      await api(`campaigns/${id}`, "PATCH", { footerId: nextId });
      window.location.reload();
    } catch (cause) {
      setFooterId(previousId);
      setError((cause as Error).message);
      setSaving(false);
      setChangingFooter(false);
    }
  }

  async function saveAndGoTo(destination = "settings") {
    if (!editorRef.current) return;
    setSaving(true);
    setError("");
    try {
      await editorRef.current.save();
      window.location.assign(`/campaigns/${id}/${destination}`);
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  async function saveAsTemplate() {
    if (!editorRef.current) return;
    setSavingTemplate(true);
    setError("");
    try {
      await editorRef.current.save();
      const campaign = await api(`campaigns/${id}`);
      const template = await api("templates", "POST", {
        name: campaign.name,
        content: campaign.content,
      });
      window.location.assign(`/templates/${template.id}`);
    } catch (cause) {
      setError((cause as Error).message);
      setSavingTemplate(false);
    }
  }

  const conversionWarnings = archive
    ? [
        ...archive.report.warnings,
        ...archive.report.entries
          .filter((entry) => entry.note)
          .map((entry) => `${entry.sourceTag}: ${entry.note}`),
      ]
    : [];

  return (
    <div className="template-editor-page campaign-editor-page">
      <div className="template-editor-toolbar">
        <Link href="/campaigns" className="back-link">
          <ArrowLeft size={15} /> Campaigns
        </Link>
        <span>
          {preview ? (
            <>
              <Eye size={15} /> Use Preview for desktop/mobile, then Test
            </>
          ) : (
            <>Save your design before continuing</>
          )}
        </span>
      </div>
      <CampaignSteps id={id} current={preview ? "preview" : "design"} />
      {preview && (
        <div className="preview-callout">
          <Eye size={20} />
          <div>
            <strong>Check both screen sizes</strong>
            <p>
              Select <b>Preview</b> in the editor header and switch between
              Desktop and Mobile. Select <b>Test</b> to send the current design
              to {email} through Resend. To check real merge values, choose your
              send audiences below and use Preview as recipients.
            </p>
          </div>
        </div>
      )}
      <Notice message={error} />
      {archive && (
        <section className="card archive-conversion-report">
          <h2>Converted from {archive.name}</h2>
          <p>
            {archive.report.summary.converted} converted ·{" "}
            {archive.report.summary.approximated} approximated ·{" "}
            {archive.report.summary.htmlFallback} HTML fallback ·{" "}
            {archive.report.summary.skipped} skipped. Preview desktop and
            mobile, then review links, images, merge tags, footer, and text
            before sending.
          </p>
          {conversionWarnings.length > 0 && (
            <details>
              <summary>Conversion warnings</summary>
              <ul>
                {conversionWarnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      <div className="template-editor-frame">
        {loading && <Loading />}
        <div ref={container} className="templatical-container" />
      </div>
      <div
        className={`campaign-next-actions ${preview ? "" : "campaign-design-actions"}`}
      >
        {!preview && !loading && (
          <div className="campaign-footer-control">
            <label>
              Email footer
              <select
                value={footerId}
                disabled={saving}
                onChange={(event) => void chooseFooter(event.target.value)}
              >
                {footers.map((footer) => (
                  <option key={footer.id} value={footer.id}>
                    {footer.name}
                    {footer.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <Link href="/footers" target="_blank" rel="noopener noreferrer">
              Manage footers ↗
            </Link>
            {changingFooter && <span role="status">Saving footer…</span>}
            <small>
              The selected footer follows the body in Preview and sends.
              {archive &&
                " Remove the imported footer blocks in the body to avoid a duplicate."}
            </small>
          </div>
        )}
        {!preview && (
          <Button
            variant="secondary"
            busy={saving}
            disabled={loading}
            onClick={() => void saveAndGoTo("preview")}
          >
            <Eye size={16} /> Preview as recipients
          </Button>
        )}
        {archive && (
          <Button
            variant="secondary"
            busy={savingTemplate}
            disabled={saving}
            onClick={() => void saveAsTemplate()}
          >
            Save as template
          </Button>
        )}
        <Button
          busy={saving}
          variant={preview ? "secondary" : ""}
          onClick={() => void saveAndGoTo()}
        >
          {preview ? (
            <>
              <ArrowLeft size={16} /> Send settings
            </>
          ) : (
            <>
              Save and continue <ArrowRight size={16} />
            </>
          )}
        </Button>
        {preview && (
          <span>
            <Send size={15} /> Test sends are restricted to your signed-in
            address.
          </span>
        )}
      </div>
      {preview && (
        <CampaignRecipients
          id={id}
          email={email}
          getContent={() => {
            if (!editorRef.current)
              throw new Error("Wait for the email editor to finish loading.");
            return editorRef.current.getContent();
          }}
          beforeSend={async () => {
            if (!editorRef.current)
              throw new Error("Wait for the email editor to finish loading.");
            await editorRef.current.save();
          }}
        />
      )}
    </div>
  );
}
