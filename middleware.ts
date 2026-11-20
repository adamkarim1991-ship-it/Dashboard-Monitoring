import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

// Datbuy East must be restricted to Jatinegara team (admin allowed).
// Jatinegara HMS hub id (authoritative scope gate)
const JATINEGARA_HMS_HUB_ID = "460450593288";

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // Public routes (leave the rest of the site unchanged)
  if (url.pathname === "/login" || url.pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const session = await auth();
  const isApi = url.pathname.startsWith("/api/");

  if (!session?.user?.id) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", url.pathname + url.search);
    return NextResponse.redirect(loginUrl);
  }

  const role = String((session.user as any).role || "").toLowerCase();
  const hmsHubIds: string[] = Array.isArray((session.user as any).hmsHubIds)
    ? (session.user as any).hmsHubIds.map(String)
    : [];

  const allowed = role === "admin" || hmsHubIds.includes(JATINEGARA_HMS_HUB_ID);

  if (!allowed) {
    if (isApi) {
      return NextResponse.json(
        {
          error: "Forbidden",
          detail: "Datbuy East is restricted to Jatinegara users only.",
        },
        { status: 403 }
      );
    }
    const deniedUrl = new URL("/login", req.url);
    deniedUrl.searchParams.set("denied", "1");
    return NextResponse.redirect(deniedUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/datbuy/east/:path*",
    "/api/hms/datbuy",
  ],
};
