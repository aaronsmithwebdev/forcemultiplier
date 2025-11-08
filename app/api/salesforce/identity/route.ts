import { NextResponse } from "next/server";

import { getSalesforceIdentity } from "@/lib/salesforceClient";

export async function GET() {
  try {
    const identity = await getSalesforceIdentity();
    if (!identity) {
      return NextResponse.json({ message: "Not connected" }, { status: 401 });
    }
    return NextResponse.json(identity);
  } catch (error) {
    console.error("Failed to fetch Salesforce identity", error);
    return NextResponse.json({ message: "Failed to fetch identity" }, { status: 500 });
  }
}
