export type QueryFilter = {
  field: string;
  type: string;
  operator: string;
  value: string;
  conjunction: "AND" | "OR";
};
export type QueryGroup = {
  conjunction: "AND" | "OR";
  items: (QueryFilter | QueryGroup)[];
};

const fieldName = /^[A-Za-z][A-Za-z0-9_]*$/;
const numericTypes = new Set(["currency", "double", "int", "long", "percent"]);
const comparisonOperators: Record<string, string> = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};
const searchableTypes = new Set([
  "email",
  "encryptedstring",
  "phone",
  "string",
  "textarea",
  "url",
]);

export function contactOperators(type: string) {
  if (type === "boolean") return ["eq", "neq"];
  if (type === "multipicklist")
    return ["includes", "excludes", "is_null", "not_null"];
  return [
    "eq",
    "neq",
    ...(numericTypes.has(type) || ["date", "datetime"].includes(type)
      ? ["gt", "gte", "lt", "lte"]
      : []),
    ...(searchableTypes.has(type)
      ? ["contains", "not_contains", "starts", "not_starts", "ends", "not_ends"]
      : []),
    "is_null",
    "not_null",
  ];
}

function quoted(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function likeValue(value: string, before: string, after: string) {
  return `'${before}${value.replace(/[\\'%_]/g, (character) => `\\${character}`)}${after}'`;
}

function formattedValue(filter: QueryFilter) {
  const value = filter.value.trim();
  if (!value) throw new Error("Choose a value for every filter.");
  if (filter.type === "boolean") {
    if (!["true", "false"].includes(value))
      throw new Error("Choose true or false for checkbox fields.");
    return value;
  }
  if (numericTypes.has(filter.type)) {
    if (!/^-?\d+(\.\d+)?$/.test(value))
      throw new Error("Enter a number for numeric fields.");
    return value;
  }
  if (filter.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new Error("Choose a valid date.");
    return value;
  }
  if (filter.type === "datetime") {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf()))
      throw new Error("Choose a valid date and time.");
    return date.toISOString().replace(".000Z", "Z");
  }
  return quoted(value);
}

function filterExpression(filter: QueryFilter) {
  if (!fieldName.test(filter.field)) throw new Error("Choose a valid field.");
  if (!contactOperators(filter.type).includes(filter.operator))
    throw new Error("Choose an operator available for this field type.");
  if (filter.operator === "is_null") return `${filter.field} = null`;
  if (filter.operator === "not_null") return `${filter.field} != null`;
  const value = formattedValue(filter);
  if (
    [
      "contains",
      "not_contains",
      "starts",
      "not_starts",
      "ends",
      "not_ends",
    ].includes(filter.operator)
  ) {
    const before = ["contains", "not_contains", "ends", "not_ends"].includes(
      filter.operator,
    )
      ? "%"
      : "";
    const after = ["contains", "not_contains", "starts", "not_starts"].includes(
      filter.operator,
    )
      ? "%"
      : "";
    const expression = `${filter.field} LIKE ${likeValue(filter.value.trim(), before, after)}`;
    return filter.operator.startsWith("not_")
      ? `(NOT (${expression}))`
      : expression;
  }
  if (["includes", "excludes"].includes(filter.operator))
    return `${filter.field} ${filter.operator.toUpperCase()} (${value})`;
  const operator = comparisonOperators[filter.operator];
  if (!operator) throw new Error("Choose a valid operator.");
  return `${filter.field} ${operator} ${value}`;
}

function isGroup(item: QueryFilter | QueryGroup): item is QueryGroup {
  return "items" in item;
}

function groupedExpression(group: QueryGroup, depth = 0, root = false): string {
  if (depth > 3) throw new Error("Nest groups up to four levels deep.");
  if (!group.items.length) {
    if (root) return "";
    throw new Error("Add at least one condition to every group.");
  }
  if (!["AND", "OR"].includes(group.conjunction))
    throw new Error("Choose AND or OR for every group.");
  const expressions = group.items.map((item) =>
    isGroup(item) ? groupedExpression(item, depth + 1) : filterExpression(item),
  );
  if (expressions.length === 1) return expressions[0];
  const expression = expressions.join(` ${group.conjunction} `);
  return root ? expression : `(${expression})`;
}

export function buildContactCondition(group: QueryGroup) {
  return groupedExpression(group, 0, true);
}

export function buildContactQuery(filters: QueryFilter[] | QueryGroup) {
  let filterCount = 0,
    groupCount = 0;
  function count(item: QueryFilter | QueryGroup) {
    if (isGroup(item)) {
      groupCount++;
      item.items.forEach(count);
    } else filterCount++;
  }
  if (Array.isArray(filters)) filterCount = filters.length;
  else count(filters);
  if (filterCount > 20) throw new Error("Add up to 20 filters.");
  if (groupCount > 10) throw new Error("Add up to 10 groups.");
  if (!Array.isArray(filters)) {
    const logic = buildContactCondition(filters);
    const grouped = logic.startsWith("(") ? logic : `(${logic})`;
    return `SELECT Id FROM Contact\nWHERE Email != null${logic ? `\nAND ${grouped}` : ""}`;
  }
  const expressions = filters.map(filterExpression);
  let logic = expressions[0] ?? "";
  for (let i = 1; i < expressions.length; i++)
    logic = `(${logic} ${filters[i].conjunction} ${expressions[i]})`;
  return `SELECT Id FROM Contact\nWHERE Email != null${logic ? `\nAND (${logic})` : ""}`;
}
