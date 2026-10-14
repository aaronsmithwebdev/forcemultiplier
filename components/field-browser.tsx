"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronRight, Search, X } from "lucide-react";
import { api, Button, Loading, Notice } from "./common";
import { mirrorFieldReason } from "@/lib/contact-mirror-fields";
export function FieldBrowser({
  selected,
  onChange,
  contactOnly = false,
}: {
  selected: string[];
  onChange: (fields: string[]) => void;
  contactOnly?: boolean;
}) {
  const [trail, setTrail] = useState([
      { object: "Contact", prefix: "", label: "Contact" },
    ]),
    [data, setData] = useState<any>(null),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const current = trail[trail.length - 1];
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    api("salesforce/metadata?object=" + current.object)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [current.object]);
  const matchingFields = (data?.fields ?? []).filter((f: any) =>
    (f.label + " " + f.name).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="field-browser">
      <div className="field-browser-heading">
        <h3>
          {contactOnly ? "Choose Contact fields" : "Explore Salesforce fields"}
        </h3>
        <span className="muted">
          {selected.length} selected (30 max)
          {contactOnly &&
            data?.fields &&
            ` · ${data.fields.length} Contact fields`}
        </span>
      </div>
      <p>
        {contactOnly
          ? "Search every Contact field visible to the connected Salesforce user. Fields that cannot be safely mirrored are shown with a reason."
          : "Follow a related object to pick its custom fields. These values will be included in your pulled contacts."}
      </p>
      {!contactOnly && (
        <div className="breadcrumbs">
          {trail.map((step, i) => (
            <span key={i}>
              <button
                type="button"
                onClick={() => {
                  setTrail(trail.slice(0, i + 1));
                  setSearch("");
                }}
              >
                {step.label}
              </button>
              {i < trail.length - 1 && <ChevronRight size={13} />}
            </span>
          ))}
        </div>
      )}
      <div className="search-box">
        <Search size={16} />
        <input
          placeholder="Find a field or relationship…"
          aria-label="Search Salesforce fields"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Notice message={error} />
      {!data && !error ? (
        <Loading />
      ) : (
        <div className="field-list">
          {matchingFields.length === 0 && <p>No fields match this search.</p>}
          {matchingFields.map((f: any) => {
            const path = current.prefix + f.name;
            const checked = selected.includes(path);
            const reason = contactOnly ? mirrorFieldReason(f) : null;
            return (
              <div className="field-row" key={f.name}>
                <button
                  type="button"
                  className={`field-select ${checked ? "selected" : ""}`}
                  title={reason || undefined}
                  disabled={
                    Boolean(reason) ||
                    ["address", "location", "base64"].includes(f.type) ||
                    (!checked && selected.length >= 30)
                  }
                  onClick={() =>
                    onChange(
                      checked
                        ? selected.filter((x) => x !== path)
                        : [...selected, path],
                    )
                  }
                >
                  <span className="checkbox">
                    {checked && <Check size={12} />}
                  </span>
                  <span>
                    {f.label}
                    <small>{path}</small>
                    {reason && <small>{reason}</small>}
                    {contactOnly && f.calculated && !reason && (
                      <small>Salesforce formula</small>
                    )}
                  </span>
                </button>
                {!contactOnly && f.relationshipName && (
                  <button
                    type="button"
                    className="relationship-button"
                    disabled={f.referenceTo?.length !== 1 || trail.length >= 5}
                    title={
                      f.referenceTo?.length !== 1
                        ? "Multiple target types are not supported yet"
                        : "Explore related object"
                    }
                    onClick={() => {
                      setTrail([
                        ...trail,
                        {
                          object: f.referenceTo[0],
                          prefix: current.prefix + f.relationshipName + ".",
                          label: f.label,
                        },
                      ]);
                      setSearch("");
                    }}
                  >
                    Explore
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="selected-fields">
        {selected.map((path) => (
          <span className="field-chip" key={path}>
            {path}
            <button
              type="button"
              aria-label={`Remove ${path}`}
              onClick={() => onChange(selected.filter((p) => p !== path))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <small className="muted">
        Contact ID, first and last name, email, email opt-out and modification
        time are always included.
        {contactOnly
          ? " Related-object fields require Salesforce audience queries."
          : " Child collections and polymorphic lookups need a dedicated extraction rule and are not selectable yet."}
      </small>
    </div>
  );
}
