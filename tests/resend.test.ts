import assert from "node:assert/strict";
import test from "node:test";
import {
  createResendContactImport,
  resendStatus,
  sendResendBatch,
} from "../lib/resend";

test("Resend status reads domains without exposing the key", async () => {
  let called = false;
  const request = (async (
    _url: string | URL | Request,
    options?: RequestInit,
  ) => {
    called = true;
    assert.equal(
      options?.headers &&
        (options.headers as Record<string, string>).Authorization,
      "Bearer re_test",
    );
    return Response.json({
      data: [
        {
          name: "example.com",
          status: "verified",
          capabilities: { sending: "enabled" },
        },
      ],
      has_more: false,
    });
  }) as typeof fetch;
  assert.deepEqual(await resendStatus("", request), {
    configured: false,
    domains: [],
    hasMore: false,
  });
  assert.equal(called, false);
  assert.deepEqual(await resendStatus("re_test", request), {
    configured: true,
    domains: [{ name: "example.com", status: "verified", sending: true }],
    hasMore: false,
  });
  await assert.rejects(
    resendStatus(
      "re_test",
      (async () => new Response(null, { status: 401 })) as typeof fetch,
    ),
    /rejected the API key/,
  );
});

test("Resend transactional batches are bounded and idempotent", async () => {
  const email = {
    from: "Example <service@example.org>",
    to: ["person@example.org"] as [string],
    subject: "Service update",
    html: "<p>Hello</p>",
    reply_to: "team@example.org",
  };
  const request = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    assert.equal(url, "https://api.resend.com/emails/batch");
    assert.equal(
      (options?.headers as Record<string, string>)["Idempotency-Key"],
      "service-notice/send-1/0",
    );
    assert.deepEqual(JSON.parse(String(options?.body)), [email]);
    return Response.json({ data: [{ id: "email_123" }] });
  }) as typeof fetch;

  assert.deepEqual(
    await sendResendBatch(
      [email],
      "service-notice/send-1/0",
      "re_test",
      request,
    ),
    [{ id: "email_123" }],
  );
  await assert.rejects(
    sendResendBatch([], "empty", "re_test", request),
    /1–100 emails/,
  );
});

test("Resend imports map Salesforce Contact IDs to a contact property", async () => {
  const csv =
    'Email,First Name,Last Name,Salesforce Contact ID\n"sam@example.org","Sam","Smith","003000000000000001"';
  const request = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    assert.equal(url, "https://api.resend.com/contacts/imports");
    assert.equal(
      options?.headers &&
        (options.headers as Record<string, string>).Authorization,
      "Bearer re_test",
    );
    const form = options?.body as FormData;
    assert.equal(await (form.get("file") as Blob).text(), csv);
    assert.deepEqual(JSON.parse(String(form.get("column_map"))), {
      email: "Email",
      first_name: "First Name",
      last_name: "Last Name",
      properties: {
        salesforce_contact_id: {
          column: "Salesforce Contact ID",
          type: "string",
        },
      },
    });
    assert.equal(form.get("on_conflict"), "upsert");
    assert.equal(form.get("segments"), JSON.stringify([{ id: "segment_123" }]));
    return Response.json({ id: "import_123" });
  }) as typeof fetch;

  assert.equal(
    await createResendContactImport("segment_123", csv, "re_test", request),
    "import_123",
  );
});
