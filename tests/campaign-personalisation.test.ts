import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createParagraphBlock, type TemplateContent } from "@templatical/types";
import { db } from "../lib/db";
import {
  previewCampaignRecipients,
  prepareServiceNoticeHtml,
} from "../lib/campaign-sends";
import { sendResendTestHtml } from "../lib/campaign-email";

const content: TemplateContent = {
  blocks: [
    createParagraphBlock({
      content:
        '<p>Hello {{contact.FirstName}} — {{contact.FunraisinEventName}} <a href="{{contact.FunraisinFundraisingUrl}}">Your page</a></p><a href="{{unsubscribe_url}}">Unsubscribe</a>',
    }),
  ],
  settings: {
    width: 600,
    backgroundColor: "#ffffff",
    textColor: "#000000",
    linkUnderline: true,
    fontFamily: "Arial",
    locale: "en",
  },
};
const footer = {
  ...content,
  blocks: [createParagraphBlock({ content: "<p>Required footer</p>" })],
};
const selection = {
  audienceIds: ["autumn", "spring"],
  exclusionAudienceIds: ["excluded"],
  manualExclusions: ["manual@example.org"],
  exclusionRules: { conjunction: "AND" as const, items: [] },
};
function mock(t: TestContext, target: any, key: string, fn: any) {
  const original = target[key];
  target[key] = fn;
  t.after(() => {
    target[key] = original;
  });
}
function setup(t: TestContext) {
  const campaign = { serviceNotice: false, footer: { content: footer } };
  const rows = [
    {
      email: "sam@example.org",
      name: "Sam <Smith>",
      data: {
        FunraisinEventName: "Autumn Walk",
        FunraisinFundraisingUrl: "https://example.org/fundraisers/sam/autumn",
      },
      optedOut: false,
      suppressed: false,
      audienceExcluded: false,
      fieldExcluded: false,
      manuallyExcluded: false,
      deliveryBlocked: false,
    },
    {
      email: "pat@example.org",
      name: "Pat Jones",
      data: { FunraisinEventName: "Spring Walk" },
      optedOut: false,
      suppressed: false,
      audienceExcluded: false,
      fieldExcluded: false,
      manuallyExcluded: false,
      deliveryBlocked: false,
    },
  ];
  const queries: any[] = [];
  mock(t, db.campaign, "findUnique", async () => campaign);
  mock(t, db.audience, "findMany", async ({ where }: any) =>
    where.id.in.map((id: string) => ({ id, runs: [{ id: `run-${id}` }] })),
  );
  mock(t, db.pullRun, "findMany", async () => [
    { fields: ["FunraisinEventName", "FunraisinFundraisingUrl"] },
  ]);
  mock(t, db, "$queryRaw", async (query: any) => {
    queries.push(query);
    return rows;
  });
  mock(t, globalThis, "fetch", async () => {
    throw new Error("Preview must not call providers");
  });
  return { campaign, rows, queries };
}

