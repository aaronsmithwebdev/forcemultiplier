import { NextRequest, NextResponse } from "next/server";

import { ensureSalesforceClient } from "@/lib/salesforceClient";

export async function GET(request: NextRequest) {
  try {
    const client = await ensureSalesforceClient();
    const { search, folder } = Object.fromEntries(request.nextUrl.searchParams);
    const reports = await client.listReports({
      search: search || undefined,
      folder: folder || undefined
    });
    return NextResponse.json(reports);
  } catch (error) {
    console.error("Failed to list reports", error);
    return NextResponse.json({ message: "Failed to list reports" }, { status: 500 });
  }
}
