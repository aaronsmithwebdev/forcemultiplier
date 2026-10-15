import test from "node:test";
import assert from "node:assert/strict";
import { convertHtmlTemplate } from "@templatical/import-html";
import {
  combineImportedParagraphs,
  prepareArchiveForConversion,
} from "../lib/archive-conversion";

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

test("adjacent imported paragraphs become one editable block without crossing buttons or columns", () => {
  const { content } = convertHtmlTemplate(
    '<table><tr><td><p>First</p><p>Second <strong>bold</strong></p><a href="https://example.org" style="display:inline-block;padding:10px">Button</a><p>Third</p></td><td><p>Other column</p></td></tr></table>',
  );
  const section = content.blocks[0];
  if (section.type !== "section") throw new Error("Expected a section");
  const [first, second] = section.children[0];
  if (first.type !== "paragraph" || second.type !== "paragraph")
    throw new Error("Expected paragraphs");
  const gap = first.styles.padding.bottom + second.styles.padding.top;
  combineImportedParagraphs(content);
  assert.deepEqual(
    section.children[0].map((block) => block.type),
    ["paragraph", "button", "paragraph"],
  );
  assert.deepEqual(
    section.children[1].map((block) => block.type),
    ["paragraph"],
  );
  const merged = section.children[0][0];
  if (merged.type !== "paragraph") throw new Error("Expected a paragraph");
  assert.equal(
    merged.content,
    "<p>First</p><p>Second <strong>bold</strong></p>",
  );
  assert.equal(merged.paragraphSpacing, gap);
});

test("different paragraph spacing stays in a separate block", () => {
  const { content } = convertHtmlTemplate(
    "<table><tr><td><p>First</p><p>Second</p><p>Third</p></td></tr></table>",
  );
  const section = content.blocks[0];
  if (section.type !== "section") throw new Error("Expected a section");
  const third = section.children[0][2];
  third.styles.padding.top = 12;
  combineImportedParagraphs(content);
  assert.equal(section.children[0].length, 2);
  assert.equal(section.children[0][0].type, "paragraph");
  assert.equal(section.children[0][1].type, "paragraph");
});
