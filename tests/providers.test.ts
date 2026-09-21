import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { encrypt, decrypt, hash } from "../lib/security";
import { startOAuth, finishOAuth, providerRequest } from "../lib/providers";
process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
process.env.APP_URL = "http://localhost:3000";
const row = (provider = "salesforce") => ({
  provider,
  version: 1,
  clientId: "test-client",
  secret: encrypt("test-secret"),
  loginUrl: "https://login.salesforce.com",
  tokens: null,
  externalId: null,
  instanceUrl: null,
  expiresAt: null,
  refreshLeaseUntil: null,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

test("Salesforce OAuth uses PKCE and rejects a different browser session and replay", async (t) => {
  const config: any = row();
  let attempt: any;
  let exchanges = 0;
  mockMethod(t, db.connection, "findUnique", async () => config);
  mockMethod(t, db.oAuthAttempt, "create", async ({ data }: any) => {
    attempt = data;
    return data;
  });
  mockMethod(t, db.oAuthAttempt, "findUnique", async ({ where }: any) =>
    attempt?.id === where.id ? attempt : null,
  );
  mockMethod(t, db.oAuthAttempt, "deleteMany", async () => {
    attempt = null;
    return { count: 1 };
  });
  mockMethod(t, db.connection, "updateMany", async ({ data }: any) => {
    Object.assign(config, data);
    return { count: 1 };
  });
  mockMethod(t, globalThis, "fetch", async (url: any, init: any) => {
    if (String(url).endsWith("/token")) {
      exchanges++;
      assert.ok(init.body.get("code_verifier"));
      assert.equal(init.body.get("client_secret"), "test-secret");
      return json({
        access_token: "access",
        refresh_token: "refresh",
        instance_url: "https://org.my.salesforce.com",
      });
    }
    return json({
      organization_id: "org-one",
      preferred_username: "fixture@example.test",
    });
  });
  const url = new URL(await startOAuth("salesforce", "session-one"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("scope")?.split(" ").includes("openid"));
  const state = url.searchParams.get("state")!;
  assert.equal(attempt.id, hash(state));
  await assert.rejects(
    finishOAuth("salesforce", "wrong-session", state, "code"),
    /expired/,
  );
  assert.equal(exchanges, 0);
  await finishOAuth("salesforce", "session-one", state, "code");
  assert.equal(config.externalId, "org-one");
  assert.equal(JSON.parse(decrypt(config.tokens)).refreshToken, "refresh");
  await assert.rejects(
    finishOAuth("salesforce", "session-one", state, "code"),
    /expired/,
  );
  assert.equal(exchanges, 1);
});

test("Constant Contact authorization requests campaign access without disconnecting", async (t) => {
  const config = {
    ...row("constant-contact"),
    tokens: encrypt(
      JSON.stringify({
        accessToken: "existing",
        refreshToken: "existing-refresh",
      }),
    ),
  };
  mockMethod(t, db.connection, "findUnique", async () => config);
  mockMethod(t, db.oAuthAttempt, "deleteMany", async () => ({ count: 0 }));
  mockMethod(t, db.oAuthAttempt, "create", async ({ data }: any) => data);
  const url = new URL(await startOAuth("constant-contact", "session"));
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [
    "contact_data",
    "campaign_data",
    "account_read",
    "offline_access",
  ]);
  assert.ok(config.tokens);
});

test("expired OAuth and changed application settings never exchange a code", async (t) => {
  mockMethod(t, globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
  const config = row();
  const attempt: any = {
    id: hash("state"),
    userId: "session",
    provider: "salesforce",
    expiresAt: new Date(0),
    connectionVersion: 1,
  };
  mockMethod(t, db.connection, "findUnique", async () => config);
  mockMethod(t, db.oAuthAttempt, "findUnique", async () => attempt);
  mockMethod(t, db.oAuthAttempt, "deleteMany", async () => ({ count: 1 }));
  await assert.rejects(
    finishOAuth("salesforce", "session", "state", "code"),
    /expired/,
  );
  attempt.expiresAt = new Date(Date.now() + 60000);
  attempt.connectionVersion = 0;
  await assert.rejects(
    finishOAuth("salesforce", "session", "state", "code"),
    /settings changed/,
  );
});

test("Constant Contact 401 refresh uses Basic auth, saves rotated token and retries once", async (t) => {
  const config: any = {
    ...row("constant-contact"),
    tokens: encrypt(
      JSON.stringify({
        accessToken: "old-access",
        refreshToken: "old-refresh",
      }),
    ),
    expiresAt: new Date(Date.now() + 3600000),
    instanceUrl: "https://api.cc.email",
  };
  mockMethod(t, db.connection, "findUnique", async () => ({ ...config }));
  mockMethod(t, db.connection, "updateMany", async ({ data }: any) => {
    Object.assign(config, data);
    return { count: 1 };
  });
  let calls = 0;
  mockMethod(t, globalThis, "fetch", async (url: any, init: any) => {
    calls++;
    if (String(url).endsWith("/token")) {
      assert.equal(
        init.headers.Authorization,
        "Basic " + Buffer.from("test-client:test-secret").toString("base64"),
      );
      assert.equal(init.body.get("refresh_token"), "old-refresh");
      return json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 86400,
      });
    }
    if (init.headers.Authorization === "Bearer old-access")
      return json({}, 401);
    assert.equal(init.headers.Authorization, "Bearer new-access");
    return json({ lists: [] });
  });
  assert.deepEqual(
    await providerRequest("constant-contact", "/v3/contact_lists"),
    { lists: [] },
  );
  assert.equal(calls, 3);
  assert.equal(JSON.parse(decrypt(config.tokens)).refreshToken, "new-refresh");
  assert.equal(config.refreshLeaseUntil, null);
});

test("disconnect during token refresh cannot restore revoked tokens", async (t) => {
  const config: any = {
    ...row(),
    tokens: encrypt(
      JSON.stringify({ accessToken: "old", refreshToken: "refresh" }),
    ),
    expiresAt: new Date(0),
    instanceUrl: "https://org.my.salesforce.com",
  };
  mockMethod(t, db.connection, "findUnique", async () => ({ ...config }));
  mockMethod(t, db.connection, "updateMany", async ({ where, data }: any) => {
    if (where.version !== config.version) return { count: 0 };
    Object.assign(config, data);
    return { count: 1 };
  });
  mockMethod(t, globalThis, "fetch", async () => {
    config.version++;
    config.tokens = null;
    config.refreshLeaseUntil = null;
    return json({ access_token: "stale", refresh_token: "stale-refresh" });
  });
  await assert.rejects(
    providerRequest("salesforce", "/services/data/v66.0/limits"),
    /changed during refresh/,
  );
  assert.equal(config.tokens, null);
});

function mockMethod(t: any, target: any, name: string, fn: any) {
  const original = target[name];
  target[name] = fn;
  t.after(() => {
    target[name] = original;
  });
}
