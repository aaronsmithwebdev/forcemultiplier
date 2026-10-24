import assert from "node:assert/strict";
import test from "node:test";
import { createParagraphBlock, type TemplateContent } from "@templatical/types";
import {
  renderCampaignHtml,
  resendTestPayload,
  sendResendTest,
} from "../lib/campaign-email";

const settings = {
  subject: "Spring update",
  fromName: "Example Foundation",
  fromEmail: "news@example.org",
  replyToEmail: "team@example.org",
  footerContent: {
    blocks: [createParagraphBlock({ content: "<p>Required footer</p>" })],
    settings: {
      width: 600,
      backgroundColor: "#ffffff",
      textColor: "#1a1a1a",
      linkUnderline: true,
      fontFamily: "Arial",
      locale: "en",
    },
  },
};
const content: TemplateContent = {
  blocks: [createParagraphBlock({ content: "<p>Message body</p>" })],
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
  assert.match(String(sent?.html), /Required footer/);
  assert.equal(sent?.subject, "[TEST] Spring update");
});

test("campaign HTML renders the required footer through a Templatical layout", async () => {
  const html = await renderCampaignHtml(content, settings.footerContent);
  assert.match(html, /Required footer/);
  assert.ok(html.indexOf("Message body") < html.indexOf("Required footer"));
  assert.throws(
    () =>
      renderCampaignHtml(content, {
        ...settings.footerContent,
        blocks: [],
      }),
    /footer content is required/i,
  );
});

test("campaign HTML uses the chosen footer after the design body", async () => {
  const chosenFooter = {
    ...settings.footerContent,
    blocks: [createParagraphBlock({ content: "<p>Chosen footer</p>" })],
  };
  const html = await renderCampaignHtml(content, chosenFooter);
  assert.match(html, /Chosen footer/);
  assert.doesNotMatch(html, /Required footer/);
  assert.ok(html.indexOf("Message body") < html.indexOf("Chosen footer"));
});

test("campaign test email requires Resend configuration", async () => {
  await assert.rejects(
    sendResendTest(settings, "author@example.org", content, ""),
    /RESEND_API_KEY/,
  );
});

test("fundraising page merge tags survive rendering as clickable links", async () => {
  const html = await renderCampaignHtml(
    {
      ...content,
      blocks: [
        createParagraphBlock({
          content:
            '<p><a href="{{contact.FunraisinFundraisingUrl}}">Your fundraising page</a></p>',
        }),
      ],
    },
    settings.footerContent,
  );
  assert.match(html, /href="\{\{contact\.FunraisinFundraisingUrl\}\}"/);
  const { prepareBroadcastHtml, prepareServiceNoticeHtml } =
    await import("../lib/campaign-sends");
  assert.match(
    prepareBroadcastHtml(html),
    /href="\{\{\{contact\.FunraisinFundraisingUrl\}\}\}"/,
  );
  const personalized = prepareServiceNoticeHtml(html, {
    email: "sam@example.org",
    name: "Sam",
    data: {
      FunraisinFundraisingUrl: "https://example.org/fundraisers/sam/walk",
    },
  });
  assert.match(
    personalized,
    /href="https:\/\/example.org\/fundraisers\/sam\/walk"/,
  );
});
