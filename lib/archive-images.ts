import { parse, serialize } from "parse5";

type Node = {
  tagName?: string;
  nodeName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
};

const cssUrl = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
const srcsetUrl = /(?:https?:)?\/\/[^\s,]+/gi;

export function normalizeImageUrl(value: string) {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    url.protocol = "https:";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function rewriteArchiveImages(
  html: string,
  urls: ReadonlyMap<string, string> = new Map(),
  disableLinks = false,
) {
  const found = new Set<string>();
  const replace = (value: string) => {
    const url = normalizeImageUrl(value);
    if (!url) return value;
    found.add(url);
    return urls.get(url) || value;
  };
  const rewriteCss = (css: string) =>
    css.replace(
      cssUrl,
      (_match, quote: string, value: string) =>
        `url(${quote}${replace(value.trim())}${quote})`,
    );
  const visit = (node: Node, inStyle = false) => {
    for (const attr of node.attrs || []) {
      if (
        disableLinks &&
        ["a", "area"].includes(node.tagName || "") &&
        attr.name === "href"
      ) {
        attr.value = "#";
        continue;
      }
      if (
        attr.name === "background" ||
        (node.tagName === "img" && ["src", "srcset"].includes(attr.name)) ||
        (node.tagName === "source" && attr.name === "srcset")
      ) {
        attr.value =
          attr.name === "srcset"
            ? attr.value.replace(srcsetUrl, replace)
            : replace(attr.value);
      } else if (attr.name === "style") {
        attr.value = rewriteCss(attr.value);
      }
    }
    if (inStyle && node.nodeName === "#text" && node.value)
      node.value = rewriteCss(node.value);
    for (const child of node.childNodes || [])
      visit(child, node.tagName === "style");
  };
  const document = parse(html);
  visit(document as Node);
  return {
    html: serialize(document),
    urls: found,
  };
}
