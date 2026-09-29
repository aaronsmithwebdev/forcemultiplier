import assert from "node:assert/strict";
import test from "node:test";
import { createFooter, normalizeFooterHtml } from "../lib/email-footers";
import { db } from "../lib/db";

test("email footers accept static email-safe fragments", () => {
  assert.equal(
    normalizeFooterHtml(
      '  <table role="presentation"><tr><td><a href="https://example.org">Example</a></td></tr></table>  ',
    ),
    '<table role="presentation"><tr><td><a href="https://example.org">Example</a></td></tr></table>',
  );
});

test("email footers reject active content and merge tags", () => {
  assert.throws(
    () => normalizeFooterHtml("<script>alert(1)</script>"),
    /email-safe HTML fragment/,
  );
  assert.throws(
    () => normalizeFooterHtml('<a href="javascript:alert(1)">Bad</a>'),
    /safe URLs/,
  );
  assert.throws(
    () => normalizeFooterHtml("<p>{{unsubscribe_url}}</p>"),
    /merge tags are not supported/,
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
    { name: "New default", html: "<p>Footer</p>", isDefault: true },
    "user-1",
  );
  assert.deepEqual(calls, ["clear", "create"]);
  assert.equal(footer.id, "new-footer");
});
