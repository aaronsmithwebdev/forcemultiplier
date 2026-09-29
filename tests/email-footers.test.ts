import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultTemplateContent,
  createSlotBlock,
} from "@templatical/types";
import {
  createFooter,
  createStarterFooterContent,
  normalizeFooterContent,
} from "../lib/email-footers";
import { db } from "../lib/db";

test("email footers require renderable Templatical content", () => {
  const content = createStarterFooterContent();
  assert.equal(normalizeFooterContent(content), content);
  assert.throws(
    () => normalizeFooterContent(createDefaultTemplateContent()),
    /content is required/i,
  );

  const layoutContent = createDefaultTemplateContent();
  layoutContent.blocks = [createSlotBlock()];
  assert.throws(
    () => normalizeFooterContent(layoutContent),
    /unsupported layout blocks/i,
  );
});

test("choosing a new default clears the old default atomically", async (t) => {
  const original = db.$transaction;
  const calls: string[] = [];
  db.$transaction = (async (operation: (tx: unknown) => unknown) =>
    operation({
      emailFooter: {
        updateMany: async () => {
          calls.push("clear");
        },
        create: async ({ data }: { data: { name: string } }) => {
          calls.push("create");
          return { id: "new-footer", ...data };
        },
      },
    })) as typeof original;
  t.after(() => {
    db.$transaction = original;
  });

  const footer = await createFooter(
    {
      name: "New default",
      content: createStarterFooterContent(),
      isDefault: true,
    },
    "user-1",
  );
  assert.deepEqual(calls, ["clear", "create"]);
  assert.equal(footer.id, "new-footer");
});
