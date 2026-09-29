export function footerPreviewDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html{background:#f3f5f1}body{background:#fff;margin:0;padding:18px;overflow-wrap:anywhere}img{height:auto;max-width:100%}table{max-width:100%}</style></head><body>${html}</body></html>`;
}

export function FooterPreview({
  html,
  title,
  className = "footer-preview",
}: {
  html: string;
  title: string;
  className?: string;
}) {
  return (
    <iframe
      className={className}
      sandbox=""
      loading="lazy"
      srcDoc={footerPreviewDocument(html)}
      title={title}
    />
  );
}
