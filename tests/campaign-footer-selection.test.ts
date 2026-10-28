import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createDefaultTemplateContent } from "@templatical/types";
import { db } from "../lib/db";
import { saveCampaign } from "../lib/campaigns";

function mock(t: TestContext, target: any, key: string, fn: any) {
  const original = target[key];
  const replacement = t.mock.fn(fn);
  target[key] = replacement;
  t.after(() => {
    target[key] = original;
  });
  return replacement;
}

test("no footer persists as null and does not look up an empty footer ID", async (t) => {
  mock(t, db.campaign, "findUnique", async () => ({
    content: createDefaultTemplateContent(),
  }));
  const lookup = mock(t, db.emailFooter, "findUnique", async () => {
    throw new Error("No footer must not query a footer ID");
  });
  mock(t, db.campaign, "update", async ({ data }: any) => {
    assert.equal(data.footerId, null);
    return { ...data, footer: null };
  });
  const result = await saveCampaign("campaign-1", { footerId: null });
  assert.equal(result.footerId, null);
  assert.equal(result.footer, null);
  assert.equal(lookup.mock.callCount(), 0);
});

test("selecting an unavailable footer is rejected before saving", async (t) => {
  mock(t, db.campaign, "findUnique", async () => ({
    content: createDefaultTemplateContent(),
  }));
  mock(t, db.emailFooter, "findUnique", async () => null);
  const update = mock(t, db.campaign, "update", async () => {
    throw new Error("Invalid footer must not save");
  });
  await assert.rejects(
    saveCampaign("campaign-1", { footerId: "missing-footer" }),
    /footer not found/i,
  );
  assert.equal(update.mock.callCount(), 0);
});
