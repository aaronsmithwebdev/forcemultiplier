export const timeZones = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Hobart",
  "Australia/Darwin",
  "UTC",
] as const;

export const defaultTimeZone = "Australia/Sydney";

export function formatDate(
  value: string | Date | null | undefined,
  timeZone: string,
) {
  return value
    ? new Date(value).toLocaleString("en-AU", {
        timeZone,
        timeZoneName: "short",
      })
    : "Not yet";
}
