"use client";
import { useState } from "react";
import { api, Button, Notice } from "./common";
export function PersonSalesforceLink({ id }: { id: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function check() {
    setBusy(true);
    setError("");
    try {
      setRows(await api(`contacts/${id}/salesforce-link`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function link(salesforceId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`contacts/${id}/salesforce-link`, "POST", {
        salesforceId,
        confirmed: true,
      });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card contact-panel">
      <h2>Link to Salesforce</h2>
      <p>
        Review Contacts with the same current email. Linking keeps this person’s
        ID and history, and uses Salesforce profile details.
      </p>
      <Notice message={error} />
      <Button variant="secondary" busy={busy} onClick={check}>
        Find Salesforce matches
      </Button>
      {rows && !rows.length && (
        <p>
          No current Salesforce Contact matches. This person will stay local.
        </p>
      )}
      {rows?.map((row) => (
        <div key={row.salesforceId} className="button-row">
          <span>
            {row.name || row.email} · {row.salesforceId}{" "}
            {row.optedOut ? "· Opted out" : ""}
          </span>
          <Button busy={busy} onClick={() => link(row.salesforceId)}>
            Confirm link to this Contact
          </Button>
        </div>
      ))}
    </section>
  );
}
