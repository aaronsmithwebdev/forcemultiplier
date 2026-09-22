export function archivePreviewPolicy() {
  const project = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const imageSource = project
    ? new URL("/storage/v1/object/public/email-archive-images/", project).href
    : "'none'";
  return `default-src 'none'; style-src 'unsafe-inline'; img-src ${imageSource}; font-src 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; navigate-to 'none'`;
}

export function archivePreviewDocument(html: string) {
  // Put the policy before untrusted email markup so it applies as the browser parses it.
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${archivePreviewPolicy()}">${html}`;
}
