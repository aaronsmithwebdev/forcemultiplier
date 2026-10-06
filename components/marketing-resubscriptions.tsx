"use client";
import { useEffect, useState } from "react";
import { api, Button, date, Heading, Notice } from "./common";

type Request = {
  id: string;
  email: string;
  consentAt: string;
  source: string;
  evidence: string;
  createdBy: string;
  status: string;
  error: string | null;
  writeStartedAt: string | null;
};
export function MarketingResubscriptions() {
  const [rows, setRows] = useState<Request[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState("");
  const refresh = async () => setRows(await api("marketing-resubscriptions"));
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  async function result(row: Request) {
    setMessage(
      row.status === "completed"
        ? "Consent confirmed. Refresh the audience before including this contact in a new campaign; previously prepared campaigns are not rebuilt."
        : "The address remains blocked. Review the recorded result below. Verify result only checks provider state; it does not repeat subscription changes.",
    );
    await refresh();
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await result(
        await api("marketing-resubscriptions", "POST", {
          id,
          email: data.get("email"),
          consentAt: new Date(String(data.get("consentAt"))).toISOString(),
          source: data.get("source"),
          evidence: data.get("evidence"),
          scope: "all_workspace_marketing",
          confirmed: data.get("confirmed") === "on",
        }),
      );
      setRequestId("");
      form.reset();
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function verify(id: string, action = "verify") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await result(
        await api(`marketing-resubscriptions/${id}/${action}`, "POST"),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Marketing resubscriptions" />
      <Notice message={error} />
      <Notice message={message} success />
      <section className="card schedule-card">
        <h2>Record an explicit request</h2>
        <p>
          This restores consent for all workspace marketing, across brands, in
          ForceMultiplier, Salesforce and Resend. Record the person's actual
          request and retain its evidence. A donation, registration, imported
          list or cleared checkbox is not a resubscription request.
        </p>
        <p>
          The address stays blocked until both providers are verified. Bounce,
          complaint and other delivery blocks remain in place. No confirmation
          email is sent by this form.
        </p>
        <form onSubmit={submit}>
          <fieldset disabled={busy} className="resubscribe-fields">
            <div className="schedule-fields">
              <label>
                Email address
                <input name="email" type="email" required maxLength={254} />
              </label>
              <label>
                When the person gave consent (your local time)
                <input
                  name="consentAt"
                  type="datetime-local"
                  step="1"
                  required
                />
              </label>
              <label>
                Consent source
                <input
                  name="source"
                  required
                  minLength={3}
                  maxLength={200}
                  placeholder="Email request, phone call, signed form…"
                />
              </label>
            </div>
            <label>
              Evidence and reference
              <textarea
                name="evidence"
                required
                minLength={10}
                maxLength={4000}
                placeholder="Record what they requested and where the original evidence is retained."
              />
            </label>
            <label>
              <input name="confirmed" type="checkbox" required /> I have
              verified that this person explicitly requested all workspace
              marketing again, after their most recent unsubscribe, and that the
              evidence supports this scope.
            </label>
            <Button busy={busy} type="submit">
              Record and reconcile consent
            </Button>
          </fieldset>
        </form>
      </section>
      <section className="card">
        <h2>Recent consent requests</h2>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => refresh().catch((e) => setError(e.message))}
        >
          Refresh results
        </Button>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Consent and evidence</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.email}</td>
                  <td>
                    {date(row.consentAt)} · {row.source}
                    <details>
                      <summary>Audit evidence</summary>
                      <p>{row.evidence}</p>
                      <p>Recorded by {row.createdBy}</p>
                      <p>Scope: all workspace marketing</p>
                    </details>
                  </td>
                  <td>
                    {row.status.replaceAll("_", " ")}
                    <p>{row.error}</p>
                    {row.status !== "completed" && !row.writeStartedAt && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => verify(row.id, "retry")}
                      >
                        Retry checks and reconcile
                      </Button>
                    )}
                    {row.status !== "completed" && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => verify(row.id)}
                      >
                        Verify result
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
