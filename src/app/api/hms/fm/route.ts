import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const JATINEGARA_HUB = "GTL Jatinegara Hub";

function dayWindowsWIB(days: number) {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const todayStartWIB = Date.UTC(
    nowWIB.getUTCFullYear(),
    nowWIB.getUTCMonth(),
    nowWIB.getUTCDate(),
    0,
    0,
    0
  ) - wibOffsetMs;

  const out: { date: string; from: number; to: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const startMs = todayStartWIB - i * 86400000;
    const endMs = i === 0 ? now.getTime() : startMs + 86399999;
    const d = new Date(startMs + wibOffsetMs);
    out.push({
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
      from: Math.floor(startMs / 1000),
      to: Math.floor(endMs / 1000),
    });
  }
  return out;
}

async function fetchPage(token: string, page: number, fromTs: number, toTs: number) {
  const url = new URL(`${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`);
  url.searchParams.set("type", "order_management");
  url.searchParams.set("leg_type", "last_mile");
  url.searchParams.set("status", "received");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("tab", "order_view");
  url.searchParams.set("created_at_from", String(fromTs));
  url.searchParams.set("created_at_to", String(toTs));
  url.searchParams.set("page", String(page));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
      Origin: "https://gtl-id.tokgistic.com",
      Referer: "https://gtl-id.tokgistic.com/hms/order-management",
    },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`HMS FM page ${page} failed: ${res.status}`);
  return res.json();
}

async function fetchWindow(token: string, fromTs: number, toTs: number) {
  const first = await fetchPage(token, 1, fromTs, toTs);
  const totalRecords = first?.data?.total_records || 0;
  const totalPages = Math.min(Math.ceil(totalRecords / 100), 30);

  let all = first?.data?.shipments || [];
  if (totalPages > 1) {
    const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const batchSize = 5;
    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((p) => fetchPage(token, p, fromTs, toTs).catch(() => null))
      );
      for (const r of results) {
        if (r?.data?.shipments) all = all.concat(r.data.shipments);
      }
    }
  }

  const seen = new Set<string>();
  const unique: any[] = [];
  for (const s of all) {
    const key = s.awb_number || s.id;
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }
  return unique;
}

function districtOf(s: any): string {
  return String(
    s?.district ||
      s?.actual_district ||
      s?.destination_details?.district ||
      s?.destination_details?.subdistrict ||
      s?.receiver?.district ||
      ""
  ).toLowerCase();
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hmsToken: true },
  });

  const hmsToken = user?.hmsToken || process.env.HMS_TOKEN || null;
  if (!hmsToken) {
    return NextResponse.json(
      { error: "No HMS token", message: "Buka HMS di tab lain untuk sync token." },
      { status: 403 }
    );
  }

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") || 3), 1), 7);
  const districtFilter = (req.nextUrl.searchParams.get("district") || "jatinegara").toLowerCase();
  const windows = dayWindowsWIB(days);

  try {
    const results = await Promise.all(
      windows.map(async (w) => {
        try {
          const shipments = await fetchWindow(hmsToken, w.from, w.to);
          const hubMatched = shipments.filter((s) => s.actual_hub === JATINEGARA_HUB);
          const districtMatched = hubMatched.filter((s) => districtOf(s).includes(districtFilter));
          const pool = districtMatched.length > 0 ? districtMatched : hubMatched;
          const hourly = new Array(24).fill(0);
          for (const s of pool) {
            const ts = Number(s.created_at || s.created_time || 0);
            if (!ts) continue;
            const hourWIB = new Date((ts > 1e12 ? ts : ts * 1000) + 7 * 3600 * 1000).getUTCHours();
            hourly[hourWIB] = (hourly[hourWIB] || 0) + 1;
          }
          return {
            date: w.date,
            received: pool.length,
            receivedHubWide: hubMatched.length,
            districtMatched: districtMatched.length,
            hourly,
          };
        } catch (e: any) {
          return { date: w.date, received: 0, receivedHubWide: 0, districtMatched: 0, hourly: new Array(24).fill(0), error: e.message };
        }
      })
    );

    const today = results[results.length - 1];
    const history = results.slice(0, -1).filter((r) => r.received > 0);
    const avgHistory = history.length
      ? Math.round(history.reduce((a, r) => a + r.received, 0) / history.length)
      : null;

    return NextResponse.json({
      success: true,
      filters: {
        legType: "Last Mile",
        status: "Received",
        district: "Jatinegara",
        date: today?.date,
      },
      today,
      history: results.slice(0, -1),
      avgHistory,
      meta: {
        days,
        fetchedAt: new Date().toISOString(),
        windows,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: "HMS FM fetch failed", detail: e.message }, { status: 502 });
  }
}
