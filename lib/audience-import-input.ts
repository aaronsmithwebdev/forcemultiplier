import { AppError } from "./errors";
import { parseEmailCsv } from "./resubscribe-input";

export const AUDIENCE_IMPORT_MAX_ROWS = 50_000;
export const AUDIENCE_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const AUDIENCE_IMPORT_BATCH_SIZE = 500;

export type ImportRow = {
  row: number;
  email: string;
  firstName: string;
  lastName: string;
  status: "invalid" | "duplicate" | "matched" | "new" | "ambiguous";
  candidates: {
    id: string;
    name: string;
    salesforceId: string | null;
    currentEmail?: string | null;
  }[];
  existingMembership?: boolean;
  blocked: boolean;
  personId?: string;
};
export function parseAudienceImport(text: string, format: "csv" | "paste") {
  const rows: ImportRow[] = [];
  // ponytail: parsing is bounded to 50,000 rows / 20 MB; stream larger files if that ceiling changes.
  if (new TextEncoder().encode(text).byteLength > AUDIENCE_IMPORT_MAX_BYTES)
    throw new AppError("Import must be 20 MB or smaller.", 413);
  const csv =
    format === "paste"
      ? "Email\n" +
        text
          .split(/[\r\n;,]+/)
          .filter((v) => v.trim())
          .join("\n")
      : text;
  try {
    parseEmailCsv(csv, ({ values, headers, email, status }) => {
      if (rows.length >= AUDIENCE_IMPORT_MAX_ROWS)
        throw new Error("Import at most 50,000 rows at a time.");
      const value = (key: string) =>
        (values[headers.indexOf(key)] || "").trim().slice(0, 150);
      rows.push({
        row: rows.length + 1,
        email: email || value("email") || value("emailaddress"),
        firstName: value("firstname"),
        lastName: value("lastname"),
        status: status === "valid" ? "new" : status,
        candidates: [],
        blocked: false,
      });
    });
  } catch (error) {
    throw new AppError((error as Error).message, 422);
  }
  return rows;
}

export function audienceImportCsv(
  rows: Pick<ImportRow, "email" | "firstName" | "lastName">[],
) {
  const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  return (
    "Email,First Name,Last Name\n" +
    rows
      .map((row) =>
        [row.email, row.firstName, row.lastName].map(cell).join(","),
      )
      .join("\n")
  );
}
