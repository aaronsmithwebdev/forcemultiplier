// Shared provider boundary for older pull fixtures; real identity SQL is checked separately.
export function salesforcePeopleFixture(sql: { values: unknown[] }) {
  const rows = [];
  for (let i = 0; i < sql.values.length; i += 7) {
    const [, orgId, salesforceId, email, firstName, lastName, optedOut] =
      sql.values.slice(i, i + 7);
    rows.push({
      id: `person:${salesforceId}`,
      orgId,
      salesforceId,
      email,
      firstName,
      lastName,
      optedOut,
      unavailable: false,
      mergedIntoId: null,
      source: "salesforce",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return rows;
}
