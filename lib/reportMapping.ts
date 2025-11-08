const nameHints = ["name", "full_name", "contact_name"];
const emailHints = ["email", "e-mail"];
const companyHints = ["company", "account", "organization"];
const phoneHints = ["phone", "mobile", "telephone"];

type Row = Record<string, string | number | null>;

type ContactRecord = {
  name?: string | null;
  email?: string | null;
  company?: string | null;
  phone?: string | null;
};

export function mapRowToContact(row: Row): ContactRecord {
  const lowerCaseKeys = Object.keys(row).map((key) => ({ key, normalized: key.toLowerCase() }));

  const getValue = (hints: string[]) => {
    const match = lowerCaseKeys.find(({ normalized }) => hints.some((hint) => normalized.includes(hint)));
    return match ? sanitizeValue(row[match.key]) : null;
  };

  return {
    name: getValue(nameHints),
    email: getValue(emailHints),
    company: getValue(companyHints),
    phone: getValue(phoneHints)
  };
}

function sanitizeValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}
