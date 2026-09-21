"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, Plus, Search, X } from "lucide-react";
import { api, Button, Loading, Notice } from "./common";
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
}: {
  onChange: (query: string) => void;
}) {
  const [fields, setFields] = useState<Field[] | null>(null),
    [root, setRoot] = useState<Group>({
      id: 0,
      conjunction: "AND",
      items: [],
    }),
    [targetGroup, setTargetGroup] = useState(0),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const nextId = useRef(1);
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
      return { query: buildContactQuery(root), error: "" };
    } catch (e) {
      return { query: "", error: (e as Error).message };
    }
  }, [root]);
  useEffect(() => onChange(generated.query), [generated.query, onChange]);
  const groups = useMemo(() => allGroups(root), [root]);
  useEffect(() => {
    if (!groups.some((group) => group.id === targetGroup)) setTargetGroup(0);
  }, [groups, targetGroup]);
  const totalFilters = filterCount(root);
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
    if (totalFilters >= 20) return;
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
    setTargetGroup(id);
  }
  function renderFilter(filter: Filter, index: number, conjunction: string) {
    const noValue = ["is_null", "not_null"].includes(filter.operator);
    return (
      <div className="query-filter" key={filter.id}>
        <strong>{index === 0 ? "Where" : conjunction}</strong>
        <span className="query-filter-field">
          {filter.label}
          <small>{filter.field}</small>
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
              placeholder="Value"
            />
          ))}
        <Button
          variant="ghost"
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
        className={`query-group ${group.id === targetGroup ? "selected" : ""}`}
        key={group.id}
      >
        <div className="query-group-heading">
          <strong>{group.id === 0 ? "Main group" : `Group ${group.id}`}</strong>
          <label>
            Match
            <select
              value={group.conjunction}
              onChange={(event) =>
                setRoot((current) =>
                  changeGroup(current, group.id, (item) => ({
                    ...item,
                    conjunction: event.target.value as "AND" | "OR",
                  })),
                )
              }
            >
              <option value="AND">all conditions (AND)</option>
              <option value="OR">any condition (OR)</option>
            </select>
          </label>
          <Button
            variant="ghost"
            disabled={depth >= 3 || groups.length >= 10}
            onClick={() => addGroup(group.id)}
          >
            <FolderPlus size={14} /> Add group
          </Button>
          {group.id !== 0 && (
            <Button
              variant="ghost"
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
            <p className="muted">Add a field to this group.</p>
          )}
          {group.items.map((item, index) =>
            isGroup(item)
              ? renderGroup(item, depth + 1)
              : renderFilter(item, index, group.conjunction),
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="contact-query-builder">
      <div className="field-browser-heading">
        <h3>Choose audience filters</h3>
        <span className="muted">{totalFilters}/20 filters</span>
      </div>
      <p className="muted">
        Find a Salesforce Contact field, add it to a group, then choose how it
        should match. Contacts must have an email address.
      </p>
      <Notice message={error || generated.error} />
      <div className="query-field-toolbar">
        <div className="search-box query-field-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a Contact field…"
            aria-label="Find a Contact field"
          />
        </div>
        <label>
          Add to
          <select
            value={targetGroup}
            onChange={(event) => setTargetGroup(Number(event.target.value))}
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.id === 0 ? "Main group" : `Group ${group.id}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!fields && !error ? (
        <Loading />
      ) : (
        <div className="query-field-results">
          {matches.map((field) => (
            <button
              type="button"
              key={field.name}
              disabled={totalFilters >= 20}
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
      <div className="query-groups">{renderGroup(root)}</div>
      <small className="muted">
        Each group can match all conditions with AND or any condition with OR.
        Groups can be nested four levels deep.
      </small>
    </div>
  );
}
