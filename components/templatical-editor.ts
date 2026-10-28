import type { TemplaticalEditor } from "@templatical/editor";
import { lintTemplate, type LintIssue } from "@templatical/quality";

export function issueMessagesByBlock(issues: LintIssue[]) {
  const messages = new Map<string, string[]>();
  for (const issue of issues) {
    if (!issue.blockId || issue.severity === "info") continue;
    const blockMessages = messages.get(issue.blockId) ?? [];
    blockMessages.push(issue.message);
    messages.set(issue.blockId, blockMessages);
  }
  return messages;
}

export function customizeTemplaticalEditor(
  container: HTMLElement,
  editor: TemplaticalEditor,
) {
  // shortcut: Depends on Templatical's badge markup; use its API when it exposes issue text.
  const root = container.shadowRoot ?? container;
  // Templatical adds 96px of stage background on each side of the email.
  // ponytail: Uses SDK markup until it exposes a canvas-stage width option.
  const style = document.createElement("style");
  style.textContent = ".tpl-canvas-stage { width: fit-content !important; }";
  root.appendChild(style);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function update() {
    const messages = issueMessagesByBlock(lintTemplate(editor.getContent()));
    for (const block of root.querySelectorAll<HTMLElement>(
      ".tpl-block[data-block-id]",
    )) {
      const badge = block.querySelector<HTMLElement>(
        ':scope > span[role="img"][title]',
      );
      const blockMessages = messages.get(block.dataset.blockId ?? "");
      if (!badge || !blockMessages?.length) continue;
      const tooltip = blockMessages.join("\n");
      if (badge.title !== tooltip) badge.title = tooltip;
      if (badge.getAttribute("aria-label") !== tooltip)
        badge.setAttribute("aria-label", tooltip);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 100);
  }

  function onMouseOver(event: Event) {
    if (
      event.target instanceof Element &&
      event.target.closest('.tpl-block > span[role="img"][title]')
    )
      update();
  }

  const observer = new MutationObserver(schedule);
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["title"],
  });
  root.addEventListener("mouseover", onMouseOver);
  schedule();

  return () => {
    observer.disconnect();
    style.remove();
    root.removeEventListener("mouseover", onMouseOver);
    clearTimeout(timer);
  };
}
