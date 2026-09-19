"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Unplug,
} from "lucide-react";
import {
  api,
  Badge,
  Button,
  Copy,
  date,
  Heading,
  Loading,
  Notice,
} from "./common";
type Connection = {
  provider: string;
  clientId: string;
  hasSecret: boolean;
  loginUrl: string;
  connected: boolean;
  label?: string;
  externalId?: string;
  instanceUrl?: string;
  checkedAt?: string;
  error?: string;
  callbackUrl: string;
};
export function Connections() {
  const [rows, setRows] = useState<Connection[] | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = () =>
    api("connections")
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    setError(params.get("error") || "");
    if (params.has("connected"))
      setMessage(
        "Account connected. You can now browse its lists and sources.",
      );
    window.history.replaceState(null, "", "/connections");
  }, []);
  return (
    <>
      <Heading
        eyebrow="YOUR INTEGRATIONS"
        title="Make the connection."
        description="Connect your accounts once. Build your audiences from here."
      />
      <Notice message={error} />
      <Notice message={message} success />
      {!rows ? (
        <Loading />
      ) : (
        <div className="connection-grid">
          {rows.map((row) => (
            <ConnectionCard key={row.provider} row={row} refresh={load} />
          ))}
        </div>
      )}
      <div className="info-strip">
        <KeyRound size={19} />
        <div>
          <strong>Your credentials stay protected.</strong>
          <p>
            Application secrets and authorization tokens are encrypted. Only
            your signed-in workspace can access these connections.
          </p>
        </div>
      </div>
    </>
  );
}
function ConnectionCard({
  row,
  refresh,
}: {
  row: Connection;
  refresh: () => Promise<void>;
}) {
  const sf = row.provider === "salesforce";
  const [clientId, setClientId] = useState(row.clientId),
    [secret, setSecret] = useState(""),
    [loginUrl, setLoginUrl] = useState(row.loginUrl),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    setClientId(row.clientId);
    setLoginUrl(row.loginUrl);
  }, [row.clientId, row.loginUrl]);
  async function action(name: string, fn: () => Promise<any>) {
    setBusy(name);
    setError("");
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="card connection-card">
      <div className="connection-card-top">
        <span className={`provider-logo ${row.provider}`}>
          {sf ? "sf" : "cc"}
        </span>
        <Badge tone={row.connected ? "green" : ""}>
          {row.connected
            ? "Connected"
            : row.hasSecret
              ? "Ready to authorize"
              : "Not connected"}
        </Badge>
      </div>
      <h2>{sf ? "Salesforce" : "Constant Contact"}</h2>
      <p className="card-description">
        {sf
          ? "Your contacts, relationships, and audience criteria."
          : "Your destination lists and contact field catalog."}
      </p>
      <Notice message={error || row.error || ""} />
      <Notice message={message} success />
      {row.connected ? (
        <div className="connected-details">
          <span className="connected-check">
            <Check size={18} /> Account authorized
          </span>
          <strong>{row.label}</strong>
          <code>{row.externalId}</code>
          {row.instanceUrl && <small>{row.instanceUrl}</small>}
          <small>Last verified {date(row.checkedAt)}</small>
          <div className="button-row">
            <Button
              variant="secondary"
              busy={busy === "test"}
              disabled={!!busy}
              onClick={() =>
                action("test", async () => {
                  await api(`connections/${row.provider}/test`, "POST");
                  setMessage("Connection verified.");
                })
              }
            >
              <RefreshCw size={16} />
              Test connection
            </Button>
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() =>
                action("disconnect", () =>
                  api(`connections/${row.provider}`, "DELETE"),
                )
              }
            >
              <Unplug size={16} />
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <>
          <details className="setup-guide" open={!row.hasSecret}>
            <summary>
              Application setup instructions <ExternalLink size={13} />
            </summary>
            <ol>
              {sf ? (
                <>
                  <li>
                    In production Salesforce Setup, create an{" "}
                    <strong>External Client App</strong>.
                  </li>
                  <li>
                    Add the callback below. Enable OAuth with the{" "}
                    <strong>api</strong>, <strong>openid</strong>, and{" "}
                    <strong>refresh_token / offline_access</strong> scopes.
                  </li>
                  <li>
                    Leave every <strong>Flow Enablement</strong> option off. In{" "}
                    <strong>Security</strong>, require the secret for Web Server
                    and Refresh Token flows, require PKCE, and enable Refresh
                    Token Rotation. Leave JWT access tokens and the
                    refresh-token IP allowlist off.
                  </li>
                  <li>
                    Create the app. In <strong>Policies</strong>, choose{" "}
                    <strong>Admin approved users are pre-authorized</strong> and
                    assign the permission set for your integration user.
                  </li>
                  <li>
                    Copy the consumer key and secret here, then authorize a user
                    with API access and read access to the required contacts,
                    related objects, fields, reports, and report folders.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    Create an app in the{" "}
                    <a
                      href="https://app.constantcontact.com/pages/dma/portal/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Constant Contact developer portal
                    </a>
                    .
                  </li>
                  <li>
                    Add the callback below and copy its API key and client
                    secret here.
                  </li>
                  <li>
                    Authorize the account with contacts, account-read, and
                    offline access. New private apps must be authorized by their
                    creator.
                  </li>
                </>
              )}
            </ol>
          </details>
          <div className="callback">
            <small>OAUTH CALLBACK URL</small>
            <div>
              <code>{row.callbackUrl}</code>
              <Copy value={row.callbackUrl} />
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action("save", async () => {
                await api(`connections/${row.provider}`, "PUT", {
                  clientId,
                  clientSecret: secret || undefined,
                  loginUrl,
                });
                setSecret("");
                setMessage("Credentials saved. Connect your account below.");
              });
            }}
          >
            {sf && (
              <label>
                Salesforce login URL
                <input
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                  required
                  placeholder="https://login.salesforce.com"
                />
                <small>
                  Use production, your My Domain, or https://test.salesforce.com
                  for a sandbox.
                </small>
              </label>
            )}
            <label>
              {sf ? "Consumer key" : "API key / client ID"}
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                autoComplete="off"
              />
            </label>
            <label>
              Client secret
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required={!row.hasSecret}
                autoComplete="new-password"
                placeholder={
                  row.hasSecret ? "Saved securely · leave blank to keep" : ""
                }
              />
            </label>
            <div className="button-row">
              <Button
                type="submit"
                variant="secondary"
                busy={busy === "save"}
                disabled={!!busy}
              >
                Save credentials
              </Button>
              <Button
                type="button"
                disabled={
                  !row.hasSecret ||
                  !!busy ||
                  clientId !== row.clientId ||
                  loginUrl !== row.loginUrl ||
                  !!secret
                }
                busy={busy === "connect"}
                onClick={() =>
                  action("connect", async () => {
                    const data = await api(
                      `oauth/${row.provider}/start`,
                      "POST",
                    );
                    window.location.assign(data.url);
                  })
                }
              >
                Connect account
                <ArrowUpRight size={16} />
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
