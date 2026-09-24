"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileUp, Send, Users, XCircle } from "lucide-react";
import { api, Button, Loading, Notice, date } from "./common";

type Audience = {
  id: string;
  name: string;
  snapshot: null | { processed: number; finishedAt: string };
};
type Counts = {
  source: number;
  duplicates: number;
  optedOut: number;
  excluded: number;
  suppressed: number;
  recipients: number;
};
type SendState = {
  id: string;
  status: string;
  counts: Partial<Counts>;
  error: string | null;
  finishedAt: string | null;
};
type Review = {
  audienceIds: string[];
  exclusionAudienceIds: string[];
  manualExclusions: string[];
  audiences: Audience[];
  send: SendState | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const working = new Set(["pending", "importing", "ready"]);

function parseEmails(value: string) {
  const tokens = value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = tokens.filter((item) => !emailPattern.test(item));
  return {
    emails: [
      ...new Set(
        tokens
          .filter((item) => emailPattern.test(item))
          .map((item) => item.toLowerCase()),
      ),
    ],
    invalid,
  };
}

export function CampaignRecipients({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [included, setIncluded] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [counting, setCounting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const data: Review = await api(`campaigns/${id}/review`);
    setReview(data);
    setIncluded(data.audienceIds);
    setExcluded(data.exclusionAudienceIds);
    setManual(data.manualExclusions.join("\n"));
    const saved = data.send?.counts;
    if (saved && typeof saved.recipients === "number")
      setCounts(saved as Counts);
    return data;
  }, [id]);

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, [load]);

  const parsed = useMemo(() => parseEmails(manual), [manual]);
  const locked = !!review?.send;

  useEffect(() => {
    if (!review || locked || !included.length || parsed.invalid.length) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCounting(true);
      setError("");
      api(`campaigns/${id}/recipients`, "POST", {
        audienceIds: included,
        exclusionAudienceIds: excluded,
        manualExclusions: parsed.emails,
      })
        .then((next) => {
          if (!cancelled) setCounts(next);
        })
        .catch((cause) => {
          if (!cancelled) setError(cause.message);
        })
        .finally(() => {
          if (!cancelled) setCounting(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    excluded,
    id,
    included,
    locked,
    parsed.emails.join("\n"),
    parsed.invalid.length,
    review,
  ]);

  useEffect(() => {
    if (!review?.send || !working.has(review.send.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        await api(`campaigns/${id}/send/step`, "POST");
      } catch (cause) {
        setError((cause as Error).message);
      }
      try {
        await load();
      } catch (cause) {
        setError((cause as Error).message);
      }
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [id, load, review?.send]);

  function toggle(
    id: string,
    values: string[],
    setValues: (next: string[]) => void,
  ) {
    setValues(
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
    setCounts(null);
    setCounting(false);
  }

  function toggleIncluded(audienceId: string) {
    if (!included.includes(audienceId))
      setExcluded((values) => values.filter((value) => value !== audienceId));
    toggle(audienceId, included, setIncluded);
  }

  async function readFile(file?: File) {
    if (!file) return;
    const text = await file.text();
    const merged = [...parseEmails(manual).emails, ...parseEmails(text).emails];
    setManual([...new Set(merged)].join("\n"));
  }

  async function send() {
    if (!counts?.recipients || parsed.invalid.length) return;
    if (
      !window.confirm(
        `Send this campaign to ${counts.recipients.toLocaleString()} recipients? This cannot be undone.`,
      )
    )
      return;
    setSending(true);
    setError("");
    try {
      await api(`campaigns/${id}/send`, "POST", {
        audienceIds: included,
        exclusionAudienceIds: excluded,
        manualExclusions: parsed.emails,
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!review)
    return (
      <section className="card campaign-recipients">
        <Loading />
      </section>
    );
  const sendState = review.send;
  return (
    <section className="card campaign-recipients">
      <div className="section-toolbar">
        <div>
          <h2>Choose recipients</h2>
          <p>
            Included audiences are combined. Duplicates, opt-outs, and
            exclusions are removed automatically.
          </p>
        </div>
        <span className="row-icon">
          <Users size={18} />
        </span>
      </div>
      <Notice
        message={
          error ||
          (parsed.invalid.length
            ? `Check these exclusions: ${parsed.invalid.slice(0, 3).join(", ")}`
            : "")
        }
      />
      {sendState ? (
        <div
          className={`send-result ${["failed", "review"].includes(sendState.status) ? "failed" : ""}`}
        >
          {sendState.status === "sent" ? (
            <CheckCircle2 size={22} />
          ) : ["failed", "review"].includes(sendState.status) ? (
            <XCircle size={22} />
          ) : (
            <span className="send-pulse" />
          )}
          <div>
            <strong>
              {sendState.status === "sent"
                ? "Campaign sent"
                : sendState.status === "review"
                  ? "Send status needs review"
                  : sendState.status === "failed"
                    ? "Send stopped safely"
                    : "Preparing and sending…"}
            </strong>
            <p>
              {sendState.status === "sent"
                ? `${Number(sendState.counts.recipients || 0).toLocaleString()} addresses were submitted to Resend${sendState.finishedAt ? ` on ${date(sendState.finishedAt)}` : ""}.`
                : sendState.status === "review"
                  ? "Resend may have accepted the broadcast before the connection failed. Check the Resend broadcast before taking any further action."
                  : sendState.error ||
                    "ForceMultiplier is building the Resend segment and sending the broadcast in the background."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="recipient-columns">
            <fieldset>
              <legend>Send to one or more audiences</legend>
              {!review.audiences.length && (
                <p className="muted">Create and pull an audience first.</p>
              )}
              {review.audiences.map((audience) => (
                <label key={audience.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={included.includes(audience.id)}
                    disabled={!audience.snapshot}
                    onChange={() => toggleIncluded(audience.id)}
                  />
                  <span>
                    <strong>{audience.name}</strong>
                    <small>
                      {audience.snapshot
                        ? `${audience.snapshot.processed.toLocaleString()} in snapshot · ${date(audience.snapshot.finishedAt)}`
                        : "Pull this audience from Salesforce first"}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>
                Exclude saved audiences <small>Optional</small>
              </legend>
              {review.audiences
                .filter((audience) => !included.includes(audience.id))
                .map((audience) => (
                  <label key={audience.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={excluded.includes(audience.id)}
                      disabled={!audience.snapshot}
                      onChange={() =>
                        toggle(audience.id, excluded, setExcluded)
                      }
                    />
                    <span>
                      <strong>{audience.name}</strong>
                      <small>
                        {audience.snapshot
                          ? `${audience.snapshot.processed.toLocaleString()} in snapshot`
                          : "No completed snapshot"}
                      </small>
                    </span>
                  </label>
                ))}
            </fieldset>
          </div>
          <label className="manual-exclusions">
            Individual email exclusions{" "}
            <small>
              Optional · paste comma/newline separated addresses or upload
              CSV/TXT
            </small>
            <textarea
              rows={4}
              value={manual}
              onChange={(event) => {
                setManual(event.target.value);
                setCounts(null);
              }}
              placeholder="person@example.org"
            />
            <span className="file-button">
              <FileUp size={15} /> Add from file
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(event) => void readFile(event.target.files?.[0])}
              />
            </span>
          </label>
          <div className="recipient-summary">
            <div>
              <small>Final recipients</small>
              <strong>
                {counting ? "…" : (counts?.recipients.toLocaleString() ?? "—")}
              </strong>
            </div>
            {counts && (
              <p>
                {counts.source.toLocaleString()} source rows ·{" "}
                {counts.duplicates.toLocaleString()} duplicates ·{" "}
                {(
                  counts.optedOut +
                  counts.excluded +
                  counts.suppressed
                ).toLocaleString()}{" "}
                excluded
              </p>
            )}
            <Button
              busy={sending}
              disabled={
                !counts?.recipients || counting || !!parsed.invalid.length
              }
              onClick={() => void send()}
            >
              <Send size={16} /> Send campaign
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
