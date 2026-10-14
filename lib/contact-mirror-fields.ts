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

// shortcut: Formula edits need a reviewed mirror rebuild; add definition checks if edits become routine.
const CONTACT_ONLY_FORMULAS = new Set([
  "Donor_Type__c",
  "mito_Registry__c",
  "All_Mito_Connections__c",
]);

type ContactField = {
  name: string;
  type: string;
  calculated?: boolean;
  filterable?: boolean;
};

export function mirrorFieldReason(field: ContactField): string | null {
  if (CORE_CONTACT_FIELDS.includes(field.name)) return "Always included";
  if (field.calculated && !CONTACT_ONLY_FORMULAS.has(field.name))
    return "Calculated field: can change without a Contact update";
  if (field.type === "textarea") return "Long text is not mirrored";
  if (field.type === "encryptedstring")
    return "Encrypted fields are not mirrored";
  if (["address", "location"].includes(field.type))
    return "Choose individual component fields";
  if (!SCALAR_TYPES.has(field.type)) return "This field type is not mirrored";
  return null;
}

export function mirrorFieldAllowed(field: ContactField) {
  return mirrorFieldReason(field) === null;
}

export function mirrorExclusionFieldAllowed(field: ContactField) {
  return (
    field.filterable !== false &&
    (CORE_CONTACT_FIELDS.includes(field.name) || mirrorFieldAllowed(field))
  );
}
