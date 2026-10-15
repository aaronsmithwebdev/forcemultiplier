import { parse, serialize } from "parse5";
import type { TemplateContent } from "@templatical/types";
import { rewriteArchiveImages } from "./archive-images";

type Node = {
  tagName?: string;
  nodeName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
};

const discarded = new Set([
  "script",
  "noscript",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "textarea",
  "select",
  "button",
  "video",
  "audio",
  "source",
  "svg",
  "math",
  "link",
  "meta",
  "base",
  "template",
]);

export function prepareArchiveForConversion(
  html: string,
  images: ReadonlyMap<string, string>,
) {
  const trustedImages = new Set(images.values());
  const rewritten = rewriteArchiveImages(html, images).html;
  const document = parse(rewritten);
  let removedImages = 0;
  const cleanCss = (css: string) =>
    css
      .replace(/@import[^;]+;?/gi, "")
      .replace(
        /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
        (_match, _quote, url: string) =>
          trustedImages.has(url.trim()) ? `url("${url.trim()}")` : "none",
      );
  const visit = (node: Node, inStyle = false) => {
    node.childNodes = node.childNodes?.filter((child) => {
      if (discarded.has(child.tagName || "")) return false;
      if (child.tagName === "img") {
        const src = child.attrs?.find((attr) => attr.name === "src")?.value;
        if (!src || !trustedImages.has(src)) {
          removedImages++;
          return false;
        }
      }
      return true;
    });
    node.attrs = node.attrs?.filter((attr) => {
      if (
        /^on/i.test(attr.name) ||
        ["srcdoc", "srcset", "formaction"].includes(attr.name)
      )
        return false;
      if (attr.name === "href")
        return /^(https?:\/\/|mailto:|tel:|#)/i.test(attr.value.trim());
      if (attr.name === "background") return trustedImages.has(attr.value);
      if (attr.name === "src" && node.tagName !== "img") return false;
      if (attr.name === "style") attr.value = cleanCss(attr.value);
      return true;
    });
    if (inStyle && node.nodeName === "#text" && node.value)
      node.value = cleanCss(node.value);
    for (const child of node.childNodes || [])
      visit(child, node.tagName === "style");
  };
  visit(document as Node);
  return { html: serialize(document), removedImages };
}

export function combineImportedParagraphs(content: TemplateContent) {
  for (const section of content.blocks) {
    if (section.type !== "section") continue;
    for (const column of section.children) {
      for (let index = 1; index < column.length;) {
        const previous = column[index - 1];
        const current = column[index];
        if (
          previous.type !== "paragraph" ||
          current.type !== "paragraph" ||
          previous.visibility ||
          current.visibility ||
          previous.displayCondition ||
          current.displayCondition ||
          previous.styles.backgroundColor !== current.styles.backgroundColor ||
          previous.styles.padding.left !== current.styles.padding.left ||
          previous.styles.padding.right !== current.styles.padding.right ||
          !/^<p(?:\s|>)/i.test(current.content) ||
          !/<\/p>$/i.test(previous.content)
        ) {
          index++;
          continue;
        }
        const gap = previous.styles.padding.bottom + current.styles.padding.top;
        if (
          previous.paragraphSpacing !== undefined &&
          previous.paragraphSpacing !== gap
        ) {
          index++;
          continue;
        }
        previous.content += current.content;
        previous.paragraphSpacing = gap;
        previous.styles = {
          ...previous.styles,
          padding: {
            ...previous.styles.padding,
            bottom: current.styles.padding.bottom,
          },
        };
        column.splice(index, 1);
      }
    }
  }
  return content;
}
