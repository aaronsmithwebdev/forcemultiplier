import { NextRequest, NextResponse } from "next/server";

import { ensureSalesforceClient } from "@/lib/salesforceClient";

export async function GET(request: NextRequest) {
  const reportId = request.nextUrl.searchParams.get("reportId");
  if (!reportId) {
    return NextResponse.json({ message: "reportId is required" }, { status: 400 });
  }

  try {
    const client = await ensureSalesforceClient();
    const report = await client.getReport(reportId);
    return NextResponse.json(report);
  } catch (error) {
    console.error("Failed to fetch report", error);
    return NextResponse.json({ message: "Failed to fetch report" }, { status: 500 });
  }
}
