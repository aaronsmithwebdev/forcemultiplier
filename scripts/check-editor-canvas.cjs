// Run with node scripts/check-editor-canvas.cjs; no application credentials needed.
const assert = require("node:assert/strict");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("@playwright/test");

(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { init } from '@templatical/editor';
        import { createDefaultTemplateContent, createSectionBlock, createParagraphBlock } from '@templatical/types';
        import { customizeTemplaticalEditor } from './components/templatical-editor';
        const content = createDefaultTemplateContent();
        content.blocks = [createSectionBlock({ children: [[createParagraphBlock({content: '<p>Edge to edge</p>'})]] })];
        window.editor = await init({ container: '#editor', content });
        window.before = JSON.stringify(window.editor.getContent());
        window.restore = customizeTemplaticalEditor(document.querySelector('#editor'), window.editor);
        window.ready = true;
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
    target: "es2022",
  });
  const server = http.createServer((request, response) => {
    response.setHeader(
      "Content-Type",
      request.url === "/editor.js" ? "text/javascript" : "text/html",
    );
    response.end(
      request.url === "/editor.js"
        ? bundle.outputFiles[0].contents
        : '<div id="editor" style="height:900px"></div><script type="module" src="/editor.js"></script>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    const bounds = () =>
      page.evaluate(() => {
        const root = document.querySelector("#editor").shadowRoot;
        const stage = root
          .querySelector(".tpl-canvas-stage")
          .getBoundingClientRect();
        const canvas = root
          .querySelector('[data-testid="canvas-wrapper"]')
          .getBoundingClientRect();
        return {
          left: stage.left - canvas.left,
          right: stage.right - canvas.right,
          width: canvas.width,
        };
      });
    for (const viewport of ["Desktop", "Mobile"]) {
      await page
        .locator("button")
        .filter({ hasText: new RegExp(`^${viewport}$`) })
        .click();
      await page.waitForFunction(() => {
        const root = document.querySelector("#editor").shadowRoot;
        return (
          root.querySelector('[data-testid="canvas-wrapper"]').getAnimations()
            .length === 0
        );
      });
      const measured = await bounds();
      assert.ok(
        Math.abs(measured.left) < 1 && Math.abs(measured.right) < 1,
        `${viewport}: ${JSON.stringify(measured)}`,
      );
      assert.ok(measured.width > 300);
    }
    assert.equal(
      await page.evaluate(
        () => JSON.stringify(window.editor.getContent()) === window.before,
      ),
      true,
    );
    await page.evaluate(() => window.restore());
    const original = await bounds();
    assert.ok(
      Math.abs(original.left + 96) < 1 && Math.abs(original.right - 96) < 1,
    );
    console.log(
      "Editor canvas passed: desktop/mobile edges match content; content preserved; cleanup restores SDK styling.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
