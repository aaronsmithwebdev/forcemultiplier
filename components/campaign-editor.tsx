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
import { FooterPicker, type FooterOption } from "./footer-picker";
import { FooterPreview } from "./footer-preview";
import { footerLayout } from "@/lib/email-layout";
import { showTemplaticalIssueTooltips } from "./templatical-issue-tooltips";

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
  const [footers, setFooters] = useState<FooterOption[]>([]);
  const [footerId, setFooterId] = useState<string | null>(null);
  const [changingFooter, setChangingFooter] = useState(false);

  const [footerRevision, setFooterRevision] = useState(0);
  const [designContent, setDesignContent] = useState<TemplateContent | null>(
    null,
  );
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (!container.current) return;
    setLoading(true);
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
            footerId: string | null;
            footer: { content: TemplateContent } | null;
            sourceArchiveId: string | null;
            sourceArchive: { campaignName: string } | null;
            conversionReport: ImportReport | null;
          },
          FooterOption[],
        ] = await Promise.all([
          api("templates/merge-tags"),
          api(`campaigns/${id}`),
          preview ? Promise.resolve([]) : api("footers"),
        ]);
        if (cancelled || !container.current) return;
        setFooters(footerRows);
        setFooterId(campaign.footerId);
        setDesignContent(campaign.content);
        if (campaign.sourceArchiveId && campaign.conversionReport)
          setArchive({
            name: campaign.sourceArchive?.campaignName || campaign.name,
            report: campaign.conversionReport,
          });
        const instance = await init({
          container: container.current,
          layout: footerLayout(
            campaign.content,
            campaign.footer?.content ?? null,
          ),
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
          onChange: setDesignContent,
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
  }, [email, id, preview, footerRevision]);

  useEffect(() => {
    if (preview || !designContent || loading || changingFooter) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewError("");
      void api(`campaigns/${id}/design-preview`, "POST", {
        content: designContent,
      })
        .then(({ html }) => {
          if (!cancelled) setPreviewHtml(html);
        })
        .catch((cause) => {
          if (!cancelled) setPreviewError(cause.message);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, preview, designContent, footerId, loading, changingFooter]);

  async function chooseFooter(nextId: string | null) {
    if (!editorRef.current || saving || nextId === footerId) return;
    const previousId = footerId;
    setFooterId(nextId);
    setSaving(true);
    setChangingFooter(true);
    setError("");
    try {
      await editorRef.current.save();
      await api(`campaigns/${id}`, "PATCH", { footerId: nextId });
      setPreviewHtml("");
      setFooterRevision((revision) => revision + 1);
    } catch (cause) {
      setFooterId(previousId);
      setError((cause as Error).message);
    } finally {
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
      {!preview && designContent && (
        <section className="card campaign-footer-picker">
          <div className="section-toolbar">
            <div>
              <h2>Email footer</h2>
              <p>
                Choose a finishing touch. See it connected to your design below.
              </p>
            </div>
            <Link href="/footers" target="_blank" rel="noopener noreferrer">
              Manage footers ↗
            </Link>
          </div>
          <fieldset className="campaign-footer-field">
            <legend>Choose an email footer</legend>
            <FooterPicker
              footers={footers}
              value={footerId}
              disabled={saving || loading}
              onChange={(nextId) => void chooseFooter(nextId)}
            />
            {changingFooter && <p role="status">Saving footer…</p>}
            {archive && (
              <p>
                Remove imported footer blocks from the design to avoid a
                duplicate.
              </p>
            )}
          </fieldset>
          <div className="campaign-connected-preview">
            <div className="campaign-preview-heading">
              <strong>Email preview</strong>
              <span>
                {footerId
                  ? footers.find((footer) => footer.id === footerId)?.name
                  : "No footer"}
              </span>
            </div>
            <Notice message={previewError} />
            {previewHtml ? (
              <FooterPreview
                html={previewHtml}
                title="Email design with selected footer"
                className="campaign-email-preview"
              />
            ) : (
              <p role="status">Rendering your email…</p>
            )}
          </div>
        </section>
      )}
      <div
        className={`campaign-next-actions ${preview ? "" : "campaign-design-actions"}`}
      >
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
