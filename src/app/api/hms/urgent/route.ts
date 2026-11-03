import { auth } from "@/lib/auth";
import { resolveActiveHub, resolveHmsToken } from "@/lib/hms-context";
import { buildHmsHeaders } from "@/lib/hms-headers";
import { NextRequest, NextResponse } from "next/server";

// Urgent Monitoring = OPC "Last Mile" with the Urgent filter set to Yes.
//   * totals come from LM_SUMMARY_METRICS + is_urgent=true (the same slice the
//     Delivered Urgent % card on the manager dashboard reads)
//   * the AWB list comes from the shipments list with is_urgent=true. HMS drops
//     delivered urgent AWBs from that list, so delivered/FTD/ongoing counts are
//     taken from the summary slice and only the still-open AWBs are listed.
const API_ID_MAIN = "7564027893345453074";
const PAYMENT_TYPES = '["cashless","cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';

export const maxDuration = 30;

type CacheEntry = { data: any; timestamp: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 20 * 1000;

function toWIB(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function formatDateYMD(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

// Same business-date handling as the OPC page: the current business day starts
// at 00:00 WIB, which HMS addresses as "<yesterday> 17:00:00" (UTC).
function getMainCurrDate(): string {
  const d = toWIB();
  d.setUTCDate(d.getUTCDate() - 1);
  return `${formatDateYMD(d)} 17:00:00`;
}

async function hmsFetch(url: string, init: RequestInit, label: string) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 350 * attempt));
    }
    const res = await fetch(url, init);
    if (res.ok) return res;
    lastError = new Error(`${label} HTTP ${res.status}`);
    if (res.status !== 429 && res.status !== 400) break;
  }
  throw lastError ?? new Error(`${label} failed`);
}

async function callHMS(token: string, apiId: string, params: Record<string, any>) {
  const res = await hmsFetch(
    `${process.env.HMS_BASE_URL}/dc/v1/oneservice`,
    {
      method: "POST",
      headers: { ...buildHmsHeaders(token) },
      body: JSON.stringify({ api_id: apiId, params }),
      cache: "no-store",
    },
    "HMS oneservice"
  );
  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(
      `HMS code ${json.code}: ${json.data?.base_resp?.message || json.msg || "unknown"}`
    );
  }
  return json;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pickDriverName(s: any): string {
  let drv =
    (s.route && s.route.driver_name) ||
    s.driver_name ||
    s.assigned_drivers ||
    "";
  if (Array.isArray(drv)) drv = drv[0] || "";
  return String(drv).split(",")[0].trim();
}

async function fetchUrgentShipments(
  token: string,
  hubId: string
): Promise<{ packages: any[]; total: number; dropped: number }> {
  const packages: any[] = [];
  let page = 1;
  let total = 0;
  let dropped = 0;

  while (page <= 10) {
    const url = new URL(`${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`);
    url.searchParams.set("type", "order_management");
    url.searchParams.set("leg_type", "last_mile");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("tab", "order_view");
    url.searchParams.set("page", String(page));
    url.searchParams.set("is_urgent", "true");

    const res = await hmsFetch(
      url.toString(),
      { headers: { ...buildHmsHeaders(token) }, cache: "no-store" },
      "HMS shipments"
    );
    const json = await res.json();
    const rows: any[] = json?.data?.shipments || [];
    total = num(json?.data?.total_records) || total;

    for (const s of rows) {
      if (String(s.hub_id) !== String(hubId)) {
        dropped++;
        continue;
      }
      packages.push({
        awb: String(s.awb_number || "-"),
        status: String(s.status || "unknown"),
        driverName: pickDriverName(s) || "-",
        serviceType: String(s.service_type || ""),
        outForDeliveryTime: s.destination_details?.out_for_delivery_time || null,
        deliveredTime: s.delivered_time || s.destination_details?.delivery_time || null,
      });
    }

    if (rows.length < 100 || page * 100 >= total) break;
    page++;
  }

  const statusRank: Record<string, number> = {
    failed_to_deliver: 0,
    out_for_delivery: 1,
    in_driver: 2,
    received: 3,
    arrived_at_hub: 4,
    still_in_hub: 5,
  };
  packages.sort(
    (a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)
  );

  return { packages, total, dropped };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token: hmsToken } = await resolveHmsToken(req, session.user.id, session.user);
  if (!hmsToken) {
    return NextResponse.json(
      { error: "No HMS token", message: "Buka HMS dulu." },
      { status: 403 }
    );
  }

  const requestedHubId = req.nextUrl.searchParams.get("hubId");
  const activeHub = await resolveActiveHub(session.user.id, requestedHubId, session.user);
  if (!activeHub) {
    return NextResponse.json({ error: "No hub access" }, { status: 403 });
  }

  const HUB_ID = activeHub.hmsHubId;
  const cached = cache.get(HUB_ID);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ success: true, meta: { cached: true }, ...cached.data });
  }

  let listError: string | null = null;
  const [summaryRes, listRes] = await Promise.all([
    callHMS(hmsToken, API_ID_MAIN, {
      hub_ids: JSON.stringify([HUB_ID]),
      curr_date: getMainCurrDate(),
      payment_types: PAYMENT_TYPES,
      service_types: SERVICE_TYPES,
      is_urgent: "true",
    }).catch((e) => {
      listError = listError || e.message;
      return null;
    }),
    fetchUrgentShipments(hmsToken, HUB_ID).catch((e) => {
      listError = listError || e.message;
      return { packages: [], total: 0, dropped: 0 };
    }),
  ]);

  if (!summaryRes) {
    return NextResponse.json(
      { error: "HMS urgent slice failed", detail: listError },
      { status: 502 }
    );
  }

  const rows: any[] = JSON.parse(summaryRes.data?.data || "[]");
  const fields: { name: string }[] = summaryRes.data?.fields || [];
  const summary: Record<string, any> = {};
  fields.forEach((f, i) => {
    summary[f.name] = rows[0]?.[i];
  });

  const justArrived = num(summary.just_arrived);
  const backlog = num(summary.backlog);
  const total = num(summary.today_volume) || justArrived + backlog;
  const delivered = num(summary.delivered);
  const ftd = num(summary.ftd);
  const ongoing = num(summary.ongoing_delivery);

  const payload = {
    hub: { id: HUB_ID, name: activeHub.name },
    meta: {
      cached: false,
      fetched_at: new Date().toISOString(),
      list_error: listError,
      list_total: listRes.total,
      list_dropped_other_hub: listRes.dropped,
    },
    metrics: {
      total,
      delivered,
      not_delivered: Math.max(total - delivered, 0),
      ongoing,
      ftd,
      success_pct:
        total > 0 ? parseFloat(((delivered / total) * 100).toFixed(1)) : 0,
      open_awbs: listRes.packages.length,
    },
    packages: listRes.packages,
  };

  cache.set(HUB_ID, { data: payload, timestamp: Date.now() });
  return NextResponse.json({ success: true, ...payload });
}
