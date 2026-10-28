import test from "node:test";
import assert from "node:assert/strict";
import type { LintIssue } from "@templatical/quality";
import { issueMessagesByBlock } from "../components/templatical-editor";

test("block tooltips include every error and warning for that block", () => {
  const issues = [
    { blockId: "title", severity: "error", message: "Heading level skipped" },
    { blockId: "title", severity: "warning", message: "Text is too small" },
    { blockId: "title", severity: "info", message: "Advisory" },
    { blockId: "other", severity: "warning", message: "Missing alt text" },
    { blockId: null, severity: "error", message: "Template issue" },
  ] as LintIssue[];

  assert.deepEqual(issueMessagesByBlock(issues).get("title"), [
    "Heading level skipped",
    "Text is too small",
  ]);
  assert.deepEqual(issueMessagesByBlock(issues).get("other"), [
    "Missing alt text",
  ]);
  assert.equal(issueMessagesByBlock(issues).size, 2);
});
