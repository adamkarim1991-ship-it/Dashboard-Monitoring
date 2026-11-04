import { auth } from "@/lib/auth";
import { resolveHmsToken } from "@/lib/hms-context";
import { getWibRangeUnix } from "@/lib/wib-range";
import { refreshStoredHmsToken } from "@/lib/hms-token-refresh";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ambil token HMS (cookie / memory / database / env)
  const { token: hmsToken } = await resolveHmsToken(req, session.user.id, session.user);

  if (!hmsToken) {
    return NextResponse.json(
      {
        error: "No HMS token",
        message:
          "Token HMS belum tersedia. Buka HMS di tab lain dengan extension GTL Bridge aktif.",
      },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page") ?? "1";

  // Default window is the full operational month (one calendar month back ..
  // today), never a rolling 24h slice: the daily table and every card must see
  // the same window.
  const defaultRange = getWibRangeUnix();
  const fromTs = searchParams.get("from") ?? String(defaultRange.from);
  const toTs = searchParams.get("to") ?? String(defaultRange.to);

  const url = new URL(
    `${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`
  );
  url.searchParams.set("type", "order_management");
  url.searchParams.set("leg_type", "last_mile");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("tab", "order_view");
  url.searchParams.set("created_at_from", fromTs);
  url.searchParams.set("created_at_to", toTs);
  url.searchParams.set("page", page);

  const doFetch = (bearer: string) =>
    fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en",
        Origin: "https://gtl-id.tokgistic.com",
        Referer: "https://gtl-id.tokgistic.com/hms/order-management",
      },
      cache: "no-store",
    });

  let hmsRes = await doFetch(hmsToken);
  if (hmsRes.status === 401) {
    const refreshed = await refreshStoredHmsToken(session.user.id, hmsToken);
    if (refreshed) {
      console.warn("[shipments] HMS token refreshed after 401");
      hmsRes = await doFetch(refreshed.token);
    }
  }

  if (!hmsRes.ok) {
    const text = await hmsRes.text();

    // Kalau 401, berarti token user expired
    if (hmsRes.status === 401) {
      return NextResponse.json(
        {
          error: "HMS token expired",
          message:
            "Token HMS kamu expired. Buka HMS lagi di tab lain untuk refresh.",
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: "HMS API failed",
        status: hmsRes.status,
        detail: text.slice(0, 500),
      },
      { status: 502 }
    );
  }

  const data = await hmsRes.json();
  return NextResponse.json(data);
}