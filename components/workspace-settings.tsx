"use client";
import { useEffect, useState } from "react";
import { Clock3, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { timeZones } from "@/lib/time-zone";
import { useDate, useTimeZone } from "./time-zone";
import { api, Button, Heading, Loading, Notice } from "./common";

type Settings = {
  timeZone: string;
  retentionDays: number;
  lastRunAt?: string;
  lastDeleted: number;
  error?: string;
  schedulerReady: boolean;
};

export function WorkspaceSettings() {
  const date = useDate();
  const { setTimeZone: setCurrentTimeZone } = useTimeZone();
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [timeZone, setTimeZone] = useState("Australia/Sydney");
  const [retentionDays, setRetentionDays] = useState("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api("settings")
      .then((value: Settings) => {
        setSettings(value);
        setTimeZone(value.timeZone);
        setRetentionDays(String(value.retentionDays));
      })
      .catch((cause) => setError(cause.message));
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await api("settings", "PUT", {
        retentionDays: Number(retentionDays),
        timeZone,
      });
      setSettings(value);
      setTimeZone(value.timeZone);
      setCurrentTimeZone(value.timeZone);
      router.refresh();
      setRetentionDays(String(value.retentionDays));
      setMessage("Settings saved.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading title="Settings" />
      <Notice message={error} />
      <Notice message={message} success />
      {!settings ? (
        <Loading />
      ) : (
        <section className="card settings-card">
          <div className="section-toolbar">
            <div>
              <h2>Workspace settings</h2>
              <p>Choose the display time zone and Resend contact retention.</p>
            </div>
            <span className="row-icon">
              <Clock3 size={18} />
            </span>
          </div>
          <div className="settings-fields">
            <label>
              Display time zone
              <select
                value={timeZone}
                onChange={(event) => {
                  setTimeZone(event.target.value);
                  setMessage("");
                }}
              >
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace("_", " ")}
                  </option>
                ))}
              </select>
              <small>
                Sydney time adjusts automatically for daylight saving.
              </small>
            </label>
            <label>
              Remove contacts after
              <input
                type="number"
                min={1}
                max={3650}
                required
                value={retentionDays}
                onChange={(event) => {
                  setRetentionDays(event.target.value);
                  setMessage("");
                }}
              />
              <small>Days since the most recent campaign send.</small>
            </label>
            <div className="connected-details">
              <p>
                <strong>Last cleanup:</strong> {date(settings.lastRunAt)}
              </p>
              <p>
                <strong>Removed in that batch:</strong> {settings.lastDeleted}
              </p>
              <p>
                <strong>Scheduled worker:</strong>{" "}
                {settings.schedulerReady ? "Ready" : "CRON_SECRET not set"}
              </p>
            </div>
            {settings.error ? (
              <div className="wide-field">
                <Notice message={`Last cleanup failed: ${settings.error}`} />
              </div>
            ) : null}
          </div>
          <div className="settings-actions">
            <small>Retention range: 1–3,650 days.</small>
            <Button busy={busy} onClick={() => void save()}>
              Save settings
            </Button>
          </div>
        </section>
      )}
      <div className="settings-note">
        <ShieldCheck size={18} />
        <p>
          <strong>Consent remains protected.</strong> Active campaign contacts
          are never removed. Before deleting an inactive Resend contact, Force
          Multiplier records any Resend unsubscribe in its suppression ledger.
          Contacts deleted from Resend can be created again by a future send.
        </p>
      </div>
    </>
  );
}
