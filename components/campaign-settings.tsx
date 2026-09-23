"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, AtSign, Mail } from "lucide-react";
import { api, Button, Loading, Notice } from "./common";
import { CampaignSteps } from "./campaign-steps";

type Settings = {
  name: string;
  subject: string;
  preheader: string;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
};
type ResendDomain = { name: string; status: string; sending: boolean };
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
};

export function CampaignSettings({ id }: { id: string }) {
  const [values, setValues] = useState<Settings>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [domains, setDomains] = useState<ResendDomain[]>([]);

  useEffect(() => {
    api(`campaigns/${id}`)
      .then((campaign) => setValues(campaign))
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

  function field(name: keyof Settings, value: string) {
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
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`campaigns/${id}`, "PATCH", values);
      if (goNext) window.location.assign(`/campaigns/${id}/preview`);
      else setMessage("Email settings saved.");
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
            <h2>Email settings</h2>
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
              Save and preview <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </section>
      <div className="settings-note">
        <Mail size={18} />
        <p>
          <strong>Test before audience selection.</strong> The next step can
          send only to your signed-in email address. Production audience sends
          are not enabled in this draft milestone.
        </p>
      </div>
    </div>
  );
}
