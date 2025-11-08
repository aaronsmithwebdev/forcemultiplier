import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const reportId = searchParams.get("reportId");

  const contacts = await prisma.contact.findMany({
    where: reportId ? { reportId } : undefined,
    orderBy: { syncedAt: "desc" }
  });

  return NextResponse.json(contacts);
}
