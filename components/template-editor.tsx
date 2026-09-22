"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Braces } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { init, type TemplaticalEditor } from "@templatical/editor";
import type {
  MediaAsset,
  MediaProvider,
  MergeTag,
  TemplateContent,
} from "@templatical/types";
import "@templatical/editor/style.css";
import { api, Loading, Notice } from "./common";

const assetBucket = "email-template-assets";
const assetTypes: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function mediaProvider(): MediaProvider {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase Storage is not configured.");
  const storage = createBrowserClient(url, key).storage.from(assetBucket);
  const asset = (file: {
    id?: string | null;
    name: string;
    created_at?: string | null;
    updated_at?: string | null;
    metadata?: Record<string, unknown> | null;
  }): MediaAsset => ({
    id: file.id || file.name,
    url: storage.getPublicUrl(file.name).data.publicUrl,
    filename: file.name,
    mimeType:
      typeof file.metadata?.mimetype === "string"
        ? file.metadata.mimetype
        : undefined,
    size:
      typeof file.metadata?.size === "number" ? file.metadata.size : undefined,
    createdAt: file.created_at || undefined,
    updatedAt: file.updated_at || undefined,
    canUpdate: false,
    canDelete: false,
  });
  return {
    async list({ search } = {}) {
      const { data, error } = await storage.list("", {
        limit: 100,
        search,
        sortBy: { column: "created_at", order: "desc" },
      });
      if (error) throw new Error(error.message);
      return { items: data.map(asset) };
    },
    async create({ file }) {
      const extension = assetTypes[file.type];
      if (!extension)
        throw new Error("Choose a PNG, JPEG, GIF, or WebP image.");
      const name = `${crypto.randomUUID()}.${extension}`;
      const { data, error } = await storage.upload(name, file, {
        cacheControl: "31536000",
        contentType: file.type,
      });
      if (error) throw new Error(error.message);
      return asset({
        id: data.id,
        name: data.path,
        created_at: new Date().toISOString(),
        metadata: { mimetype: file.type, size: file.size },
      });
    },
    update: false,
    delete: false,
    folders: false,
    replace: false,
    importFromUrl: false,
    checkUsage: false,
    frequentlyUsed: false,
    storage: false,
    maxFileSize: 10 * 1024 * 1024,
    mimeTypes: { images: Object.keys(assetTypes) },
  };
}

export function TemplateEditor({ id }: { id: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let editor: TemplaticalEditor | null = null;

    async function mount() {
      try {
        const tags: MergeTag[] = await api("templates/merge-tags");
        if (cancelled || !container.current) return;
        const templates = {
          load: (templateId: string) => api(`templates/${templateId}`),
          create: (input: { name?: string; content: TemplateContent }) =>
            api("templates", "POST", input),
          save: (
            templateId: string,
            patch: Partial<{ name: string; content: TemplateContent }>,
          ) => api(`templates/${templateId}`, "PATCH", patch),
          autoSave: false,
        };
        const instance = await init({
          container: container.current,
          mergeTags: { syntax: "liquid", tags },
          media: mediaProvider(),
          templates,
          versionHistory: {
            list: (templateId) => api(`templates/${templateId}/versions`),
            get: async (templateId, versionId) =>
              (await api(`templates/${templateId}/versions/${versionId}`))
                .content,
            create: false,
            restore: (templateId, versionId) =>
              api(
                `templates/${templateId}/versions/${versionId}/restore`,
                "POST",
              ),
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
        <Link href="/templates" className="back-link">
          <ArrowLeft size={15} /> Template library
        </Link>
        <span>
          <Braces size={15} /> Type <code>{"{{"}</code> to insert a personalised
          field
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
