import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { ensureSalesforceClient } from "@/lib/salesforceClient";
import { mapRowToContact } from "@/lib/reportMapping";

export async function POST(request: NextRequest) {
  const reportId = request.nextUrl.searchParams.get("reportId");

  if (!reportId) {
    return NextResponse.json({ message: "reportId is required" }, { status: 400 });
  }

  try {
    const client = await ensureSalesforceClient();
    const rows = await client.fetchReportRecords(reportId);

    const contacts = rows
      .map((row) => ({ ...mapRowToContact(row), reportId }))
      .filter((contact) => contact.name || contact.email || contact.company || contact.phone);

    await prisma.$transaction(async (tx) => {
      await tx.contact.deleteMany({ where: { reportId } });
      if (contacts.length) {
        await tx.contact.createMany({ data: contacts });
      }
      await tx.syncJob.create({ data: { reportId, records: contacts.length, status: "completed" } });
    });

    return NextResponse.json({ records: contacts.length });
  } catch (error) {
    console.error("Failed to sync report", error);
    await prisma.syncJob.create({ data: { reportId, records: 0, status: "failed" } }).catch(() => undefined);
    return NextResponse.json({ message: "Failed to sync report" }, { status: 500 });
  }
}
