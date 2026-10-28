import type { MergeTag } from "@templatical/types";

export const FUNRAISIN_FIELDS = [
  "FunraisinEventName",
  "FunraisinUsername",
  "FunraisinEventKey",
  "FunraisinFundraisingUrl",
  "FunraisinDateOfBirth",
  "FunraisinDonationCount",
  "FunraisinDonationTotal",
  "FunraisinLastDonatedAt",
  "FunraisinLastDonatedToName",
] as const;

export function mergeTagCatalog(fields: unknown[]): MergeTag[] {
  const paths = [
    ...new Set(
      fields.filter(
        (field): field is string =>
          typeof field === "string" && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(field),
      ),
    ),
  ];
  const samples: Record<string, string> = {
    FirstName: "Ada",
    LastName: "Lovelace",
    Email: "ada@example.org",
  };
  return [
    ...paths.map((path) => ({
      label: path
        .split(".")
        .map((part) =>
          part
            .replace(/__c$/, "")
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replaceAll("_", " "),
        )
        .join(" › "),
      value: `{{contact.${path}}}`,
      group: (FUNRAISIN_FIELDS as readonly string[]).includes(path)
        ? "Funraisin fields"
        : path.includes(".")
          ? "Related Salesforce fields"
          : "Contact fields",
      description: `${path.startsWith("Funraisin") ? "Funraisin" : "Salesforce"} ${path}`,
      ...(samples[path] ? { sample: samples[path] } : {}),
    })),
    {
      label: "Unsubscribe URL",
      value: "{{unsubscribe_url}}",
      group: "Delivery",
      description: "Required opt-out link for marketing email.",
    },
  ];
}
