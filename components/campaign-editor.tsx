"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, Send } from "lucide-react";
import { init, type TemplaticalEditor } from "@templatical/editor";
import type { MergeTag, TemplateContent } from "@templatical/types";
import "@templatical/editor/style.css";
import { api, Button, Loading, Notice } from "./common";
import { CampaignSteps } from "./campaign-steps";
import { templateMediaProvider } from "./template-editor";
import { CampaignRecipients } from "./campaign-recipients";

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

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let editor: TemplaticalEditor | null = null;
    async function mount() {
      try {
        const tags: MergeTag[] = await api("templates/merge-tags");
        if (cancelled || !container.current) return;
        const instance = await init({
          container: container.current,
          mergeTags: { syntax: "liquid", tags },
          media: templateMediaProvider(),
          templates: {
            load: (campaignId) => api(`campaigns/${campaignId}`),
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
      editor?.unmount();
    };
  }, [email, id]);

  async function goToSettings() {
    if (!editorRef.current) return;
    setSaving(true);
    setError("");
    try {
      await editorRef.current.save();
      window.location.assign(`/campaigns/${id}/settings`);
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

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
              to {email} through Resend.
            </p>
          </div>
        </div>
      )}
      <Notice message={error} />
      <div className="template-editor-frame">
        {loading && <Loading />}
        <div ref={container} className="templatical-container" />
      </div>
      <div className="campaign-next-actions">
        <Button
          busy={saving}
          variant={preview ? "secondary" : ""}
          onClick={() => void goToSettings()}
        >
          {preview ? (
            <>
              <ArrowLeft size={16} /> Email settings
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
      {preview && <CampaignRecipients id={id} />}
    </div>
  );
}
