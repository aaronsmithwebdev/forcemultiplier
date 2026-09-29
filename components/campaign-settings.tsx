"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, AtSign, CircleHelp, Mail } from "lucide-react";
import { api, Badge, Button, Loading, Notice } from "./common";
import { CampaignSteps } from "./campaign-steps";
import { FooterPreview } from "./footer-preview";

type Settings = {
  name: string;
  subject: string;
  preheader: string;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  serviceNotice: boolean;
  footerId: string;
};
type ResendDomain = { name: string; status: string; sending: boolean };
type Footer = {
  id: string;
  name: string;
  previewHtml: string;
  isDefault: boolean;
};
const senders = [
  {
    id: "bloody-long-walk",
    label: "The Bloody Long Walk",
    fromName: "The Bloody Long Walk",
    fromEmail: "bloodylongwalk@mito.org.au",
    replyToEmail: "bloodylongwalk@mito.org.au",
  },
  {
    id: "mito-foundation",
    label: "Mito Foundation",
    fromName: "Mito Foundation",
    fromEmail: "communications@mito.org.au",
    replyToEmail: "communications@mito.org.au",
  },
] as const;
const empty: Settings = {
  name: "",
  subject: "",
  preheader: "",
  fromName: "",
  fromEmail: "",
  replyToEmail: "",
  serviceNotice: false,
  footerId: "",
};

