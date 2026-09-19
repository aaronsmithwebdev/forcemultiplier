import { db } from "./db";
import { AppError } from "./errors";
import {
  appUrl,
  decrypt,
  encrypt,
  hash,
  randomToken,
  salesforceHost,
  safeProviderPath,
} from "./security";
import { createHash } from "node:crypto";
import type { Connection } from "@prisma/client";
export type Provider = "salesforce" | "constant-contact";
export const isProvider = (value: string): value is Provider =>
  value === "salesforce" || value === "constant-contact";
export const SF_VERSION = process.env.SALESFORCE_API_VERSION || "v66.0";
const CC_AUTH = "https://authz.constantcontact.com/oauth2/default/v1";
type Tokens = { accessToken: string; refreshToken: string };
export async function connection(provider: Provider) {
  const row = await db.connection.findUnique({ where: { provider } });
  if (!row)
    throw new AppError(
      "Save your application credentials in Connections first.",
      409,
    );
  return row;
}
export function callbackUrl(provider: Provider) {
  return `${appUrl()}/api/oauth/${provider}/callback`;
}
export async function startOAuth(provider: Provider, userId: string) {
  const config = await connection(provider);
  const state = randomToken(),
    verifier = randomToken();
  await db.oAuthAttempt.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { userId, provider }] },
  });
  await db.oAuthAttempt.create({
    data: {
      id: hash(state),
      userId,
      provider,
      verifier: encrypt(verifier),
      connectionVersion: config.version,
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(provider),
    response_type: "code",
    state,
    scope:
      provider === "salesforce"
        ? "api refresh_token openid"
        : "contact_data account_read offline_access",
  });
  if (provider === "salesforce") {
    params.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    params.set("code_challenge_method", "S256");
  }
  return `${provider === "salesforce" ? salesforceHost(config.loginUrl, true) + "/services/oauth2/authorize" : CC_AUTH + "/authorize"}?${params}`;
}
async function tokenRequest(config: Connection, params: URLSearchParams) {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (config.provider === "salesforce") {
    params.set("client_id", config.clientId);
    params.set("client_secret", decrypt(config.secret));
  } else
    headers.Authorization =
      "Basic " +
      Buffer.from(`${config.clientId}:${decrypt(config.secret)}`).toString(
        "base64",
      );
  const response = await fetch(
    config.provider === "salesforce"
      ? salesforceHost(config.loginUrl, true) + "/services/oauth2/token"
      : CC_AUTH + "/token",
    {
      method: "POST",
      headers,
      body: params,
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
      redirect: "error",
    },
  );
  if (!response.ok)
    throw new AppError(
      "Authorization could not be refreshed or completed. Check your app credentials and callback URL, then reconnect.",
      409,
    );
  const data = await response.json();
  if (typeof data.access_token !== "string")
    throw new AppError("The provider did not return an access token.", 502);
  return data;
}
async function identity(
  provider: Provider,
  accessToken: string,
  instanceUrl: string,
) {
  const url =
    provider === "salesforce"
      ? salesforceHost(instanceUrl) + "/services/oauth2/userinfo"
      : "https://api.cc.email/v3/account/summary";
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    throw new AppError(
      "Could not verify the connected account. Check the required scopes and account permissions.",
      409,
    );
  const data = await response.json();
  const id =
    provider === "salesforce" ? data.organization_id : data.encoded_account_id;
  if (!id)
    throw new AppError(
      "The provider did not return a stable account identity.",
      502,
    );
  return {
    externalId: String(id),
    label:
      provider === "salesforce"
        ? data.preferred_username || data.email || "Salesforce org"
        : data.organization_name ||
          data.contact_email ||
          "Constant Contact account",
  };
}
export async function finishOAuth(
  provider: Provider,
  userId: string,
  state: string,
  code: string,
) {
  const attempt = await db.oAuthAttempt.findUnique({
    where: { id: hash(state) },
  });
  if (
    !attempt ||
    attempt.userId !== userId ||
    attempt.provider !== provider ||
    attempt.expiresAt < new Date()
  )
    throw new AppError(
      "This connection request expired. Start again from Connections.",
      400,
    );
  const consumed = await db.oAuthAttempt.deleteMany({
    where: { id: attempt.id },
  });
  if (!consumed.count)
    throw new AppError("This connection request was already used.", 400);
  const config = await connection(provider);
  if (config.version !== attempt.connectionVersion)
    throw new AppError(
      "Connection settings changed. Start authorization again.",
      409,
    );
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(provider),
  });
  if (provider === "salesforce")
    params.set("code_verifier", decrypt(attempt.verifier));
  const data = await tokenRequest(config, params);
  const instanceUrl =
    provider === "salesforce"
      ? salesforceHost(data.instance_url)
      : "https://api.cc.email";
  const account = await identity(provider, data.access_token, instanceUrl);
  if (config.externalId && config.externalId !== account.externalId)
    throw new AppError(
      "This is a different account. Disconnect the current account before switching.",
      409,
    );
  if (!data.refresh_token)
    throw new AppError(
      "No refresh token was granted. Enable offline access and authorize again.",
      409,
    );
  const updated = await db.connection.updateMany({
    where: { provider, version: config.version },
    data: {
      ...account,
      instanceUrl,
      tokens: encrypt(
        JSON.stringify({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
        }),
      ),
      expiresAt: new Date(Date.now() + (data.expires_in || 7200) * 1000),
      checkedAt: new Date(),
      error: null,
    },
  });
  if (!updated.count)
    throw new AppError(
      "Settings changed during authorization. Please reconnect.",
      409,
    );
}
async function credentials(
  provider: Provider,
  force = false,
  failedAccessToken?: string,
): Promise<{ config: Connection; tokens: Tokens }> {
  let config = await connection(provider);
  if (!config.tokens)
    throw new AppError(
      `Connect ${provider === "salesforce" ? "Salesforce" : "Constant Contact"} in Connections first.`,
      409,
    );
  let tokens: Tokens = JSON.parse(decrypt(config.tokens));
  if (failedAccessToken && tokens.accessToken !== failedAccessToken)
    return { config, tokens };
  if (
    !force &&
    config.expiresAt &&
    config.expiresAt.getTime() > Date.now() + 60000
  )
    return { config, tokens };
  for (let i = 0; i < 40; i++) {
    const version = config.version,
      lease = new Date(Date.now() + 40000);
    const lock = await db.connection.updateMany({
      where: {
        provider,
        version,
        OR: [
          { refreshLeaseUntil: null },
          { refreshLeaseUntil: { lt: new Date() } },
        ],
      },
      data: { refreshLeaseUntil: lease },
    });
    if (lock.count) {
      try {
        config = await connection(provider);
        if (!config.tokens || config.version !== version)
          throw new AppError("The account connection changed.", 409);
        const latest: Tokens = JSON.parse(decrypt(config.tokens));
        if (latest.accessToken !== tokens.accessToken)
          return { config, tokens: latest };
        const data = await tokenRequest(
          config,
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: latest.refreshToken,
          }),
        );
        tokens = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || latest.refreshToken,
        };
        const instanceUrl =
          provider === "salesforce" && data.instance_url
            ? salesforceHost(data.instance_url)
            : config.instanceUrl;
        const result = await db.connection.updateMany({
          where: {
            provider,
            version,
            refreshLeaseUntil: lease,
            tokens: config.tokens,
          },
          data: {
            tokens: encrypt(JSON.stringify(tokens)),
            instanceUrl,
            expiresAt: new Date(Date.now() + (data.expires_in || 7200) * 1000),
            error: null,
          },
        });
        if (!result.count)
          throw new AppError(
            "Connection changed during refresh. Retry the request.",
            409,
          );
        return { config: { ...config, instanceUrl }, tokens };
      } catch (error) {
        await db.connection.updateMany({
          where: { provider, version, refreshLeaseUntil: lease },
          data: {
            error:
              "Connection needs attention. Reconnect if requests continue to fail.",
          },
        });
        throw error;
      } finally {
        await db.connection.updateMany({
          where: { provider, version, refreshLeaseUntil: lease },
          data: { refreshLeaseUntil: null },
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    config = await connection(provider);
    if (!config.tokens) throw new AppError("Account disconnected.", 409);
    const latest: Tokens = JSON.parse(decrypt(config.tokens));
    if (latest.accessToken !== tokens.accessToken)
      return { config, tokens: latest };
  }
  throw new AppError(
    "Another request is refreshing this connection. Try again shortly.",
    409,
  );
}
export async function providerRequest(
  provider: Provider,
  path: string,
  init: RequestInit = {},
) {
  let current = await credentials(provider);
  for (let attempt = 0; attempt < 2; attempt++) {
    const base =
      provider === "salesforce"
        ? salesforceHost(current.config.instanceUrl!)
        : "https://api.cc.email";
    const url = safeProviderPath(
      base,
      path,
      provider === "salesforce" ? "/services/data/" : "/v3/",
    );
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(provider === "salesforce"
          ? { "Sforce-Query-Options": "batchSize=200" }
          : {}),
        ...init.headers,
        Authorization: `Bearer ${current.tokens.accessToken}`,
      },
      signal: AbortSignal.timeout(25000),
      cache: "no-store",
      redirect: "error",
    });
    if (response.status === 401 && attempt === 0) {
      current = await credentials(provider, true, current.tokens.accessToken);
      continue;
    }
    if (!response.ok) {
      if (response.status === 429)
        throw new AppError(
          "Provider rate limit reached. Wait a moment and resume this request.",
          429,
        );
      if (response.status === 401)
        throw new AppError(
          "Authorization expired or was revoked. Reconnect this account.",
          409,
        );
      if (response.status === 403)
        throw new AppError(
          "The connected user does not have permission for this operation.",
          403,
        );
      let code = "";
      try {
        const data = await response.json();
        code = String(
          data[0]?.errorCode || data[0]?.error_key || data.errorCode || "",
        )
          .replace(/[^a-zA-Z0-9_]/g, "")
          .slice(0, 80);
      } catch {}
      throw new AppError(
        `Provider request failed (${response.status}${code ? `, ${code}` : ""}). Check the query, selected fields, and permissions.`,
        502,
      );
    }
    return response.status === 204 ? {} : response.json();
  }
  throw new AppError("Provider request failed.", 502);
}
export async function testConnection(provider: Provider) {
  await providerRequest(
    provider,
    provider === "salesforce"
      ? `/services/data/${SF_VERSION}/limits`
      : "/v3/account/summary",
  );
  const current = await credentials(provider);
  const info = await identity(
    provider,
    current.tokens.accessToken,
    current.config.instanceUrl!,
  );
  if (info.externalId !== current.config.externalId)
    throw new AppError("The account identity changed. Reconnect.", 409);
  await db.connection.updateMany({
    where: { provider, version: current.config.version },
    data: { checkedAt: new Date(), error: null },
  });
  return info;
}
export async function sfQuery(query: string, cursor?: string | null) {
  return providerRequest(
    "salesforce",
    cursor ||
      `/services/data/${SF_VERSION}/query?q=${encodeURIComponent(query)}`,
  );
}
