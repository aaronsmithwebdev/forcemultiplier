import assert from "node:assert/strict";
import test from "node:test";
import type { TemplateContent } from "@templatical/types";
import {
  appendEmailFooter,
  resendTestPayload,
  sendResendTest,
} from "../lib/campaign-email";

const settings = {
  subject: "Spring update",
  fromName: "Example Foundation",
  fromEmail: "news@example.org",
  replyToEmail: "team@example.org",
  footerHtml: "<p>Required footer</p>",
};
const content: TemplateContent = {
  blocks: [],
  settings: {
    width: 600,
    backgroundColor: "#ffffff",
    textColor: "#1a1a1a",
    linkUnderline: true,
    fontFamily: "Arial",
    locale: "en",
  },
};

test("campaign test email renders Templatical content and sends through Resend", async () => {
  let sent: Record<string, unknown> | undefined;
  const request = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      "Bearer re_test",
    );
    sent = JSON.parse(String(options?.body));
    return Response.json({ id: "email_123" });
  }) as typeof fetch;

  assert.deepEqual(
    resendTestPayload(settings, "author@example.org", "<p>Hello</p>"),
    {
      from: "Example Foundation <news@example.org>",
      to: ["author@example.org"],
      subject: "[TEST] Spring update",
      html: "<p>Hello</p>",
      reply_to: "team@example.org",
    },
  );

  assert.deepEqual(
    await sendResendTest(
      settings,
      "author@example.org",
      content,
      "re_test",
      request,
    ),
    { id: "email_123" },
  );
  assert.match(String(sent?.html), /<!doctype html>/i);
  assert.match(String(sent?.html), /data-email-footer="true"/);
  assert.match(String(sent?.html), /Required footer/);
  assert.equal(sent?.subject, "[TEST] Spring update");
});

test("required footers are appended inside an email body", () => {
  assert.equal(
    appendEmailFooter(
      "<html><body><p>Message</p></body></html>",
      "<p>Footer $&</p>",
    ),
    '<html><body><p>Message</p><div data-email-footer="true"><p>Footer $&</p></div></body></html>',
  );
  assert.throws(
    () => appendEmailFooter("<p>Message</p>", " "),
    /footer is required/i,
  );
});

test("campaign test email requires Resend configuration", async () => {
  await assert.rejects(
    sendResendTest(settings, "author@example.org", content, ""),
    /RESEND_API_KEY/,
  );
});
