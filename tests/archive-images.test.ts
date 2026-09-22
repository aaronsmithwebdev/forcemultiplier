import test from "node:test";
import assert from "node:assert/strict";
import { rewriteArchiveImages } from "../lib/archive-images";
import { fetchArchiveImage } from "../lib/archive-image-import";

test("inventory and replacement cover image tags, srcset and CSS without changing links", () => {
  const original =
    "https://files.constantcontact.com/account/photo.png?a=1&b=2";
  const html = `<a href="${original}">link</a><img src="https://files.constantcontact.com/account/photo.png?a=1&amp;b=2" srcset="${original} 1x, https://other.example/large.png 2x"><style>.hero{background:url('${original}')}</style><div style="background-image:url(${original})"></div>`;
  const result = rewriteArchiveImages(
    html,
    new Map([[original, "https://storage.example/photo.png"]]),
  );
  assert.deepEqual([...result.urls].sort(), [
    original,
    "https://other.example/large.png",
  ]);
  assert.match(result.html, /src="https:\/\/storage\.example\/photo\.png"/);
  assert.match(
    result.html,
    /srcset="https:\/\/storage\.example\/photo\.png 1x/,
  );
  assert.match(
    result.html,
    /background:url\('https:\/\/storage\.example\/photo\.png'\)/,
  );
  assert.match(
    result.html,
    /href="https:\/\/files\.constantcontact\.com\/account\/photo\.png/,
  );
});

test("image downloads stay inside the approved account folder", async () => {
  await assert.rejects(
    fetchArchiveImage(
      "https://files.constantcontact.com/other/photo.png",
      "account",
    ),
    /approved Constant Contact folder/,
  );
  await assert.rejects(
    fetchArchiveImage("https://127.0.0.1/private.png", "account"),
    /approved Constant Contact folder/,
  );
});
