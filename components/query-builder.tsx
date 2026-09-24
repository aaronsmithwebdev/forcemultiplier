"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, Plus, Search, X } from "lucide-react";
import { api, Button, Notice } from "./common";
import {
  buildContactQuery,
  QueryFilter,
  QueryGroup,
} from "../lib/query-builder";

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
type Group = Omit<QueryGroup, "items"> & {
  id: number;
  items: (Filter | Group)[];
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
function isGroup(item: Filter | Group): item is Group {
  return "items" in item;
}
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
function changeGroup(
  group: Group,
  id: number,
  change: (value: Group) => Group,
): Group {
  if (group.id === id) return change(group);
  return {
    ...group,
    items: group.items.map((item) =>
      isGroup(item) ? changeGroup(item, id, change) : item,
    ),
  };
}
function removeItem(group: Group, id: number): Group {
  return {
    ...group,
    items: group.items
      .filter((item) => item.id !== id)
      .map((item) => (isGroup(item) ? removeItem(item, id) : item)),
  };
}
function allGroups(group: Group): Group[] {
  return [
    group,
    ...group.items.flatMap((item) => (isGroup(item) ? allGroups(item) : [])),
  ];
}
function filterCount(group: Group): number {
  return group.items.reduce(
    (total, item) => total + (isGroup(item) ? filterCount(item) : 1),
    0,
  );
}

export function ContactQueryBuilder({
  onChange,
  onRulesChange,
  onValidityChange,
  initialRules,
  allowedFields,
  title = "Audience filters",
  description = "Only contacts with an email address are included.",
}: {
  onChange?: (query: string) => void;
  onRulesChange?: (rules: QueryGroup) => void;
  onValidityChange?: (valid: boolean) => void;
  initialRules?: QueryGroup;
  allowedFields?: string[];
  title?: string;
  description?: string;
}) {
  const nextId = useRef(1);
  const [fields, setFields] = useState<Field[] | null>(null),
    [root, setRoot] = useState<Group>(() => {
      function hydrate(group: QueryGroup, root = false): Group {
        return {
          id: root ? 0 : nextId.current++,
          conjunction: group.conjunction,
          items: group.items.map((item) =>
            "items" in item
              ? hydrate(item)
              : {
                  ...item,
                  id: nextId.current++,
                  label: item.field,
                },
          ),
        };
      }
      return hydrate(initialRules || { conjunction: "AND", items: [] }, true);
    }),
    [targetGroup, setTargetGroup] = useState<number | null>(null),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const focusTarget = useRef("");
  useEffect(() => {
    if (focusTarget.current) {
      document.getElementById(focusTarget.current)?.focus();
      focusTarget.current = "";
    }
  });
  useEffect(() => {
    let live = true;
    api("salesforce/metadata?object=Contact")
      .then((data) => {
        if (!live) return;
        setFields(data.fields);
        const byName = new Map<string, Field>(
          data.fields.map((field: Field) => [field.name, field]),
        );
        setRoot((current) => ({
          ...current,
          items: current.items.map(function enrich(item): Filter | Group {
            if (isGroup(item))
              return { ...item, items: item.items.map(enrich) };
            const field = byName.get(item.field);
            return field
              ? {
                  ...item,
                  label: field.label,
                  values: field.picklistValues,
                }
              : item;
          }),
        }));
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);
  const generated = useMemo(() => {
    try {
      return { query: buildContactQuery(root), error: "" };
    } catch (e) {
      return { query: "", error: (e as Error).message };
    }
  }, [root]);
  useEffect(() => onChange?.(generated.query), [generated.query, onChange]);
  useEffect(() => {
    function clean(group: Group): QueryGroup {
      return {
        conjunction: group.conjunction,
        items: group.items.map((item) =>
          isGroup(item)
            ? clean(item)
            : {
                field: item.field,
                type: item.type,
                operator: item.operator,
                value: item.value,
                conjunction: item.conjunction,
              },
        ),
      };
    }
    if (!generated.error) onRulesChange?.(clean(root));
  }, [generated.error, onRulesChange, root]);
  useEffect(
    () => onValidityChange?.(!generated.error),
    [generated.error, onValidityChange],
  );
  const groups = useMemo(() => allGroups(root), [root]);
  useEffect(() => {
    if (!groups.some((group) => group.id === targetGroup)) setTargetGroup(null);
  }, [groups, targetGroup]);
  const totalFilters = filterCount(root);
  const matches = (fields ?? [])
    .filter(
      (field) =>
        field.filterable !== false &&
        !unsupported.has(field.type) &&
        (!allowedFields || allowedFields.includes(field.name)) &&
        `${field.label} ${field.name}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => a.label.localeCompare(b.label));
  function updateFilter(id: number, patch: Partial<Filter>) {
    setRoot((current) => ({
      ...current,
      items: current.items.map(function update(item): Filter | Group {
        if (isGroup(item)) return { ...item, items: item.items.map(update) };
        return item.id === id ? { ...item, ...patch } : item;
      }),
    }));
  }
  function add(field: Field) {
    if (totalFilters >= 20 || targetGroup === null) return;
    const filter: Filter = {
      id: nextId.current++,
      field: field.name,
      label: field.label,
      type: field.type,
      values: field.picklistValues,
      operator: field.type === "multipicklist" ? "includes" : "eq",
      value: field.type === "boolean" ? "true" : "",
      conjunction: "AND",
    };
    setRoot((current) =>
      changeGroup(current, targetGroup, (group) => ({
        ...group,
        items: [...group.items, filter],
      })),
    );
    focusTarget.current = `query-value-${filter.id}`;
    setTargetGroup(null);
    setSearch("");
  }
  function addGroup(parentId: number) {
    if (groups.length >= 10) return;
    const id = nextId.current++;
    setRoot((current) =>
      changeGroup(current, parentId, (group) => ({
        ...group,
        items: [...group.items, { id, conjunction: "AND", items: [] }],
      })),
    );
    setSearch("");
    setTargetGroup(id);
    focusTarget.current = `query-search-${id}`;
  }
  function closePicker() {
    focusTarget.current = `query-add-${targetGroup}`;
    setTargetGroup(null);
  }
  function renderFilter(filter: Filter) {
    const noValue = ["is_null", "not_null"].includes(filter.operator);
    return (
      <div
        className={`query-filter ${noValue ? "query-filter-no-value" : ""}`}
        key={filter.id}
      >
        <span className="query-filter-field" title={filter.field}>
          {filter.label}
        </span>
        <select
          aria-label={`${filter.label} operator`}
          value={filter.operator}
          onChange={(event) =>
            updateFilter(filter.id, { operator: event.target.value })
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
              id={`query-value-${filter.id}`}
              aria-label={`${filter.label} value`}
              value={filter.value}
              onChange={(event) =>
                updateFilter(filter.id, { value: event.target.value })
              }
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : filter.values?.length ? (
            <select
              id={`query-value-${filter.id}`}
              aria-label={`${filter.label} value`}
              value={filter.value}
              onChange={(event) =>
                updateFilter(filter.id, { value: event.target.value })
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
              id={`query-value-${filter.id}`}
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
                updateFilter(filter.id, { value: event.target.value })
              }
              placeholder="Enter a value…"
            />
          ))}
        <Button
          variant="ghost"
          className="query-remove"
          aria-label={`Remove ${filter.label} filter`}
          onClick={() => setRoot((current) => removeItem(current, filter.id))}
        >
          <X size={15} />
        </Button>
      </div>
    );
  }
  function renderGroup(group: Group, depth = 0) {
    return (
      <div
        className="query-group"
        role="group"
        aria-label={
          group.id === 0 ? "Audience conditions" : `Condition group ${group.id}`
        }
        key={group.id}
      >
        <div className="query-group-heading">
          <fieldset
            className="query-logic-switch"
            aria-label={
              group.id === 0
                ? "Audience match logic"
                : `Group ${group.id} match logic`
            }
          >
            {(["AND", "OR"] as const).map((conjunction) => (
              <label key={conjunction}>
                <input
                  type="radio"
                  name={`query-logic-${group.id}`}
                  value={conjunction}
                  checked={group.conjunction === conjunction}
                  onChange={() =>
                    setRoot((current) =>
                      changeGroup(current, group.id, (item) => ({
                        ...item,
                        conjunction,
                      })),
                    )
                  }
                />
                <span>{conjunction}</span>
              </label>
            ))}
          </fieldset>
          <span className="query-logic-description">
            Match {group.conjunction === "AND" ? "all" : "any"} conditions
          </span>
          {group.id !== 0 && (
            <Button
              variant="ghost"
              className="query-remove"
              aria-label={`Remove group ${group.id}`}
              onClick={() =>
                setRoot((current) => removeItem(current, group.id))
              }
            >
              <X size={15} />
            </Button>
          )}
        </div>
        <div className="query-group-items">
          {group.items.length === 0 && (
            <p className="query-empty">
              {group.id === 0
                ? "Start with a condition to narrow your audience."
                : "Add a condition to this group."}
            </p>
          )}
          {group.items.map((item) =>
            isGroup(item) ? renderGroup(item, depth + 1) : renderFilter(item),
          )}
        </div>
        <div className="query-group-actions">
          <Button
            id={`query-add-${group.id}`}
            variant="ghost"
            disabled={!fields || totalFilters >= 20}
            aria-expanded={targetGroup === group.id}
            aria-controls={
              targetGroup === group.id ? `query-picker-${group.id}` : undefined
            }
            onClick={() => {
              setSearch("");
              setTargetGroup(targetGroup === group.id ? null : group.id);
              focusTarget.current = `query-search-${group.id}`;
            }}
          >
            <Plus size={15} /> Add condition
          </Button>
          <Button
            variant="ghost"
            disabled={!fields || depth >= 3 || groups.length >= 10}
            onClick={() => addGroup(group.id)}
          >
            <FolderPlus size={15} /> Add group
          </Button>
        </div>
        {targetGroup === group.id && (
          <div
            className="query-field-picker"
            id={`query-picker-${group.id}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closePicker();
              }
            }}
          >
            <div className="query-picker-heading">
              <div className="search-box query-field-search">
                <Search size={16} aria-hidden="true" />
                <input
                  id={`query-search-${group.id}`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search Contact fields…"
                  aria-label="Find a Contact field"
                />
              </div>
              <Button
                variant="ghost"
                aria-label="Close field picker"
                onClick={closePicker}
              >
                <X size={16} />
              </Button>
            </div>
            <div className="query-field-results">
              {matches.map((field) => (
                <button
                  type="button"
                  key={field.name}
                  onClick={() => add(field)}
                >
                  <span>
                    {field.label}
                    <small>{field.name}</small>
                  </span>
                  <Plus size={15} aria-hidden="true" />
                </button>
              ))}
              {matches.length === 0 && (
                <p role="status">
                  No matching fields. Try a label or API name.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="contact-query-builder">
      <div className="field-browser-heading">
        <h3>{title}</h3>
        <span className="query-filter-count">
          {totalFilters} / 20 conditions
        </span>
      </div>
      <p className="muted">{description}</p>
      <Notice message={error} />
      {!fields && !error && <p role="status">Loading Contact fields…</p>}
      <div className="query-groups">{renderGroup(root)}</div>
      {generated.error && (
        <p className="query-hint" role="status">
          {generated.error}
        </p>
      )}
    </div>
  );
}
