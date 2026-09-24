import { db } from "./db";
import { normalizedEmail } from "./email";
import { AppError } from "./errors";

export async function suppressionState() {
  const [total, recent] = await Promise.all([
    db.suppression.count(),
    db.suppression.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        email: true,
        kind: true,
        source: true,
        sourceRef: true,
        occurredAt: true,
        createdAt: true,
      },
    }),
  ]);
  return { total, recent };
}

export async function importSuppressions(
  values: string[],
  sourceRef: string,
  userId: string,
) {
  const emails = [
    ...new Set(values.map(normalizedEmail).filter(Boolean)),
  ] as string[];
  if (!emails.length)
    throw new AppError("This upload contains no valid emails.");
  const result = await db.suppression.createMany({
    data: emails.map((email) => ({
      email,
      source: "csv_import",
      sourceRef,
      createdBy: userId,
    })),
    skipDuplicates: true,
  });
  return {
    submitted: emails.length,
    added: result.count,
    existing: emails.length - result.count,
  };
}
