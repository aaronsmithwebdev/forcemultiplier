"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, PanelBottom, Star } from "lucide-react";
import { init, type TemplaticalEditor } from "@templatical/editor";
import type { TemplateContent } from "@templatical/types";
import "@templatical/editor/style.css";
import { api, Badge, Button, Loading, Notice } from "./common";
import { templateMediaProvider } from "./template-editor";

export function FooterEditor({ id }: { id: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let editor: TemplaticalEditor | null = null;

    async function mount() {
      try {
        if (cancelled || !container.current) return;
        const instance = await init({
          container: container.current,
          media: templateMediaProvider(),
          lint: {},
          htmlBlockPreview: true,
          templateSettings: { fields: false },
          templates: {
            load: async (footerId) => {
              const footer = await api(`footers/${footerId}`);
              if (!cancelled) setIsDefault(footer.isDefault);
              return footer;
            },
            create: false,
            save: (
              footerId: string,
              patch: Partial<{ name: string; content: TemplateContent }>,
            ) => api(`footers/${footerId}`, "PATCH", patch),
            autoSave: false,
          },
          onError: (cause) => setError(cause.message),
        });
        if (cancelled) {
          instance.unmount();
          return;
        }
        editor = instance;
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
      editor?.unmount();
    };
  }, [id]);

  async function makeDefault() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`footers/${id}`, "PATCH", { isDefault: true });
      setIsDefault(true);
      setMessage("This is now the default footer for new campaigns.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="template-editor-page">
      <div className="template-editor-toolbar">
        <Link href="/footers" className="back-link">
          <ArrowLeft size={15} /> Footer library
        </Link>
        <div className="footer-editor-actions">
          <span>
            <PanelBottom size={15} /> Preview shows this footer on its own;
            campaigns add it after the editable email body.
          </span>
          {isDefault === true ? (
            <Badge tone="green">Default for new campaigns</Badge>
          ) : isDefault === false ? (
            <Button variant="secondary" busy={busy} onClick={makeDefault}>
              <Star size={15} /> Make default
            </Button>
          ) : null}
        </div>
      </div>
      <Notice message={error} />
      <Notice message={message} success />
      <div className="template-editor-frame">
        {loading && <Loading />}
        <div ref={container} className="templatical-container" />
      </div>
    </div>
  );
}
