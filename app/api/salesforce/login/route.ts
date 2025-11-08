import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const LOGIN_BASE_URL = process.env.SALESFORCE_LOGIN_BASE_URL ?? "https://login.salesforce.com";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

export async function GET() {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const redirectUri = process.env.SALESFORCE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { message: "Missing Salesforce environment variables" },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();
  const cookieStore = cookies();
  cookieStore.set("sf_oauth_state", state, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    path: "/",
    maxAge: 60 * 10
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "refresh_token api",
    state
  });

  return NextResponse.redirect(`${LOGIN_BASE_URL}/services/oauth2/authorize?${params.toString()}`);
}
