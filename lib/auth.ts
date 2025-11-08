import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";

export const SALESFORCE_USER_COOKIE = "sf_user_id";

export function getCurrentUserId() {
  const cookieStore = cookies();
  return cookieStore.get(SALESFORCE_USER_COOKIE)?.value ?? null;
}

export async function getSalesforceToken() {
  const userId = getCurrentUserId();
  if (!userId) return null;
  return prisma.salesforceToken.findUnique({ where: { userId } });
}

export async function upsertSalesforceToken(params: {
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  instanceUrl: string;
}) {
  const existing = await prisma.salesforceToken.findUnique({ where: { userId: params.userId } });
  const refreshToken = params.refreshToken ?? existing?.refreshToken ?? "";

  return prisma.salesforceToken.upsert({
    where: { userId: params.userId },
    update: {
      accessToken: params.accessToken,
      refreshToken,
      instanceUrl: params.instanceUrl,
      issuedAt: new Date()
    },
    create: {
      userId: params.userId,
      accessToken: params.accessToken,
      refreshToken,
      instanceUrl: params.instanceUrl
    }
  });
}
