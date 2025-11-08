import axios from "axios";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { SALESFORCE_USER_COOKIE, upsertSalesforceToken } from "@/lib/auth";

const LOGIN_BASE_URL = process.env.SALESFORCE_LOGIN_BASE_URL ?? "https://login.salesforce.com";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = cookies();
  const storedState = cookieStore.get("sf_oauth_state")?.value;

  if (error) {
    return NextResponse.redirect(`/?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !storedState || state !== storedState) {
    return NextResponse.redirect("/?error=oauth_state_mismatch");
  }

  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const redirectUri = process.env.SALESFORCE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect("/?error=missing_env");
  }

  try {
    const tokenResponse = await axios.post(
      `${LOGIN_BASE_URL}/services/oauth2/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      })
    );

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      instance_url: instanceUrl,
      id: identityUrl
    } = tokenResponse.data;

    const identityResponse = await axios.get(identityUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const userId: string = identityResponse.data?.user_id;

    if (!userId) {
      return NextResponse.redirect("/?error=missing_user");
    }

    await upsertSalesforceToken({
      userId,
      accessToken,
      refreshToken,
      instanceUrl
    });

    cookieStore.set(SALESFORCE_USER_COOKIE, userId, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });

    cookieStore.delete("sf_oauth_state");

    return NextResponse.redirect("/reports");
  } catch (oauthError) {
    console.error("Salesforce OAuth failed", oauthError);
    return NextResponse.redirect("/?error=oauth_failed");
  }
}
