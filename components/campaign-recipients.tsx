"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileUp,
  Plus,
  Search,
  Send,
  Users,
  X,
  XCircle,
} from "lucide-react";
import type { QueryGroup } from "../lib/query-builder";
import { api, Button, Loading, Notice, date } from "./common";
import { ContactQueryBuilder } from "./query-builder";

type Audience = {
  id: string;
  name: string;
  fields: string[];
  snapshot: null | { processed: number; finishedAt: string };
};
type Counts = {
  source: number;
  duplicates: number;
  optedOut: number;
  excluded: number;
  fieldExcluded: number;
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
  exclusionRules: QueryGroup;
  audiences: Audience[];
  send: SendState | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const working = new Set(["pending", "importing", "ready"]);
const emptyRules: QueryGroup = { conjunction: "AND", items: [] };

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

function AudiencePicker({
  title,
  optional = false,
  audiences,
  selected,
  blocked,
  onAdd,
  onRemove,
}: {
  title: string;
  optional?: boolean;
  audiences: Audience[];
  selected: string[];
  blocked: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const chosen = selected.flatMap((id) => {
    const audience = audiences.find((item) => item.id === id);
    return audience ? [audience] : [];
  });
  const matches = audiences
    .filter(
      (audience) =>
        !selected.includes(audience.id) &&
        !blocked.includes(audience.id) &&
        audience.name.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .slice(0, 20);

  return (
    <div className="audience-picker">
      <h3>
        {title} {optional && <small>Optional</small>}
      </h3>
      <div className="audience-chips">
        {chosen.map((audience) => (
          <span key={audience.id}>
            <span>
              <strong>{audience.name}</strong>
              <small>
                {audience.snapshot
                  ? `${audience.snapshot.processed.toLocaleString()} in snapshot`
                  : "No completed snapshot"}
              </small>
            </span>
            <button
              type="button"
              aria-label={`Remove ${audience.name}`}
              onClick={() => onRemove(audience.id)}
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <div
        className="audience-search"
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(false);
        }}
      >
        <div className="search-box">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search saved audiences…"
            aria-label={`Search audiences to ${title.toLowerCase()}`}
          />
        </div>
        {focused && (
          <div className="audience-results">
            {matches.map((audience) => (
              <button
                type="button"
                key={audience.id}
                disabled={!audience.snapshot}
                onClick={() => {
                  onAdd(audience.id);
                  setSearch("");
                }}
              >
                <span>
                  <strong>{audience.name}</strong>
                  <small>
                    {audience.snapshot
                      ? `${audience.snapshot.processed.toLocaleString()} in snapshot · ${date(audience.snapshot.finishedAt)}`
                      : "Pull this audience from Salesforce first"}
                  </small>
                </span>
                <Plus size={15} />
              </button>
            ))}
            {!matches.length && <p>No matching available audiences.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export function CampaignRecipients({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [included, setIncluded] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [rules, setRules] = useState<QueryGroup>(emptyRules);
  const [rulesValid, setRulesValid] = useState(true);
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
    setRules(data.exclusionRules || emptyRules);
    const saved = data.send?.counts;
    if (saved && typeof saved.recipients === "number")
      setCounts(saved as Counts);
    return data;
  }, [id]);

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, [load]);

  const parsed = useMemo(() => parseEmails(manual), [manual]);
  const allowedFields = useMemo(() => {
    const selected =
      review?.audiences.filter((audience) => included.includes(audience.id)) ||
      [];
    const captured = new Set(
      selected[0]?.fields.filter((field) => !field.includes(".")) || [],
    );
    for (const field of captured)
      if (selected.some((audience) => !audience.fields.includes(field)))
        captured.delete(field);
    return [
      "Email",
      "FirstName",
      "LastName",
      "HasOptedOutOfEmail",
      ...captured,
    ];
  }, [included, review?.audiences]);
  const rulesKey = JSON.stringify(rules);
  const locked = !!review?.send;

  useEffect(() => {
    if (
      !review ||
      locked ||
      !included.length ||
      parsed.invalid.length ||
      !rulesValid
    )
      return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCounting(true);
      setError("");
      api(`campaigns/${id}/recipients`, "POST", {
        audienceIds: included,
        exclusionAudienceIds: excluded,
        manualExclusions: parsed.emails,
        exclusionRules: rules,
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
    rulesKey,
    rulesValid,
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

  function selectionChanged() {
    setCounts(null);
    setCounting(false);
  }

  function addIncluded(audienceId: string) {
    setIncluded((values) => [...values, audienceId]);
    setExcluded((values) => values.filter((value) => value !== audienceId));
    selectionChanged();
  }

  function addExcluded(audienceId: string) {
    setExcluded((values) => [...values, audienceId]);
    setIncluded((values) => values.filter((value) => value !== audienceId));
    selectionChanged();
  }

  const updateRules = useCallback((next: QueryGroup) => {
    setRules(next);
    setCounts(null);
  }, []);
  const updateRulesValidity = useCallback((valid: boolean) => {
    setRulesValid(valid);
    if (!valid) setCounts(null);
  }, []);

  async function readFile(file?: File) {
    if (!file) return;
    const text = await file.text();
    const merged = [...parseEmails(manual).emails, ...parseEmails(text).emails];
    setManual([...new Set(merged)].join("\n"));
  }

  async function send() {
    if (!counts?.recipients || parsed.invalid.length || !rulesValid) return;
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
        exclusionRules: rules,
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
            <AudiencePicker
              title="Send to audiences"
              audiences={review.audiences}
              selected={included}
              blocked={excluded}
              onAdd={addIncluded}
              onRemove={(audienceId) => {
                setIncluded((values) =>
                  values.filter((value) => value !== audienceId),
                );
                selectionChanged();
              }}
            />
            <AudiencePicker
              title="Exclude audiences"
              optional
              audiences={review.audiences}
              selected={excluded}
              blocked={included}
              onAdd={addExcluded}
              onRemove={(audienceId) => {
                setExcluded((values) =>
                  values.filter((value) => value !== audienceId),
                );
                selectionChanged();
              }}
            />
          </div>
          {!!included.length && (
            <div className="campaign-rule-builder">
              <ContactQueryBuilder
                initialRules={review.exclusionRules || emptyRules}
                allowedFields={allowedFields}
                onRulesChange={updateRules}
                onValidityChange={updateRulesValidity}
                title="Exclude by Contact field values"
                description="Add conditions and groups. Anyone matching these rules is excluded. Only fields stored in every selected audience snapshot are available."
              />
            </div>
          )}
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
                  counts.fieldExcluded +
                  counts.suppressed
                ).toLocaleString()}{" "}
                excluded
              </p>
            )}
            <Button
              busy={sending}
              disabled={
                !counts?.recipients ||
                counting ||
                !!parsed.invalid.length ||
                !rulesValid
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
