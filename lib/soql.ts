import { parseQuery, composeQuery } from "@jetstreamapp/soql-parser-js";
import { AppError } from "./errors";
export const quote = (value: string) =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
export const sfId = (value: string) =>
  /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(value);
export function validateQuery(text: string) {
  if (!text.trim() || text.length > 20000)
    throw new AppError("Enter a Contact query of at most 20,000 characters.");
  let query;
  try {
    query = parseQuery(text);
  } catch {
    throw new AppError(
      "This SOQL query could not be parsed. Check its syntax.",
    );
  }
  if (query.sObject?.toLowerCase() !== "contact" || query.sObjectAlias)
    throw new AppError(
      "Audience queries must select from Contact, without a root alias.",
    );
  if (
    !query.fields?.some(
      (f) => f.type === "Field" && f.field.toLowerCase() === "id",
    )
  )
    throw new AppError(
      "Include Id in SELECT so contacts can be identified reliably.",
    );
  if (
    query.fields.some((f) => !["Field", "FieldRelationship"].includes(f.type))
  )
    throw new AppError(
      "Select contact or parent fields. Child SELECT subqueries and aggregate SELECT fields are not supported in this first version.",
    );
  function inspect(node: unknown) {
    if (!node || typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    if (
      object.for ||
      object.update ||
      object.withAccessLevel ||
      object.offset !== undefined ||
      object.groupBy ||
      object.having
    )
      throw new AppError(
        "Queries cannot use locking, tracking, access-mode overrides, OFFSET, or aggregate grouping.",
      );
    for (const item of Object.values(object)) inspect(item);
  }
  inspect(query);
  const orderBy = !query.orderBy
    ? []
    : Array.isArray(query.orderBy)
      ? query.orderBy
      : [query.orderBy];
  const tieBreaker = orderBy.at(-1);
  if (
    query.limit !== undefined &&
    (!tieBreaker ||
      !("field" in tieBreaker) ||
      tieBreaker.field.toLowerCase() !== "id")
  )
    throw new AppError(
      "A limited audience needs ORDER BY ending in Id as a stable tie-breaker. Remove LIMIT to pull the whole audience.",
    );
  return query;
}
export function previewQuery(text: string) {
  const query = validateQuery(text);
  query.limit = Math.min(query.limit ?? 25, 25);
  return composeQuery(query);
}
export function combineFilterLogic(
  logic: string | null | undefined,
  filters: string[],
) {
  if (!filters.length) {
    if (logic?.trim())
      throw new AppError("Report filter logic has no corresponding filters.");
    return "";
  }
  if (!logic?.trim()) return filters.map((f) => `(${f})`).join(" AND ");
  const tokens = logic.match(/\d+|AND|OR|NOT|\(|\)/gi) ?? [];
  if (tokens.join("").toUpperCase() !== logic.replace(/\s+/g, "").toUpperCase())
    throw new AppError("Unsupported report filter logic.");
  let position = 0;
  const used = new Set<number>();
  function atom(): string {
    const token = tokens[position++];
    if (token?.toUpperCase() === "NOT") return `(NOT ${atom()})`;
    if (token === "(") {
      const expression = or();
      if (tokens[position++] !== ")")
        throw new AppError("Unbalanced report filter logic.");
      return `(${expression})`;
    }
    if (!token || !/^\d+$/.test(token) || !filters[Number(token) - 1])
      throw new AppError("Invalid filter number in report logic.");
    used.add(Number(token));
    return `(${filters[Number(token) - 1]})`;
  }
  function and(): string {
    let expression = atom();
    while (tokens[position]?.toUpperCase() === "AND") {
      position++;
      expression = `${expression} AND ${atom()}`;
    }
    return expression;
  }
  function or(): string {
    let expression = and();
    while (tokens[position]?.toUpperCase() === "OR") {
      position++;
      expression = `${expression} OR ${and()}`;
    }
    return expression;
  }
  const result = or();
  if (position !== tokens.length || used.size !== filters.length)
    throw new AppError("Report logic does not cover all filters.");
  return result;
}
