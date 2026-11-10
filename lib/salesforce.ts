import { providerRequest, SF_VERSION, sfQuery } from "./providers";
import { AppError } from "./errors";
import {
  quote,
  sfId,
  validateQuery,
  combineFilterLogic,
  previewQuery,
} from "./soql";
export type MetadataField = {
  name: string;
  label: string;
  type: string;
  calculated?: boolean;
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
export async function describe(
  object: string,
  externalId?: string,
): Promise<ObjectMetadata> {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(object))
    throw new AppError("Invalid object name.");
  return providerRequest(
    "salesforce",
    `/services/data/${SF_VERSION}/sobjects/${object}/describe`,
    {},
    externalId ? { externalId } : undefined,
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
    const related: Record<string, ObjectMetadata> = {};
    for (const cross of data.reportMetadata?.crossFilters ?? []) {
      const names =
        cross.relatedEntity === "OCR-Opportunity"
          ? ["OpportunityContactRole", "Opportunity"]
          : [cross.relatedEntity];
      for (const name of names)
        if (/^[A-Za-z][A-Za-z0-9_]*$/.test(name) && !related[name])
          related[name] = await describe(name);
    }
    const recordTypes = related.Opportunity
      ? (
          await sfQuery(
            "SELECT Id, Name FROM RecordType WHERE SobjectType = 'Opportunity'",
          )
        ).records
      : [];
    return translateReport(
      data,
      await describe("Contact"),
      await describe("Account"),
      related,
      recordTypes,
    );
  }
  throw new AppError("Unknown Salesforce source.");
}
type ReportPostFilter = {
  object: string;
  joinField: string;
  criteria: string[];
  includesObject: boolean;
};
const reportPrefix = "report:";
export async function reportPage(
  savedQuery: string,
  cursor: string | null = null,
  orgId?: string,
  preview = false,
) {
  if (!savedQuery.startsWith(reportPrefix))
    throw new AppError("Stored report query is invalid.", 409);
  let plan: {
    query: string;
    postFilter: ReportPostFilter;
  };
  try {
    plan = JSON.parse(savedQuery.slice(reportPrefix.length));
  } catch {
    throw new AppError("Stored report query is invalid.", 409);
  }
  if (typeof plan.query !== "string" || !plan.postFilter)
    throw new AppError("Stored report query is invalid.", 409);
  validateQuery(plan.query);
  const { object, joinField, criteria, includesObject } = plan.postFilter;
  if (
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(object) ||
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(joinField) ||
    !Array.isArray(criteria) ||
    typeof includesObject !== "boolean"
  )
    throw new AppError("Stored report query is invalid.", 409);
  const page = await sfQuery(
    preview ? previewQuery(plan.query) : plan.query,
    cursor,
    orgId,
  );
  if (!Array.isArray(page.records))
    throw new AppError("Salesforce returned an incomplete report page.", 502);
  const ids = page.records.map((record: any) => record.Id);
  if (!ids.length) return { ...page, scanned: 0 };
  const query = `SELECT ${joinField} FROM ${object} WHERE ${joinField} IN (${ids.map(quote).join(",")})${criteria.length ? " AND " + criteria.map((clause) => `(${clause})`).join(" AND ") : ""}`;
  const matches = new Set<string>();
  const seen = new Set<string>();
  let next: string | undefined;
  do {
    const related = await sfQuery(query, next, orgId);
    if (!Array.isArray(related.records))
      throw new AppError("Report cross-filter results were incomplete.", 502);
    for (const row of related.records)
      if (row[joinField]) matches.add(row[joinField]);
    next = related.done ? undefined : related.nextRecordsUrl;
    if (!related.done && (!next || seen.has(next)))
      throw new AppError("Report cross-filter results were incomplete.", 502);
    if (next) seen.add(next);
  } while (next);
  return {
    ...page,
    scanned: page.records.length,
    records: page.records.filter(
      (record: any) => matches.has(record.Id) === includesObject,
    ),
  };
}

