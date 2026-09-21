export function normalizedEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return email &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}
