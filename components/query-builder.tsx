"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { api, Button, Loading, Notice } from "./common";
import { buildContactQuery, QueryFilter } from "../lib/query-builder";

type Field = {
  name: string;
  label: string;
  type: string;
  filterable?: boolean;
  picklistValues?: { label: string; value: string; active: boolean }[];
};
type Filter = QueryFilter & {
  id: number;
  label: string;
  values?: Field["picklistValues"];
};

const unsupported = new Set(["address", "base64", "location"]);
const numeric = new Set(["currency", "double", "int", "long", "percent"]);
const ordered = new Set([...numeric, "date", "datetime"]);
const searchable = new Set([
  "email",
  "encryptedstring",
  "phone",
  "string",
  "textarea",
  "url",
]);
function operators(field: Filter) {
  if (field.type === "boolean") return [["eq", "is"]];
  if (field.type === "multipicklist")
    return [
      ["includes", "includes"],
      ["excludes", "excludes"],
      ["is_null", "is blank"],
      ["not_null", "is not blank"],
    ];
  const result = [
    ["eq", "equals"],
    ["neq", "does not equal"],
  ];
  if (ordered.has(field.type))
    result.push(
      ["gt", "is greater than"],
      ["gte", "is at least"],
      ["lt", "is less than"],
      ["lte", "is at most"],
    );
  else if (searchable.has(field.type))
    result.push(["contains", "contains"], ["starts", "starts with"]);
  result.push(["is_null", "is blank"], ["not_null", "is not blank"]);
  return result;
}

export function ContactQueryBuilder({
  onChange,
}: {
  onChange: (query: string) => void;
}) {
  const [fields, setFields] = useState<Field[] | null>(null),
    [filters, setFilters] = useState<Filter[]>([]),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [nextId, setNextId] = useState(1);
  useEffect(() => {
    let live = true;
    api("salesforce/metadata?object=Contact")
      .then((data) => live && setFields(data.fields))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);
  const generated = useMemo(() => {
    try {
      return { query: buildContactQuery(filters), error: "" };
    } catch (e) {
      return { query: "", error: (e as Error).message };
    }
  }, [filters]);
  useEffect(() => onChange(generated.query), [generated.query, onChange]);
  const matches = (fields ?? [])
    .filter(
      (field) =>
        field.filterable !== false &&
        !unsupported.has(field.type) &&
        `${field.label} ${field.name}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .slice(0, 12);
  function update(id: number, patch: Partial<Filter>) {
    setFilters((current) =>
      current.map((filter) =>
        filter.id === id ? { ...filter, ...patch } : filter,
      ),
    );
  }
  function add(field: Field) {
    if (filters.length >= 20) return;
    setFilters((current) => [
      ...current,
      {
        id: nextId,
        field: field.name,
        label: field.label,
        type: field.type,
        values: field.picklistValues,
        operator: field.type === "multipicklist" ? "includes" : "eq",
        value: field.type === "boolean" ? "true" : "",
        conjunction: "AND",
      },
    ]);
    setNextId((value) => value + 1);
    setSearch("");
  }
  return (
    <div className="contact-query-builder">
      <div className="field-browser-heading">
        <h3>Choose audience filters</h3>
        <span className="muted">{filters.length}/20 filters</span>
      </div>
      <p className="muted">
        Find a Salesforce Contact field, add it, then choose how it should
        match. Contacts must have an email address.
      </p>
      <Notice message={error || generated.error} />
      <div className="search-box query-field-search">
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a Contact field…"
          aria-label="Find a Contact field"
        />
      </div>
      {!fields && !error ? (
        <Loading />
      ) : (
        <div className="query-field-results">
          {matches.map((field) => (
            <button
              type="button"
              key={field.name}
              disabled={filters.length >= 20}
              onClick={() => add(field)}
            >
              <Plus size={13} />
              <span>
                {field.label}
                <small>{field.name}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {filters.length > 0 && (
        <div className="query-filters">
          {filters.map((filter, index) => {
            const noValue = ["is_null", "not_null"].includes(filter.operator);
            return (
              <div className="query-filter" key={filter.id}>
                {index === 0 ? (
                  <strong>Where</strong>
                ) : (
                  <select
                    aria-label={`Join ${filter.label} filter`}
                    value={filter.conjunction}
                    onChange={(event) =>
                      update(filter.id, {
                        conjunction: event.target.value as "AND" | "OR",
                      })
                    }
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                )}
                <span className="query-filter-field">
                  {filter.label}
                  <small>{filter.field}</small>
                </span>
                <select
                  aria-label={`${filter.label} operator`}
                  value={filter.operator}
                  onChange={(event) =>
                    update(filter.id, { operator: event.target.value })
                  }
                >
                  {operators(filter).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {!noValue &&
                  (filter.type === "boolean" ? (
                    <select
                      aria-label={`${filter.label} value`}
                      value={filter.value}
                      onChange={(event) =>
                        update(filter.id, { value: event.target.value })
                      }
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : filter.values?.length ? (
                    <select
                      aria-label={`${filter.label} value`}
                      value={filter.value}
                      onChange={(event) =>
                        update(filter.id, { value: event.target.value })
                      }
                    >
                      <option value="">Choose…</option>
                      {filter.values
                        .filter((value) => value.active)
                        .map((value) => (
                          <option key={value.value} value={value.value}>
                            {value.label}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`${filter.label} value`}
                      type={
                        numeric.has(filter.type)
                          ? "number"
                          : filter.type === "date"
                            ? "date"
                            : filter.type === "datetime"
                              ? "datetime-local"
                              : "text"
                      }
                      value={filter.value}
                      onChange={(event) =>
                        update(filter.id, { value: event.target.value })
                      }
                      placeholder="Value"
                    />
                  ))}
                <Button
                  variant="ghost"
                  aria-label={`Remove ${filter.label} filter`}
                  onClick={() =>
                    setFilters((current) =>
                      current.filter((item) => item.id !== filter.id),
                    )
                  }
                >
                  <X size={15} />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <small className="muted">
        Mixed AND/OR rules are grouped from top to bottom, so the result follows
        the order shown.
      </small>
    </div>
  );
}