export function CampaignSettings({ id }: { id: string }) {
  const [values, setValues] = useState<Settings>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [domains, setDomains] = useState<ResendDomain[]>([]);
  const [footers, setFooters] = useState<Footer[]>([]);

  useEffect(() => {
    Promise.all([api(`campaigns/${id}`), api("footers")])
      .then(([campaign, footerRows]) => {
        setValues(campaign);
        setFooters(footerRows);
      })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
    api("resend/status")
      .then((status) =>
        setDomains(
          status.domains.filter(
            (domain: ResendDomain) =>
              domain.status === "verified" && domain.sending,
          ),
        ),
      )
      .catch(() => setDomains([]));
  }, [id]);

  function field<Key extends keyof Settings>(name: Key, value: Settings[Key]) {
    setValues((current) => ({ ...current, [name]: value }));
    setMessage("");
  }

  function chooseSender(id: string) {
    const sender = senders.find((item) => item.id === id);
    if (!sender) return;
    setValues((current) => ({
      ...current,
      fromName: sender.fromName,
      fromEmail: sender.fromEmail,
      replyToEmail: sender.replyToEmail,
    }));
    setMessage("");
  }

  async function save(goNext = false) {
    if (!values.footerId) {
      setError("Choose an email footer before continuing.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`campaigns/${id}`, "PATCH", values);
      if (goNext) window.location.assign(`/campaigns/${id}/preview`);
      else setMessage("Send settings saved.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  const fromDomain = values.fromEmail.split("@")[1]?.toLowerCase();
  const verifiedFrom = domains.some(
    (domain) => domain.name.toLowerCase() === fromDomain,
  );
  const selectedSender =
    senders.find((sender) => sender.fromEmail === values.fromEmail)?.id || "";
  return (
    <div className="campaign-settings-page">
      <Link href="/campaigns" className="back-link">
        <ArrowLeft size={15} /> Campaigns
      </Link>
      <CampaignSteps id={id} current="settings" />
      <Notice message={error} />
      <Notice message={message} success />
      <section className="card settings-card">
        <div className="section-toolbar">
          <div>
            <h2>Send settings</h2>
            <p>
              These inbox and sender details follow the same core setup used by
              Constant Contact.
            </p>
          </div>
          <span className="row-icon">
            <AtSign size={18} />
          </span>
        </div>
        <div className="settings-fields">
          <label className="wide-field">
            Sender identity
            <select
              value={selectedSender}
              onChange={(event) => chooseSender(event.target.value)}
            >
              <option value="" disabled>
                Choose a sender identity
              </option>
              {senders.map((sender) => (
                <option key={sender.id} value={sender.id}>
                  {sender.label} · {sender.fromEmail}
                </option>
              ))}
            </select>
            <small>
              Choosing a brand fills the sender and reply-to fields below; they
              remain editable.
            </small>
          </label>
          <label>
            Campaign name
            <input
              required
              maxLength={120}
              value={values.name}
              onChange={(event) => field("name", event.target.value)}
            />
            <small>Internal only; recipients do not see this.</small>
          </label>
          <label>
            Subject line
            <input
              required
              maxLength={500}
              value={values.subject}
              onChange={(event) => field("subject", event.target.value)}
              placeholder="What recipients see in their inbox"
            />
          </label>
          <label className="wide-field">
            Preheader
            <input
              maxLength={200}
              value={values.preheader}
              onChange={(event) => field("preheader", event.target.value)}
              placeholder="Preview text shown after the subject line"
            />
            <small>
              {values.preheader.length}/200 · Saved into the Templatical email
              so it is included in rendered HTML.
            </small>
          </label>
          <label>
            From name
            <input
              required
              maxLength={100}
              value={values.fromName}
              onChange={(event) => field("fromName", event.target.value)}
              placeholder="Organisation or team name"
            />
          </label>
          <label>
            From email
            <input
              required
              type="email"
              maxLength={254}
              value={values.fromEmail}
              onChange={(event) => field("fromEmail", event.target.value)}
              placeholder="news@verified-domain.org"
            />
            <small>
              {domains.length
                ? `${verifiedFrom ? "Verified" : "Use a verified domain"}: ${domains.map((domain) => domain.name).join(", ")}`
                : "No verified sending domain was returned by Resend."}
            </small>
          </label>
          <label>
            Reply-to email
            <input
              required
              type="email"
              maxLength={254}
              value={values.replyToEmail}
              onChange={(event) => field("replyToEmail", event.target.value)}
              placeholder="team@example.org"
            />
          </label>
          <div className="service-notice-setting wide-field">
            <div>
              <span>
                Service notice
                <span
                  className="setting-tooltip"
                  title="This may send service emails to people who have unsubscribed from marketing. Use only for essential, non-promotional information."
                  data-tooltip="This may send service emails to people who have unsubscribed from marketing. Use only for essential, non-promotional information."
                  aria-label="This may send service emails to people who have unsubscribed from marketing. Use only for essential, non-promotional information."
                  tabIndex={0}
                >
                  <CircleHelp size={15} />
                </span>
              </span>
              <small>
                Send essential, non-promotional information outside marketing
                subscription preferences.
              </small>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                role="switch"
                checked={values.serviceNotice}
                onChange={(event) =>
                  field("serviceNotice", event.target.checked)
                }
                aria-label="Send as a service notice"
              />
              <span aria-hidden="true" />
            </label>
          </div>
          <fieldset className="campaign-footer-field wide-field">
            <legend>Email footer</legend>
            <p>
              Required on every send. The selected footer is saved with the
              send, so later footer edits cannot change sent campaigns.
            </p>
            {!footers.length ? (
              <div className="footer-required-empty">
                No footers are available. Create a default in Email footers
                before sending. <Link href="/footers">Open Email footers</Link>
              </div>
            ) : (
              <div className="campaign-footer-options">
                {footers.map((footer) => (
                  <label
                    className={`campaign-footer-option ${values.footerId === footer.id ? "selected" : ""}`}
                    key={footer.id}
                  >
                    <input
                      type="radio"
                      name="footerId"
                      value={footer.id}
                      checked={values.footerId === footer.id}
                      onChange={() => field("footerId", footer.id)}
                    />
                    <FooterPreview
                      html={footer.previewHtml}
                      title={`${footer.name} footer thumbnail`}
                      className="footer-thumbnail"
                    />
                    <span>
                      <strong>{footer.name}</strong>
                      {footer.isDefault && <Badge tone="green">Default</Badge>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>
        <div className="settings-actions">
          <Link className="button secondary" href={`/campaigns/${id}/design`}>
            <ArrowLeft size={16} /> Design email
          </Link>
          <div>
            <Button variant="secondary" busy={busy} onClick={() => void save()}>
              Save settings
            </Button>
            <Button busy={busy} onClick={() => void save(true)}>
              Save and review <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </section>
      <div className="settings-note">
        <Mail size={18} />
        <p>
          <strong>Review before sending.</strong> The next step lets you preview
          desktop and mobile, send yourself a test, then choose included and
          excluded audiences for the production send.
        </p>
      </div>
    </div>
  );
}
