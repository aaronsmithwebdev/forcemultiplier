import { providerRequest, SF_VERSION, sfQuery } from "./providers";
import { AppError } from "./errors";
import { quote, sfId, validateQuery, combineFilterLogic } from "./soql";
export type MetadataField = {
  name: string;
  label: string;
  type: string;
  relationshipName?: string | null;
  referenceTo?: string[];
  filterable?: boolean;
  picklistValues?: { label: string; value: string; active: boolean }[];
};
export type ObjectMetadata = {
  name: string;
  label: string;
  fields: MetadataField[];
  childRelationships: {
    relationshipName: string | null;
    childSObject: string;
    field: string;
  }[];
};
export async function describe(object: string): Promise<ObjectMetadata> {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(object))
    throw new AppError("Invalid object name.");
  return providerRequest(
    "salesforce",
    `/services/data/${SF_VERSION}/sobjects/${object}/describe`,
  );
}
export async function validatePaths(paths: string[]) {
  if (paths.length > 30)
    throw new AppError("Select up to 30 additional fields.");
  const cache = new Map<string, ObjectMetadata>();
  async function metadata(name: string) {
    if (!cache.has(name)) cache.set(name, await describe(name));
    return cache.get(name)!;
  }
  for (const path of paths) {
    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,4}$/.test(path))
      throw new AppError("Choose a valid contact or parent field path.");
    let object = "Contact";
    const pieces = path.split(".");
    for (let i = 0; i < pieces.length; i++) {
      const info = await metadata(object);
      if (i === pieces.length - 1) {
        if (
          !info.fields.some(
            (f) =>
              f.name === pieces[i] &&
              !["address", "location", "base64"].includes(f.type),
          )
        )
          throw new AppError(
            `Field ${path} is unavailable or needs individual component fields.`,
          );
      } else {
        const field = info.fields.find((f) => f.relationshipName === pieces[i]);
        if (field?.referenceTo?.length !== 1)
          throw new AppError(
            `Relationship ${pieces[i]} is unavailable or has multiple target types.`,
          );
        object = field.referenceTo[0];
      }
    }
  }
}
export async function catalog(
  kind: string,
  search: string,
  cursor?: string | null,
) {
  if (kind === "reports")
    return sfQuery(
      `SELECT Id, Name, FolderName FROM Report${search ? ` WHERE Name LIKE ${quote("%" + search + "%")}` : ""} ORDER BY Name`,
      cursor,
    );
  if (kind === "campaigns")
    return sfQuery(
      `SELECT Id, Name FROM Campaign${search ? ` WHERE Name LIKE ${quote("%" + search + "%")}` : ""} ORDER BY Name`,
      cursor,
    );
  if (kind === "listviews")
    return providerRequest(
      "salesforce",
      cursor || `/services/data/${SF_VERSION}/sobjects/Contact/listviews`,
    );
  throw new AppError("Unknown source type.");
}
export async function sourceQuery(kind: string, id: string) {
  if (!sfId(id)) throw new AppError("Invalid Salesforce source ID.");
  if (kind === "campaign")
    return {
      query: `SELECT Id FROM Contact WHERE Id IN (SELECT ContactId FROM CampaignMember WHERE CampaignId = ${quote(id)} AND ContactId != null)`,
      notes: [
        "Includes all Contact members of this Campaign. Lead members are excluded.",
      ],
    };
  if (kind === "listview") {
    const data = await providerRequest(
      "salesforce",
      `/services/data/${SF_VERSION}/sobjects/Contact/listviews/${id}/describe`,
    );
    validateQuery(data.query);
    return {
      query: data.query,
      notes: ["Uses the saved Contact list view query."],
    };
  }
  if (kind === "report") {
    const data = await providerRequest(
      "salesforce",
      `/services/data/${SF_VERSION}/analytics/reports/${id}/describe`,
    );
    return translateReport(
      data,
      await describe("Contact"),
      await describe("Account"),
    );
  }
  throw new AppError("Unknown Salesforce source.");
}
// Narrow, fail-closed translator. Required child joins need an explicit SOQL semi-join.
export function translateReport(
  data: Record<string, any>,
  contact: ObjectMetadata,
  account: ObjectMetadata,
) {
  const m = data.reportMetadata ?? {};
  const gaps: string[] = [];
  if (m.reportType?.type !== "ContactList") {
    const objects = data.reportTypeMetadata?.objects;
    const roots = Array.isArray(objects)
      ? objects.filter((object: any) => object.joinType === "ROOT")
      : [];
    if (roots.length !== 1 || roots[0]?.apiName !== "Contact")
      gaps.push(
        "This custom report type must use Contact as its primary object.",
      );
    if (
      !Array.isArray(objects) ||
      objects.some(
        (object: any) =>
          object.joinType !== "ROOT" && object.joinType !== "OUTER",
      )
    )
      gaps.push(
        "Custom report types with required related records need a reviewed SOQL semi-join.",
      );
  }
  if (!["TABULAR", "SUMMARY", "MATRIX"].includes(m.reportFormat))
    gaps.push("Joined or unknown report formats need a reviewed SOQL query.");
  if (m.scope !== "organization")
    gaps.push(
      "Set Show Me to All Contacts; personal/team scopes are not translated yet.",
    );
  if (m.crossFilters?.length)
    gaps.push("Cross-filters need a reviewed SOQL query in this version.");
  if (m.topRows?.rowLimit || m.userOrHierarchyFilterId || m.division)
    gaps.push(
      "Row limits, hierarchy filters, or divisions require a reviewed query.",
    );
  if (m.standardFilters?.length)
    gaps.push(
      "This report has additional standard filters that need a reviewed query.",
    );
  if (m.historicalSnapshotDates?.length || m.historicalColumns?.length)
    gaps.push("Historical report rules are unsupported.");
  if (m.aggregateFilters?.length || m.summaryFilters?.length)
    gaps.push("Summary filters need a reviewed query.");
  const date = m.standardDateFilter;
  if (
    date &&
    !(
      date.durationValue === "ALL_TIME" ||
      (date.durationValue === "CUSTOM" && !date.startDate && !date.endDate)
    )
  )
    gaps.push(
      "Set the report date range to All Time, or use a reviewed SOQL date condition.",
    );
  const columns: Record<string, any> = {
    ...data.reportExtendedMetadata?.detailColumnInfo,
  };
  for (const category of Object.values(
    data.reportTypeMetadata?.categories ?? {},
  ) as any[])
    Object.assign(columns, category.columns ?? {});
  const filters: string[] = [];
  for (const f of m.reportFilters ?? []) {
    const column = columns[f.column];
    const entity = column?.entityColumnName;
    let path = "",
      field: MetadataField | undefined;
    if (typeof entity === "string" && entity.startsWith("Contact.")) {
      path = entity.slice(8);
      field = contact.fields.find((v) => v.name === path);
    } else if (typeof entity === "string" && entity.startsWith("Account.")) {
      path = "Account." + entity.slice(8);
      field = account.fields.find((v) => v.name === entity.slice(8));
    }
    if (
      !field ||
      field.filterable === false ||
      f.isValueField ||
      f.filterType === "fieldToField"
    ) {
      gaps.push(
        `Cannot resolve filter ${f.column} to an unambiguous supported field.`,
      );
      continue;
    }
    const raw = String(f.value ?? "");
    if (raw === "" || raw.includes(",")) {
      gaps.push(`Blank or multi-value filter ${f.column} requires review.`);
      continue;
    }
    let literal: string;
    if (field.type === "boolean") {
      if (!/^(true|false)$/i.test(raw)) {
        gaps.push(`Invalid boolean filter ${f.column}.`);
        continue;
      }
      literal = raw.toLowerCase();
    } else if (["double", "int", "percent"].includes(field.type)) {
      if (!/^-?\d+(\.\d+)?$/.test(raw)) {
        gaps.push(`Invalid number in ${f.column}.`);
        continue;
      }
      literal = raw;
    } else if (
      [
        "string",
        "email",
        "phone",
        "url",
        "picklist",
        "reference",
        "id",
      ].includes(field.type)
    ) {
      if (field.type === "picklist" && column.filterValues) {
        const choice = column.filterValues.find(
          (v: any) => v.name === raw || v.label === raw,
        );
        if (!choice) {
          gaps.push(`Unknown picklist value in ${f.column}.`);
          continue;
        }
        literal = quote(choice.name);
      } else literal = quote(raw);
    } else {
      gaps.push(`Filter type ${field.type} needs a reviewed query.`);
      continue;
    }
    const op: Record<string, string> = {
      equals: "=",
      notEqual: "!=",
      lessThan: "<",
      greaterThan: ">",
      lessOrEqual: "<=",
      greaterOrEqual: ">=",
    };
    if (op[f.operator]) filters.push(`${path} ${op[f.operator]} ${literal}`);
    else if (
      ["contains", "startsWith"].includes(f.operator) &&
      ["string", "email", "phone", "url"].includes(field.type)
    ) {
      const escaped = raw.replace(/[%_]/g, "\\$&");
      filters.push(
        `${path} LIKE ${quote((f.operator === "contains" ? "%" : "") + escaped + "%")}`,
      );
    } else gaps.push(`Unsupported operator ${f.operator} on ${f.column}.`);
  }
  if (gaps.length) return { query: null, notes: gaps };
  const where = combineFilterLogic(m.reportBooleanFilter, filters);
  const query = `SELECT Id FROM Contact${where ? " WHERE " + where : ""}`;
  validateQuery(query);
  return {
    query,
    notes: [
      "Translated supported report criteria. Additional contact fields are fetched separately. Compare membership with Salesforce before using this audience for outbound sync.",
    ],
  };
}
export async function enrich(records: Record<string, any>[], fields: string[]) {
  const ids = [...new Set(records.map((r) => r.Id))];
  if (ids.some((id) => typeof id !== "string" || !sfId(id)))
    throw new AppError(
      "The query returned records without valid Contact IDs.",
      502,
    );
  if (!ids.length) return [];
  const selected = [
    ...new Set([
      "Id",
      "FirstName",
      "LastName",
      "Email",
      "HasOptedOutOfEmail",
      ...fields,
    ]),
  ];
  const output: Record<string, any>[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const query = `SELECT ${selected.join(", ")} FROM Contact WHERE Id IN (${ids
      .slice(offset, offset + 200)
      .map(quote)
      .join(",")})`;
    let cursor: string | undefined;
    do {
      const page = await sfQuery(query, cursor);
      output.push(...page.records);
      cursor = page.done ? undefined : page.nextRecordsUrl;
      if (!page.done && !cursor)
        throw new AppError(
          "Salesforce returned an incomplete enrichment page.",
          502,
        );
    } while (cursor);
  }
  // A record disappearing between queries must not produce an apparently complete snapshot.
  if (
    output.length !== ids.length ||
    new Set(output.map((r) => r.Id)).size !== ids.length ||
    output.some((r) => !ids.includes(r.Id))
  )
    throw new AppError(
      "Contact visibility changed during extraction. Restart this pull to get a complete snapshot.",
      409,
    );
  const source = new Map(records.map((r) => [r.Id, r]));
  return output.map((r) => ({ ...source.get(r.Id), ...r }));
}
