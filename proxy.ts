import type { NextRequest } from "next/server";
import { refreshAuth } from "@/lib/supabase";

export const proxy = (request: NextRequest) => refreshAuth(request);

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