// Narrow, fail-closed translator. Required child joins need an explicit SOQL semi-join.
export function translateReport(
  data: Record<string, any>,
  contact: ObjectMetadata,
  account: ObjectMetadata,
  related: Record<string, ObjectMetadata> = {},
  recordTypes: { Id: string; Name: string }[] = [],
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
    const required = Array.isArray(objects)
      ? objects.filter((object: any) => object.joinType === "INNER")
      : [];
    if (
      !Array.isArray(objects) ||
      objects.some(
        (object: any) => !["ROOT", "OUTER", "INNER"].includes(object.joinType),
      ) ||
      (required.length > 0 &&
        !(
          m.reportType?.type === "Contacts_with_Donor_Opportunities__c" &&
          required.length === 1 &&
          required[0].apiName === "Opportunity" &&
          m.crossFilters?.some(
            (cross: any) =>
              cross.relatedEntity === "Opportunity" &&
              cross.relatedEntityJoinField === "Donor__c" &&
              cross.includesObject === true,
          )
        ))
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
  if ((m.crossFilters?.length ?? 0) > 3)
    gaps.push("Reports with more than three cross-filters need review.");
  if (
    m.crossFilters?.length &&
    /\b(?:OR|NOT)\b/i.test(m.reportBooleanFilter ?? "")
  )
    gaps.push(
      "Cross-filters cannot use OR or NOT report filter logic in SOQL.",
    );
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
  function filterClause(
    f: any,
    path: string,
    field: MetadataField | undefined,
    column: any,
  ) {
    if (
      !field ||
      field.filterable === false ||
      f.isValueField ||
      f.filterType === "fieldToField"
    ) {
      gaps.push(
        `Cannot resolve filter ${f.column} to an unambiguous supported field.`,
      );
      return null;
    }
    const raw = String(f.value ?? "");
    if (raw === "" || raw.includes(",")) {
      gaps.push(`Blank or multi-value filter ${f.column} requires review.`);
      return null;
    }
    let literal: string;
    if (field.type === "boolean") {
      if (!/^(true|false)$/i.test(raw)) {
        gaps.push(`Invalid boolean filter ${f.column}.`);
        return null;
      }
      literal = raw.toLowerCase();
    } else if (["double", "int", "percent"].includes(field.type)) {
      if (!/^-?\d+(\.\d+)?$/.test(raw)) {
        gaps.push(`Invalid number in ${f.column}.`);
        return null;
      }
      literal = raw;
    } else if (field.type === "date") {
      const months = /^LAST ([1-9]\d*) MONTHS$/i.exec(raw);
      if (
        months &&
        Number.isSafeInteger(Number(months[1])) &&
        f.operator === "equals"
      )
        literal = `LAST_N_MONTHS:${Number(months[1])}`;
      else if (
        /^\d{4}-\d{2}-\d{2}$/.test(raw) &&
        !Number.isNaN(Date.parse(raw)) &&
        new Date(raw).toISOString().slice(0, 10) === raw
      )
        literal = raw;
      else {
        gaps.push(`Date filter ${f.column} needs a reviewed query.`);
        return null;
      }
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
          return null;
        }
        literal = quote(choice.name);
      } else literal = quote(raw);
    } else {
      gaps.push(`Filter type ${field.type} needs a reviewed query.`);
      return null;
    }
    const op: Record<string, string> = {
      equals: "=",
      notEqual: "!=",
      lessThan: "<",
      greaterThan: ">",
      lessOrEqual: "<=",
      greaterOrEqual: ">=",
    };
    if (op[f.operator]) return `${path} ${op[f.operator]} ${literal}`;
    if (
      ["contains", "startsWith"].includes(f.operator) &&
      ["string", "email", "phone", "url"].includes(field.type)
    ) {
      const escaped = raw.replace(/[%_]/g, "\\$&");
      return `${path} LIKE ${quote((f.operator === "contains" ? "%" : "") + escaped + "%")}`;
    }
    if (
      f.operator === "notContain" &&
      ["string", "email", "phone", "url"].includes(field.type)
    ) {
      const escaped = raw.replace(/[%_]/g, "\\$&");
      return `NOT (${path} LIKE ${quote("%" + escaped + "%")})`;
    }
    gaps.push(`Unsupported operator ${f.operator} on ${f.column}.`);
    return null;
  }
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
    const clause = filterClause(f, path, field, column);
    if (clause) filters.push(clause);
  }
  const crossClauses: string[] = [];
  let postFilter: ReportPostFilter | null = null;
  for (const cross of m.crossFilters ?? []) {
    const opportunity = cross.relatedEntity === "OCR-Opportunity";
    const child =
      related[opportunity ? "OpportunityContactRole" : cross.relatedEntity];
    const criteriaObject = opportunity ? related.Opportunity : child;
    const join = child?.fields.find(
      (field) => field.name === cross.relatedEntityJoinField,
    );
    if (
      (cross.primaryEntityField !== "CONTACT_ID" &&
        !sfId(cross.primaryEntityField)) ||
      typeof cross.includesObject !== "boolean" ||
      !child ||
      child.name === "Contact" ||
      !criteriaObject ||
      join?.referenceTo?.length !== 1 ||
      join.referenceTo[0] !== "Contact" ||
      (opportunity &&
        !child.fields.some(
          (field) =>
            field.relationshipName === "Opportunity" &&
            field.referenceTo?.length === 1 &&
            field.referenceTo[0] === "Opportunity",
        ))
    ) {
      gaps.push(
        `Cross-filter ${cross.relatedEntity} has an unsupported relationship.`,
      );
      continue;
    }
    const criteria: string[] = [];
    for (const f of cross.criteria ?? []) {
      if (
        opportunity &&
        f.column === "RecordTypeId" &&
        f.operator === "equals"
      ) {
        const names = String(f.value ?? "")
          .split(",")
          .map((v) => v.trim());
        const ids = names.map((name) =>
          recordTypes.filter((type) => type.Name === name && sfId(type.Id)),
        );
        if (
          names.some((name) => !name) ||
          ids.some((matches) => matches.length !== 1)
        ) {
          gaps.push(
            "Opportunity record types in the cross-filter could not be resolved.",
          );
          continue;
        }
        criteria.push(
          `Opportunity.RecordTypeId IN (${ids.map((matches) => quote(matches[0].Id)).join(", ")})`,
        );
        continue;
      }
      const name = String(f.column ?? "").replace(
        new RegExp(`^${criteriaObject.name}\\.`),
        "",
      );
      const field = criteriaObject.fields.find((item) => item.name === name);
      const path = `${opportunity ? "Opportunity." : ""}${name}`;
      const clause = filterClause(f, path, field, columns[f.column]);
      if (clause) criteria.push(clause);
    }
    if (criteria.length !== (cross.criteria ?? []).length) continue;
    if (crossClauses.length < 2)
      crossClauses.push(
        `Id ${cross.includesObject ? "IN" : "NOT IN"} (SELECT ${join.name} FROM ${child.name}${criteria.length ? " WHERE " + criteria.map((clause) => `(${clause})`).join(" AND ") : ""})`,
      );
    else if (!postFilter && !opportunity)
      postFilter = {
        object: child.name,
        joinField: join.name,
        criteria,
        includesObject: cross.includesObject,
      };
    else gaps.push("The additional cross-filter needs a reviewed query.");
  }
  if (gaps.length) return { query: null, notes: gaps };
  const where = combineFilterLogic(m.reportBooleanFilter, filters);
  const clauses = [
    where,
    ...crossClauses.map((clause) => `(${clause})`),
  ].filter(Boolean);
  const query = `SELECT Id FROM Contact${clauses.length ? " WHERE " + clauses.join(" AND ") : ""}`;
  validateQuery(query);
  return {
    query,
    ...(postFilter
      ? {
          executionQuery: reportPrefix + JSON.stringify({ query, postFilter }),
        }
      : {}),
    notes: [
      "Translated supported report criteria. Additional contact fields are fetched separately. Compare membership with Salesforce before using this audience for outbound sync.",
      ...(postFilter
        ? [
            "A third cross-filter is applied to each pull page; the displayed SOQL is only the first stage.",
          ]
        : []),
    ],
  };
}
export async function enrich(
  records: Record<string, any>[],
  fields: string[],
  orgId?: string,
  allowMissing = false,
) {
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
      const page = await sfQuery(query, cursor, orgId);
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
    (!allowMissing && output.length !== ids.length) ||
    new Set(output.map((r) => r.Id)).size !== output.length ||
    output.some((r) => !ids.includes(r.Id))
  )
    throw new AppError(
      "Contact visibility changed during extraction. Restart this pull to get a complete snapshot.",
      409,
    );
  const source = new Map(records.map((r) => [r.Id, r]));
  return output.map((r) => ({ ...source.get(r.Id), ...r }));
}
