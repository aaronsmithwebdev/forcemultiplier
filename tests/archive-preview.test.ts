import test from "node:test";
import assert from "node:assert/strict";
import { archivePreviewDocument } from "../lib/archive-preview";

test("archive preview applies its resource policy before email markup", () => {
  const html =
    '<!doctype html><html><head><style>p{color:red}</style></head><body><p>Hello</p><img src="https://example.com/tracker.png"></body></html>';
  const document = archivePreviewDocument(html);
  assert.match(
    document,
    /^<!doctype html><meta http-equiv="Content-Security-Policy"/,
  );
  assert.match(document, /default-src 'none'/);
  assert.match(document, /style-src 'unsafe-inline'/);
  assert.match(document, /img-src 'none'/);
  assert.ok(
    document.indexOf("Content-Security-Policy") < document.indexOf("<img"),
  );
  assert.ok(document.endsWith(html));
});
