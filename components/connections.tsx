"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  KeyRound,
  Play,
  RefreshCw,
  ShieldCheck,
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
  writeback?: {
    enabled: boolean;
    field: string;
    scanning?: boolean;
    lastRunAt?: string;
    lastCompletedAt?: string;
    error?: string;
    counts: Record<string, number>;
    recent?: {
      contactId: string;
      email: string;
      optOutAt: string;
      status: string;
      salesforceId?: string;
      error?: string;
    }[];
  };
};
type ResendStatus = {
  configured: boolean;
  domains: { name: string; status: string; sending: boolean }[];
  hasMore: boolean;
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
        "Account authorized. Check campaign access below if you reauthorized Constant Contact.",
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
          <ResendCard />
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
function ResendCard() {
  const [status, setStatus] = useState<ResendStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    setError("");
    try {
      setStatus(await api("resend/status"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void check();
  }, []);
  return (
    <section className="card connection-card">
      <div className="connection-card-top">
        <span className="provider-logo resend">re</span>
        <Badge
          tone={
            status?.domains.some(
              (domain) => domain.status === "verified" && domain.sending,
            )
              ? "green"
              : ""
          }
        >
          {error
            ? "Check failed"
            : status?.configured
              ? "Key configured"
              : "Not configured"}
        </Badge>
      </div>
      <h2>Resend</h2>
      <p className="card-description">
        The future sending service. This check only reads domain status.
      </p>
      <Notice message={error} />
      {!status && !error ? <Loading /> : null}
      {status?.configured ? (
        <div className="connected-details">
          {status.domains.length ? (
            status.domains.map((domain) => (
              <p key={domain.name}>
                <strong>{domain.name}</strong> · {domain.status} · sending{" "}
                {domain.sending ? "enabled" : "disabled"}
              </p>
            ))
          ) : (
            <p>No sending domains are configured in Resend.</p>
          )}
          {status.hasMore && (
            <small>More domains are available in the Resend dashboard.</small>
          )}
          <Button variant="secondary" busy={busy} onClick={() => void check()}>
            <RefreshCw size={16} /> Check again
          </Button>
        </div>
      ) : (
        <div className="connected-details">
          {status && (
            <p>
              Create a Resend Full access API key, then set{" "}
              <code>RESEND_API_KEY</code> in your local and Vercel environment
              variables.
            </p>
          )}
          <Button variant="secondary" busy={busy} onClick={() => void check()}>
            <RefreshCw size={16} /> Check connection
          </Button>
        </div>
      )}
    </section>
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
    [includeExisting, setIncludeExisting] = useState(false),
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
  async function authorize() {
    const data = await api(`oauth/${row.provider}/start`, "POST");
    window.location.assign(data.url);
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
            {!sf && (
              <>
                <Button
                  variant="secondary"
                  busy={busy === "campaign"}
                  disabled={!!busy}
                  onClick={() =>
                    action("campaign", async () => {
                      await api("constant-contact/campaign-access");
                      setMessage("Campaign access verified.");
                    })
                  }
                >
                  Check campaign access
                </Button>
                <Button
                  variant="secondary"
                  busy={busy === "reauthorize"}
                  disabled={!!busy}
                  onClick={() => action("reauthorize", authorize)}
                >
                  Reauthorize <ArrowUpRight size={16} />
                </Button>
              </>
            )}
          </div>
          {sf && row.writeback && (
            <div className="writeback-settings">
              <div className="writeback-title">
                <span>
                  <ShieldCheck size={17} />
                  <strong>Unsubscribe writeback</strong>
                </span>
                <Badge tone={row.writeback.enabled ? "green" : ""}>
                  {row.writeback.enabled ? "Active" : "Off"}
                </Badge>
              </div>
              <p>
                Sets <code>{row.writeback.field}</code> to true for Constant
                Contact unsubscribes previously sent by ForceMultiplier. It
                never clears an opt-out.
              </p>
              <Notice message={row.writeback.error || ""} />
              {row.writeback.enabled ? (
                <>
                  <small>
                    Last checked {date(row.writeback.lastRunAt)} · Last complete
                    scan {date(row.writeback.lastCompletedAt)}
                  </small>
                  <div className="writeback-counts">
                    <span>
                      <strong>
                        {(row.writeback.counts.written || 0) +
                          (row.writeback.counts.already_opted_out || 0)}
                      </strong>
                      updated or already opted out
                    </span>
                    <span>
                      <strong>{row.writeback.counts.pending || 0}</strong>
                      pending
                    </span>
                    <span>
                      <strong>
                        {(row.writeback.counts.failed || 0) +
                          (row.writeback.counts.unmatched || 0) +
                          (row.writeback.counts.ambiguous || 0)}
                      </strong>
                      needs review
                    </span>
                  </div>
                  <div className="button-row">
                    <Button
                      variant="secondary"
                      busy={busy === "writeback-run"}
                      disabled={!!busy}
                      onClick={() =>
                        action("writeback-run", async () => {
                          await api("unsubscribe-sync/run", "POST");
                          setMessage("Unsubscribe check completed.");
                        })
                      }
                    >
                      <Play size={15} /> Run now
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() =>
                        action("writeback-retry", async () => {
                          const result = await api(
                            "unsubscribe-sync/retry",
                            "POST",
                          );
                          setMessage(
                            `${result.retried} unresolved unsubscribe${result.retried === 1 ? "" : "s"} queued to retry.`,
                          );
                        })
                      }
                    >
                      Retry unresolved
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() =>
                        action("writeback-disable", () =>
                          api("unsubscribe-sync", "PUT", { enabled: false }),
                        )
                      }
                    >
                      Turn off
                    </Button>
                  </div>
                  {!!row.writeback.recent?.length && (
                    <details className="writeback-events">
                      <summary>Recent unsubscribe results</summary>
                      {row.writeback.recent.map((event) => (
                        <p key={event.contactId}>
                          <span>{event.email}</span>
                          <Badge
                            tone={
                              ["written", "already_opted_out"].includes(
                                event.status,
                              )
                                ? "green"
                                : event.status === "pending"
                                  ? ""
                                  : "amber"
                            }
                          >
                            {event.status.replaceAll("_", " ")}
                          </Badge>
                          {event.error && <small>{event.error}</small>}
                        </p>
                      ))}
                    </details>
                  )}
                </>
              ) : (
                <>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={includeExisting}
                      onChange={(event) =>
                        setIncludeExisting(event.target.checked)
                      }
                    />
                    Include existing Constant Contact unsubscribes
                  </label>
                  <Button
                    variant="secondary"
                    busy={busy === "writeback-enable"}
                    disabled={!!busy}
                    onClick={() =>
                      action("writeback-enable", async () => {
                        await api("unsubscribe-sync", "PUT", {
                          enabled: true,
                          includeExisting,
                        });
                        setMessage(
                          "Unsubscribe writeback enabled. It will check every five minutes.",
                        );
                      })
                    }
                  >
                    Enable writeback
                  </Button>
                </>
              )}
            </div>
          )}
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
                    Authorize the account with contacts, campaigns,
                    account-read, and offline access. The user needs campaign
                    read permission. New private apps must be authorized by
                    their creator.
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
                onClick={() => action("connect", authorize)}
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
