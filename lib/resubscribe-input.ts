import { normalizedEmail } from "./email";

export const RESUBSCRIBE_DAILY_LIMIT = 2500;
export const RESUBSCRIBE_CALL_LIMIT = 5000;
export const RESUBSCRIBE_MAX_ROWS = 100000;

// ponytail: bounded in-memory CSV parsing (20 MB); use a streaming parser for larger imports.
export function parseResubscribeCsv(text: string) {
  if (text.length > 20 * 1024 * 1024)
    throw new Error("CSV must be 20 MB or smaller.");
  text = text.replace(/^\uFEFF/, "");
  let field = "",
    row: string[] = [],
    quoted = false,
    closed = false;
  let column = -1,
    rows = 0,
    invalid = 0,
    duplicates = 0;
  const emails = new Set<string>();
  function finishRow() {
    row.push(field);
    field = "";
    if (row.some((value) => value.trim())) {
      if (column < 0) {
        const matches = row
          .map((value, i) =>
            /^(email|emailaddress)$/i.test(value.trim().replace(/[ _-]/g, ""))
              ? i
              : -1,
          )
          .filter((i) => i >= 0);
        if (matches.length !== 1)
          throw new Error(
            "CSV needs exactly one Email or Email Address column.",
          );
        column = matches[0];
      } else {
        if (++rows > RESUBSCRIBE_MAX_ROWS)
          throw new Error("CSV can contain at most 100,000 contact rows.");
        const email = normalizedEmail(row[column]);
        if (!email) invalid++;
        else if (emails.has(email)) duplicates++;
        else emails.add(email);
      }
    }
    row = [];
    closed = false;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("Malformed CSV quoting.");
      field += char;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (field || row.length || closed) finishRow();
  if (!emails.size)
    throw new Error(
      "CSV contains no valid email addresses (maximum 254 characters per address).",
    );
  return { emails: [...emails], rows, invalid, duplicates };
}

export type ResubscribeFilters = {
  presentField: string | null;
  amountField: string | null;
  minimumAmount: number | null;
};

export function matchesResubscribeFilters(
  record: Record<string, unknown>,
  filters: ResubscribeFilters,
) {
  const present = filters.presentField ? record[filters.presentField] : true;
  const amount = filters.amountField ? record[filters.amountField] : null;
  return (
    (!filters.presentField ||
      (typeof present === "string"
        ? present.trim().length > 0
        : typeof present === "number"
          ? present > 0
          : present === true)) &&
    (!filters.amountField ||
      (typeof amount === "number" &&
        Number.isFinite(amount) &&
        amount > (filters.minimumAmount ?? 0)))
  );
}

export function resubscribePayload(
  contact: Record<string, any>,
  listId: string,
) {
  if (
    !contact.email_address?.address ||
    !Array.isArray(contact.list_memberships)
  )
    throw new Error("Contact details or list memberships are missing.");
  const lists = [...new Set([...contact.list_memberships, listId])];
  if (lists.length > 50)
    throw new Error("Contact already belongs to the maximum number of lists.");
  const core = [
    "first_name",
    "last_name",
    "job_title",
    "company_name",
    "birthday_month",
    "birthday_day",
    "anniversary",
    "create_source",
  ];
  return {
    ...Object.fromEntries(
      core
        .filter((key) => contact[key] !== undefined && contact[key] !== null)
        .map((key) => [key, contact[key]]),
    ),
    email_address: {
      address: contact.email_address.address,
      permission_to_send: "explicit",
    },
    update_source: "Contact",
    lists,
  };
}
