import test from "node:test";
import assert from "node:assert/strict";
import { convertHtmlTemplate } from "@templatical/import-html";
import { prepareArchiveForConversion } from "../lib/archive-conversion";

test("an archived email becomes editable without unbacked images or active content", () => {
  const source = `<html><head><style>@import "https://other.example/style.css"; .hero{background:url(https://other.example/hero.png)}</style></head><body><table><tr><td><h1>Old newsletter</h1><p><a href="https://example.org/story">Read more</a></p><img src="https://files.constantcontact.com/account/kept.png"><img src="https://other.example/missing.png"><script>alert(1)</script><iframe src="https://other.example"></iframe><a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a></td></tr></table></body></html>`;
  const prepared = prepareArchiveForConversion(
    source,
    new Map([
      [
        "https://files.constantcontact.com/account/kept.png",
        "https://storage.example/kept.png",
      ],
    ]),
  );
  assert.equal(prepared.removedImages, 1);
  assert.doesNotMatch(
    prepared.html,
    /<script|<iframe|onclick|javascript:|other\.example/,
  );
  assert.match(prepared.html, /https:\/\/storage\.example\/kept\.png/);
  const { content, report } = convertHtmlTemplate(prepared.html);
  assert.ok(content.blocks.length > 0);
  assert.ok(report.summary.converted > 0);
  assert.match(JSON.stringify(content), /Old newsletter/);
});
