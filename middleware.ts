import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Datbuy-only access gate (no dashboard login required).
//
// This is intentionally scoped ONLY to /datbuy/* and /api/hms/datbuy.
// Users must provide a shared access key (team secret) to use Datbuy.
const ACCESS_KEY = process.env.DATBUY_ACCESS_KEY || "";
const COOKIE_NAME = "datbuy_access";

function hasValidKey(req: NextRequest) {
  if (!ACCESS_KEY) return false;
  const fromHeader = req.headers.get("x-datbuy-key") || "";
  if (fromHeader && fromHeader === ACCESS_KEY) return true;
  const fromQuery = req.nextUrl.searchParams.get("key") || "";
  if (fromQuery && fromQuery === ACCESS_KEY) return true;
  const fromCookie = req.cookies.get(COOKIE_NAME)?.value || "";
  if (fromCookie && fromCookie === ACCESS_KEY) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  // If user passes key in query/header, persist it into a cookie for convenience.
  const url = req.nextUrl;

  if (hasValidKey(req)) {
    const res = NextResponse.next();
    // Persist only if query/header provided (cookie might already exist).
    const q = url.searchParams.get("key");
    if (q && q === ACCESS_KEY) {
      // remove key from url to avoid leaking via screenshots/shared links
      url.searchParams.delete("key");
      res.headers.set("Location", url.toString());
      res.cookies.set(COOKIE_NAME, ACCESS_KEY, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
      return res;
    }
    // If header matches, also set cookie
    if (req.headers.get("x-datbuy-key") === ACCESS_KEY) {
      res.cookies.set(COOKIE_NAME, ACCESS_KEY, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    }
    return res;
  }

  // No key: block.
  const isApi = url.pathname.startsWith("/api/");
  if (isApi) {
    return NextResponse.json({ error: "Forbidden", detail: "Datbuy access key required" }, { status: 403 });
  }
  // Redirect user to an access page.
  const accessUrl = new URL("/datbuy/access", req.url);
  accessUrl.searchParams.set("next", url.pathname + url.search);
  return NextResponse.redirect(accessUrl);
}

export const config = {
  matcher: [
    "/datbuy/:path*",
    "/api/hms/datbuy",
  ],
};