test("preview candidates use the production audience precedence and all exclusions", async (t) => {
  const { queries } = setup(t);
  const result = await previewCampaignRecipients("campaign-1", selection, {
    search: "sam_100%",
  });
  assert.deepEqual(result, [
    { email: "sam@example.org", name: "Sam <Smith>" },
    { email: "pat@example.org", name: "Pat Jones" },
  ]);
  const query = queries[0];
  for (const value of [
    "run-autumn",
    "run-spring",
    "run-excluded",
    "manual@example.org",
    "%sam\\_100\\%%",
  ])
    assert.ok(query.values.includes(value));
  assert.match(query.sql, /array_position/);
  assert.match(query.sql, /BOOL_AND\(m\."fieldExcluded"\)/);
  assert.match(query.sql, /ARRAY_AGG\(m\.name ORDER BY m\."fieldExcluded"/);
  assert.match(query.sql, /ARRAY_AGG\(m\.data ORDER BY m\."fieldExcluded"/);
  assert.match(
    query.sql,
    /ARRAY_AGG\(m\."salesforceId" ORDER BY m\."fieldExcluded"/,
  );
  assert.match(query.sql, /NOT "audienceExcluded" AND NOT "fieldExcluded"/);
  assert.match(query.sql, /NOT "manuallyExcluded" AND NOT "deliveryBlocked"/);
  assert.match(query.sql, /NOT "optedOut" AND NOT suppressed/);
  assert.match(query.sql, /LIMIT 25/);
});

test("two recipient previews resolve names, event URLs and missing values without changing the design", async (t) => {
  setup(t);
  const original = JSON.stringify(content);
  const result = await previewCampaignRecipients("campaign-1", selection, {
    emails: ["sam@example.org", "pat@example.org"],
    content,
  });
  assert.equal(result.length, 2);
  assert.match(result[0]!.html!, /Hello Sam/);
  assert.match(result[0]!.html!, /Autumn Walk/);
  assert.match(
    result[0]!.html!,
    /href="https:\/\/example.org\/fundraisers\/sam\/autumn"/,
  );
  assert.match(result[0]!.html!, /#test-unsubscribe/);
  assert.match(result[0]!.html!, /Required footer/);
  assert.doesNotMatch(result[0]!.html!, /\{\{contact\./);
  assert.deepEqual(result[0]!.missingFields, []);
  assert.match(result[1]!.html!, /Hello Pat/);
  assert.match(result[1]!.html!, /Spring Walk/);
  assert.deepEqual(result[1]!.missingFields, ["FunraisinFundraisingUrl"]);
  assert.equal(JSON.stringify(content), original);
});

test("marketing previews reject opted-out, excluded and unrelated samples", async (t) => {
  const { rows } = setup(t);
  for (const flag of [
    "optedOut",
    "suppressed",
    "audienceExcluded",
    "fieldExcluded",
    "manuallyExcluded",
    "deliveryBlocked",
  ] as const) {
    rows[0]![flag] = true;
    await assert.rejects(
      previewCampaignRecipients("campaign-1", selection, {
        emails: ["sam@example.org"],
        content,
      }),
      /no longer eligible/,
    );
    rows[0]![flag] = false;
  }
  await assert.rejects(
    previewCampaignRecipients("campaign-1", selection, {
      emails: ["outside@example.org"],
      content,
    }),
    /no longer eligible/,
  );
  await assert.rejects(
    previewCampaignRecipients("campaign-1", selection, {
      emails: ["a@example.org", "b@example.org", "c@example.org"],
      content,
    }),
    /at most two/,
  );
  await assert.rejects(
    previewCampaignRecipients("campaign-1", selection, { content }),
    /Choose a preview recipient/,
  );
  await assert.rejects(
    previewCampaignRecipients("campaign-1", { ...selection, audienceIds: [] }),
    /Choose a send audience/,
  );
});

test("service notice previews use the same personalisation and opt-out policy as delivery", async (t) => {
  const { campaign, rows } = setup(t);
  campaign.serviceNotice = true;
  rows[0]!.optedOut = true;
  const design = {
    ...content,
    blocks: [
      createParagraphBlock({
        content:
          "<p>Hello {{contact.FirstName}} {{contact.FunraisinEventName}}</p>",
      }),
    ],
  };
  const result = await previewCampaignRecipients("campaign-1", selection, {
    emails: ["sam@example.org"],
    content: design,
  });
  assert.match(result[0]!.html!, /Hello Sam Autumn Walk/);
  assert.equal(
    prepareServiceNoticeHtml(
      "Hello {{contact.FirstName}} {{contact.FunraisinEventName}}",
      rows[0]!,
    ),
    "Hello Sam Autumn Walk",
  );
  await assert.rejects(
    previewCampaignRecipients("campaign-1", selection, {
      emails: ["sam@example.org"],
      content,
    }),
    /cannot contain an unsubscribe link/,
  );
});

test("personalised test copies use the tester destination with the sampled person's content", async (t) => {
  setup(t);
  const [sample] = await previewCampaignRecipients("campaign-1", selection, {
    emails: ["sam@example.org"],
    content,
  });
  const request = (async (_url: unknown, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    assert.deepEqual(payload.to, ["author@example.org"]);
    assert.match(payload.html, /Hello Sam/);
    assert.match(payload.html, /fundraisers\/sam\/autumn/);
    assert.equal(payload.subject, "[TEST] Autumn Walk");
    return Response.json({ id: "test-1" });
  }) as typeof fetch;
  await sendResendTestHtml(
    {
      subject: "Autumn Walk",
      fromName: "Team",
      fromEmail: "team@example.org",
      replyToEmail: "team@example.org",
      footerContent: footer,
    },
    "author@example.org",
    sample!.html!,
    "test-key",
    request,
  );
});
