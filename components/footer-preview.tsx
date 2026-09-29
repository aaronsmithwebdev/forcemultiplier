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
      srcDoc={html}
      title={title}
    />
  );
}
