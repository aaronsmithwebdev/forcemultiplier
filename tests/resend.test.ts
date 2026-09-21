import assert from "node:assert/strict";
import test from "node:test";
import { resendStatus } from "../lib/resend";

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
