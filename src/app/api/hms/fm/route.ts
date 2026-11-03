import { auth } from "@/lib/auth";
import { resolveHmsToken } from "@/lib/hms-context";
import { DEFAULT_RANGE_DAYS } from "@/lib/wib-range";
import { NextRequest, NextResponse } from "next/server";

const JATINEGARA_HUB = "GTL Jatinegara Hub";
const WEEK_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_CACHE_TTL_MS = 5 * 60 * 1000;
const weekCache = new Map<string, { data: any; timestamp: number }>();

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
    // full WIB day window, so the numbers line up with the HMS filter
    const endMs = startMs + 86399999;
    const d = new Date(startMs + wibOffsetMs);
    out.push({
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
      from: Math.floor(startMs / 1000),
      to: Math.floor(endMs / 1000),
    });
  }
  return out;
}

// Monday..Saturday of the current WIB week. Future days are flagged so the UI
// can render them as empty slots instead of fetching HMS for nothing.
function weekWindowsWIB() {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const dow = nowWIB.getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  const todayStartWIB =
    Date.UTC(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth(), nowWIB.getUTCDate(), 0, 0, 0) -
    wibOffsetMs;
  const mondayStartWIB = todayStartWIB - mondayOffset * 86400000;

  return WEEK_LABELS.map((label, i) => {
    const startMs = mondayStartWIB + i * 86400000;
    const isToday = i === mondayOffset;
    const isFuture = i > mondayOffset;
    const endMs = startMs + 86399999;
    const d = new Date(startMs + wibOffsetMs);
    return {
      label,
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate()
      ).padStart(2, "0")}`,
      from: Math.floor(startMs / 1000),
      to: Math.floor(endMs / 1000),
      isToday,
      isFuture,
    };
  });
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

// HMS answers `total_records` for the exact filter combination the HMS UI uses
// (leg type + status + created_at range). Counting downloaded pages used to cap
// at 30 pages (3.000 rows) and silently truncated busy days, so the headline
// count now comes from `total_records`.
// HMS rate limiter answers empty once too many queries run at the same time, so
// a 30-day window (30 day-buckets x combined with the weekly call) goes through
// a small semaphore instead of one unbounded burst.
const MAX_CONCURRENT_HMS = 6;
let activeHmsCalls = 0;
const hmsWaiting: (() => void)[] = [];

async function withHmsSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeHmsCalls >= MAX_CONCURRENT_HMS) {
    await new Promise<void>((resolve) => hmsWaiting.push(resolve));
  }
  activeHmsCalls += 1;
  try {
    return await fn();
  } finally {
    activeHmsCalls -= 1;
    const next = hmsWaiting.shift();
    if (next) next();
  }
}

async function fetchDay(token: string, fromTs: number, toTs: number, countOnly = false) {
  const first = await withHmsSlot(() => fetchPage(token, 1, fromTs, toTs));
  const firstPage = first?.data?.shipments || [];
  const totalRaw = Number(first?.data?.total_records);
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : firstPage.length;

  if (countOnly || total <= firstPage.length) return { total, shipments: firstPage };

  const totalPages = Math.min(Math.ceil(total / 100), 60);
  let all = firstPage;
  const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const batchSize = 5;
  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((p) => withHmsSlot(() => fetchPage(token, p, fromTs, toTs)).catch(() => null))
    );
    for (const r of results) {
      if (r?.data?.shipments) all = all.concat(r.data.shipments);
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
  return { total, shipments: unique };
}

// The shipments endpoint is scoped to the logged-in hub, so `total_records`
// already equals the hub-wide volume. The district share is measured on the
// downloaded sample and applied to the authoritative total.
function splitCounts(shipments: any[], total: number, districtFilter: string) {
  const hubMatched = shipments.filter((s: any) => s.actual_hub === JATINEGARA_HUB);
  const districtMatched = hubMatched.filter((s: any) => districtOf(s).includes(districtFilter));
  const sample = hubMatched.length || shipments.length;
  const ratio = sample > 0 && districtMatched.length > 0 ? districtMatched.length / sample : 1;
  return {
    received: Math.round(total * ratio),
    receivedHubWide: total,
    districtMatched: districtMatched.length,
  };
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

  const { token: hmsToken } = await resolveHmsToken(req, session.user.id, session.user);
  if (!hmsToken) {
    return NextResponse.json(
      { error: "No HMS token", message: "Buka HMS di tab lain untuk sync token." },
      { status: 403 }
    );
  }

  const days = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("days") || DEFAULT_RANGE_DAYS), 1),
    DEFAULT_RANGE_DAYS
  );
  const districtFilter = (req.nextUrl.searchParams.get("district") || "jatinegara").toLowerCase();
  const countOnly = req.nextUrl.searchParams.get("countOnly") === "1";

  if (req.nextUrl.searchParams.get("range") === "week") {
    const cacheKey = `week:${districtFilter}`;
    const cached = weekCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < WEEK_CACHE_TTL_MS) {
      return NextResponse.json({
        ...cached.data,
        meta: { ...cached.data.meta, cached: true },
      });
    }

    const windows = weekWindowsWIB();
    try {
      const week = await Promise.all(
        windows.map(async (w) => {
          if (w.isFuture) {
            return {
              date: w.date,
              label: w.label,
              received: 0,
              receivedHubWide: 0,
              totalRecords: 0,
              isToday: w.isToday,
              isFuture: true,
            };
          }
          try {
            const { total, shipments } = await fetchDay(hmsToken, w.from, w.to, countOnly);
            const counts = splitCounts(shipments, total, districtFilter);
            return {
              date: w.date,
              label: w.label,
              received: counts.received,
              receivedHubWide: counts.receivedHubWide,
              totalRecords: total,
              isToday: w.isToday,
              isFuture: false,
            };
          } catch (e: any) {
            return {
              date: w.date,
              label: w.label,
              received: 0,
              receivedHubWide: 0,
              totalRecords: 0,
              isToday: w.isToday,
              isFuture: false,
              error: e.message,
            };
          }
        })
      );

      const withData = week.filter((d) => !d.isFuture && d.received > 0);
      const ado = withData.length
        ? Math.round(withData.reduce((sum, d) => sum + d.received, 0) / withData.length)
        : 0;

      const payload = {
        success: true,
        range: "week",
        weekStart: week[0]?.date,
        weekEnd: week[week.length - 1]?.date,
        district: "Jatinegara",
        week,
        ado,
        meta: { fetchedAt: new Date().toISOString(), days: week.length, countSource: "hms_total_records" },
      };

      weekCache.set(cacheKey, { data: payload, timestamp: Date.now() });
      return NextResponse.json(payload);
    } catch (e: any) {
      return NextResponse.json(
        { error: "HMS FM week fetch failed", detail: e.message },
        { status: 502 }
      );
    }
  }

  const windows = dayWindowsWIB(days);

  try {
    const results = await Promise.all(
      windows.map(async (w) => {
        try {
          const { total, shipments } = await fetchDay(hmsToken, w.from, w.to, countOnly);
          const counts = splitCounts(shipments, total, districtFilter);
          const hubMatched = shipments.filter((s: any) => s.actual_hub === JATINEGARA_HUB);
          const districtMatched = hubMatched.filter((s: any) => districtOf(s).includes(districtFilter));
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
            received: counts.received,
            receivedHubWide: counts.receivedHubWide,
            districtMatched: counts.districtMatched,
            totalRecords: total,
            hourly,
          };
        } catch (e: any) {
          return {
            date: w.date,
            received: 0,
            receivedHubWide: 0,
            districtMatched: 0,
            totalRecords: 0,
            hourly: new Array(24).fill(0),
            error: e.message,
          };
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
        countSource: "hms_total_records",
        windows,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: "HMS FM fetch failed", detail: e.message }, { status: 502 });
  }
}