export type QueryFilter = {
  field: string;
  type: string;
  operator: string;
  value: string;
  conjunction: "AND" | "OR";
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

function quoted(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
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

export function buildContactQuery(filters: QueryFilter[]) {
  if (filters.length > 20) throw new Error("Add up to 20 filters.");
  const expressions = filters.map((filter) => {
    if (!fieldName.test(filter.field)) throw new Error("Choose a valid field.");
    if (filter.operator === "is_null") return `${filter.field} = null`;
    if (filter.operator === "not_null") return `${filter.field} != null`;
    const value = formattedValue(filter);
    if (filter.operator === "contains")
      return `${filter.field} LIKE ${quoted(`%${filter.value.trim()}%`)}`;
    if (filter.operator === "starts")
      return `${filter.field} LIKE ${quoted(`${filter.value.trim()}%`)}`;
    if (["includes", "excludes"].includes(filter.operator))
      return `${filter.field} ${filter.operator.toUpperCase()} (${value})`;
    const operator = comparisonOperators[filter.operator];
    if (!operator) throw new Error("Choose a valid operator.");
    return `${filter.field} ${operator} ${value}`;
  });
  let logic = expressions[0] ?? "";
  for (let i = 1; i < expressions.length; i++)
    logic = `(${logic} ${filters[i].conjunction} ${expressions[i]})`;
  return `SELECT Id FROM Contact\nWHERE Email != null${logic ? `\nAND (${logic})` : ""}`;
}
