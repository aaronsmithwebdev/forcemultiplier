"use client";
import { useEffect, useState } from "react";
import { api, Notice } from "./common";

export function AudienceExclusions({
  selected,
  onChange,
  orgId,
  audienceId,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  orgId?: string;
  audienceId?: string;
}) {
  const [options, setOptions] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("audiences")
      .then(setOptions)
      .catch((cause) => setError(cause.message));
  }, []);
  const available =
    options?.filter(
      (row) => row.id !== audienceId && (!orgId || row.orgId === orgId),
    ) ?? [];
  return (
    <div>
      <p className="muted">
        People in the latest completed pull of any selected audience will be
        left out of Constant Contact list deliveries. Pull each excluded
        audience before sending.
      </p>
      <Notice message={error} />
      {!options && !error && <p className="muted">Loading audiences…</p>}
      {options && !available.length && (
        <p className="muted">No other audiences are available.</p>
      )}
      <div className="exclusion-options">
        {available.map((row) => (
          <label className="consent-check" key={row.id}>
            <input
              type="checkbox"
              checked={selected.includes(row.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, row.id]
                    : selected.filter((id) => id !== row.id),
                )
              }
            />
            <span>
              {row.name}
              {row.runs[0]?.status === "completed" ? "" : " · Pull required"}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
