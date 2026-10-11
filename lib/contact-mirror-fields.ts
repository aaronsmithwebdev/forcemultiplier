export const CORE_CONTACT_FIELDS = [
  "Id",
  "Email",
  "FirstName",
  "LastName",
  "HasOptedOutOfEmail",
  "SystemModstamp",
];

const SCALAR_TYPES = new Set([
  "string",
  "email",
  "phone",
  "url",
  "picklist",
  "multipicklist",
  "combobox",
  "boolean",
  "int",
  "double",
  "currency",
  "percent",
  "date",
  "datetime",
  "time",
  "id",
  "reference",
]);

export function mirrorFieldAllowed(field: {
  name: string;
  type: string;
  calculated?: boolean;
}) {
  return (
    !CORE_CONTACT_FIELDS.includes(field.name) &&
    !field.calculated &&
    SCALAR_TYPES.has(field.type)
  );
}
