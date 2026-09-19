import test from "node:test";
import assert from "node:assert/strict";
import {
  encrypt,
  decrypt,
  salesforceHost,
  safeProviderPath,
  checkOrigin,
} from "../lib/security";
process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
process.env.APP_URL = "http://localhost:3000";
test("credential encryption is authenticated and uses fresh nonces", () => {
  const a = encrypt("secret-token"),
    b = encrypt("secret-token");
  assert.notEqual(a, b);
  assert.equal(decrypt(a), "secret-token");
  const parts = a.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decrypt(parts.join(".")));
});
test("Salesforce host validation prevents credential forwarding", () => {
  for (const url of [
    "http://login.salesforce.com",
    "https://login.salesforce.com.evil.test",
    "https://evil.test",
    "https://user:pass@login.salesforce.com",
    "https://login.salesforce.com/path",
    "https://login.salesforce.com:444",
  ])
    assert.throws(() => salesforceHost(url, true));
  assert.equal(
    salesforceHost("https://company.my.salesforce.com", true),
    "https://company.my.salesforce.com",
  );
});
test("provider pagination stays on the expected host and API", () => {
  assert.equal(
    safeProviderPath("https://api.cc.email", "/v3/contacts?cursor=abc", "/v3/"),
    "https://api.cc.email/v3/contacts?cursor=abc",
  );
  for (const path of [
    "https://evil.test/v3/contacts",
    "//evil.test/v3/contacts",
    "/oauth/token",
    "/v3/../../oauth/token",
  ])
    assert.throws(() => safeProviderPath("https://api.cc.email", path, "/v3/"));
});
test("state-changing requests require exact application origin", () => {
  assert.doesNotThrow(() =>
    checkOrigin(
      new Request("http://localhost:3000/api/test", {
        headers: { origin: "http://localhost:3000" },
      }),
    ),
  );
  assert.throws(() =>
    checkOrigin(
      new Request("http://localhost:3000/api/test", {
        headers: { origin: "https://evil.test" },
      }),
    ),
  );
  assert.throws(() =>
    checkOrigin(new Request("http://localhost:3000/api/test")),
  );
});
