"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, PanelBottom } from "lucide-react";
import { init, type TemplaticalEditor } from "@templatical/editor";
import type { TemplateContent } from "@templatical/types";
import "@templatical/editor/style.css";
import { api, Loading, Notice } from "./common";
import { templateMediaProvider } from "./template-editor";

export function FooterEditor({ id }: { id: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
            load: (footerId) => api(`footers/${footerId}`),
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

  return (
    <div className="template-editor-page">
      <div className="template-editor-toolbar">
        <Link href="/footers" className="back-link">
          <ArrowLeft size={15} /> Footer library
        </Link>
        <span>
          <PanelBottom size={15} /> Preview shows this footer on its own;
          campaigns add it after the editable email body.
        </span>
      </div>
      <Notice message={error} />
      <div className="template-editor-frame">
        {loading && <Loading />}
        <div ref={container} className="templatical-container" />
      </div>
    </div>
  );
}
