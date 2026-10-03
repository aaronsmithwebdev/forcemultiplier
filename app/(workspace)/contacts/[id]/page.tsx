import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Database,
  Mail,
  Send,
  UsersRound,
} from "lucide-react";
import { Badge, Copy, Empty, Heading } from "@/components/common";
import { displayContactValue, getContactDetail } from "@/lib/contacts";

const shownAt = (value: Date | null | undefined) =>
  value ? value.toLocaleString() : "—";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = await getContactDetail(id);
  if (!contact) notFound();

  const currentAudiences = contact.audiences.filter((row) => row.current);
  const sentCampaigns = contact.campaigns.filter(
    (row) => row.send.status === "sent" && row.status === "submitted",
  );
  const backAudience = currentAudiences[0] ?? contact.audiences[0];
  const suppressed = Boolean(contact.currentSuppression || contact.optedOut);

  return (
    <div className="contact-detail-page">
      <Link
        className="back-link"
        href={backAudience ? `/audiences/${backAudience.id}` : "/audiences"}
      >
        <ArrowLeft size={15} />
        {backAudience ? `Back to ${backAudience.name}` : "Back to audiences"}
      </Link>
      <Heading
        title={contact.name}
        action={
          contact.salesforceUrl ? (
            <a
              className="button secondary"
              href={contact.salesforceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in Salesforce <ArrowUpRight size={15} />
            </a>
          ) : undefined
        }
      />

      <div className="stats-grid contact-stats">
        <div className="stat-card">
          <span>
            <Send size={18} /> Campaign sends
          </span>
          <strong>{sentCampaigns.length}</strong>
          <small>{contact.campaigns.length} total campaign selections</small>
        </div>
        <div className="stat-card">
          <span>
            <UsersRound size={18} /> Current audiences
          </span>
          <strong>{currentAudiences.length}</strong>
          <small>{contact.audiences.length} current and historical</small>
        </div>
        <div className="stat-card">
          <span>
            <Database size={18} /> Saved fields
          </span>
          <strong>{contact.fields.length}</strong>
          <small>Newest captured Salesforce values</small>
        </div>
        <div className="stat-card">
          <span>
            <Mail size={18} /> Email status
          </span>
          <strong className="contact-status-value">
            {suppressed ? "Suppressed" : "Eligible"}
          </strong>
          <small>
            {contact.optedOut
              ? "Opted out in Salesforce"
              : contact.currentSuppression
                ? contact.currentSuppression.kind.replaceAll("_", " ")
                : "No recorded opt-out"}
          </small>
        </div>
      </div>

      <div className="contact-overview-grid">
        <section className="card contact-panel">
          <div className="section-toolbar">
            <div>
              <h2>Identity</h2>
              <p>Durable Salesforce identity and latest contact details.</p>
            </div>
          </div>
          <dl className="contact-facts">
            <div>
              <dt>Salesforce Contact ID</dt>
              <dd>
                <code>{contact.salesforceId}</code>
                <Copy value={contact.salesforceId} />
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{contact.email || "—"}</dd>
            </div>
            <div>
              <dt>Salesforce org ID</dt>
              <dd>
                <code>{contact.orgId}</code>
              </dd>
            </div>
            <div>
              <dt>First saved</dt>
              <dd>{shownAt(contact.firstSeenAt)}</dd>
            </div>
            <div>
              <dt>Latest snapshot</dt>
              <dd>{shownAt(contact.capturedAt)}</dd>
            </div>
            <div>
              <dt>Known email addresses</dt>
              <dd>{contact.historicalEmails.join(", ") || "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="card contact-panel">
          <div className="section-toolbar">
            <div>
              <h2>Consent and delivery</h2>
              <p>Current snapshot plus the local suppression ledger.</p>
            </div>
          </div>
          <dl className="contact-facts">
            <div>
              <dt>Salesforce email opt-out</dt>
              <dd>
                <Badge tone={contact.optedOut ? "amber" : "green"}>
                  {contact.optedOut ? "Opted out" : "Not opted out"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>ForceMultiplier suppression</dt>
              <dd>
                <Badge tone={contact.currentSuppression ? "amber" : "green"}>
                  {contact.currentSuppression
                    ? contact.currentSuppression.kind.replaceAll("_", " ")
                    : "No active suppression"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Suppression source</dt>
              <dd>{contact.currentSuppression?.source || "—"}</dd>
            </div>
            <div>
              <dt>Suppression recorded</dt>
              <dd>{shownAt(contact.currentSuppression?.createdAt)}</dd>
            </div>
          </dl>
          <p className="contact-panel-note">
            Open and click metrics are not shown because ForceMultiplier does
            not yet ingest those Resend delivery events.
          </p>
        </section>
      </div>

      <section className="card contact-section">
        <div className="section-toolbar">
          <div>
            <h2>Salesforce fields</h2>
            <p>
              Most recently captured value for every selected audience field.
            </p>
          </div>
        </div>
        {!contact.fields.length ? (
          <Empty
            title="No additional fields saved"
            description="Add Salesforce fields to an audience and pull it again to capture values here."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                  <th>Source audience</th>
                  <th>Captured</th>
                </tr>
              </thead>
              <tbody>
                {contact.fields.map((field) => (
                  <tr key={field.field}>
                    <td>
                      <code>{field.field}</code>
                    </td>
                    <td className="contact-value">
                      {displayContactValue(field.value)}
                    </td>
                    <td>
                      <Link href={`/audiences/${field.audience.id}`}>
                        {field.audience.name}
                      </Link>
                    </td>
                    <td>{shownAt(field.capturedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card contact-section">
        <div className="section-toolbar">
          <div>
            <h2>Campaign history</h2>
            <p>Every campaign where this Salesforce Contact was selected.</p>
          </div>
        </div>
        {!contact.campaigns.length ? (
          <Empty
            title="No campaign history"
            description="Campaign selections and sends will appear here."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Type</th>
                  <th>Recipient status</th>
                  <th>Send status</th>
                  <th>Sent / finished</th>
                  <th>Provider reference</th>
                </tr>
              </thead>
              <tbody>
                {contact.campaigns.map((recipient) => (
                  <tr key={recipient.sendId}>
                    <td>
                      <Link href={`/campaigns/${recipient.send.campaign.id}`}>
                        <strong>{recipient.send.campaign.name}</strong>
                      </Link>
                      <small className="block muted">
                        {recipient.send.subject || "No subject"}
                      </small>
                    </td>
                    <td>
                      {recipient.send.serviceNotice
                        ? "Service notice"
                        : "Marketing"}
                    </td>
                    <td>
                      <Badge
                        tone={recipient.status === "submitted" ? "green" : ""}
                      >
                        {recipient.status}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        tone={recipient.send.status === "sent" ? "green" : ""}
                      >
                        {recipient.send.status}
                      </Badge>
                    </td>
                    <td>
                      {shownAt(
                        recipient.send.finishedAt ?? recipient.send.updatedAt,
                      )}
                    </td>
                    <td>
                      <code>
                        {recipient.providerEmailId ||
                          recipient.messageId ||
                          recipient.send.id}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="contact-overview-grid contact-history-grid">
        <section className="card contact-panel">
          <div className="section-toolbar">
            <div>
              <h2>Audience membership</h2>
              <p>Current membership and audiences previously matched.</p>
            </div>
          </div>
          <div className="contact-list">
            {contact.audiences.map((audience) => (
              <Link key={audience.id} href={`/audiences/${audience.id}`}>
                <span>
                  <strong>{audience.name}</strong>
                  <small>Last matched {shownAt(audience.lastSeenAt)}</small>
                </span>
                <Badge tone={audience.current ? "green" : ""}>
                  {audience.current ? "Current" : "Historical"}
                </Badge>
              </Link>
            ))}
          </div>
        </section>

        <section className="card contact-panel">
          <div className="section-toolbar">
            <div>
              <h2>Operational activity</h2>
              <p>Consent, delivery issues, and resubscription results.</p>
            </div>
          </div>
          {!contact.activity.length ? (
            <div className="contact-panel-empty">No activity recorded.</div>
          ) : (
            <div className="contact-list contact-activity-list">
              {contact.activity.map((item) => (
                <div key={item.id}>
                  <CalendarDays size={15} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.type} · {item.detail} · {shownAt(item.at)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
