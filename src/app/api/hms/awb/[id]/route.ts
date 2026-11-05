import { auth } from "@/lib/auth";
import { resolveHmsToken } from "@/lib/hms-context";
import { refreshStoredHmsToken } from "@/lib/hms-token-refresh";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Live, per-AWB status lookup.
//
// The Cek Aging upload used to show whatever status text happened to be in the
// Excel file. That value goes stale the moment a package keeps moving, so this
// route asks HMS for the CURRENT status of one AWB. HMS splits its packages by
// leg: an AWB only exists under one leg_type, so we query Last Mile first and
// fall back to First Mile (which also tells us LM vs FM).

type CacheEntry = { data: AwbStatusResponse; at: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

// Raw HMS `status` codes -> readable, actual HMS status wording. Unknown codes
// fall back to a title-cased version of the raw value (handled by the caller).
const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  arrived_at_hub: "Arrived at Hub",
  arrive_at_hub: "Arrived at Hub",
  inbound_to_sorting: "Arrived at Hub",
  inbounded_to_sorting: "Arrived at Hub",
  vehicle_arrival: "Arrived at Hub",
  still_in_hub: "Still in Hub",
  at_hub: "Still in Hub",
  pending_at_hub: "Pending at Hub",
  bagged: "Bagged",
  driver_allocated: "Driver Allocated",
  assigned_to_driver: "Driver Allocated",
  in_driver: "With Driver",
  ongoing_delivery: "On Delivery",
  out_for_delivery: "On Delivery",
  on_delivery: "On Delivery",
  delivering: "On Delivery",
  delivered: "Delivered",
  pod_confirmed: "Delivered",
  success_delivery: "Delivered",
  failed_delivery: "Failed to Deliver",
  failed_to_deliver: "Failed to Deliver",
  ftd: "Failed to Deliver",
  return_to_hub: "Returning to Hub",
  returned_to_hub: "Returned to Hub",
  ready_to_return: "Ready to Return",
  rtr: "Ready to Return",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  wbc: "WBC",
};

export interface AwbStatusResponse {
  awb: string;
  found: boolean;
  status: string | null; // raw HMS code
  statusLabel: string | null; // readable actual HMS status
  logType: "LM" | "FM" | null;
  legType: string | null;
  actualHub: string | null;
  serviceType: string | null;
  lastScanAt: number | null; // unix seconds (HMS updated_at)
}

function titleCase(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusLabelFor(raw: string): string {
  const key = String(raw || "").toLowerCase().replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
  return STATUS_LABELS[key] || titleCase(raw);
}

async function fetchByLeg(
  token: string,
  awb: string,
  leg: "last_mile" | "first_mile"
): Promise<{ status: number; shipment: any | null }> {
  const url = new URL(`${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`);
  url.searchParams.set("type", "order_management");
  url.searchParams.set("leg_type", leg);
  url.searchParams.set("tab", "order_view");
  url.searchParams.set("per_page", "10");
  url.searchParams.set("page", "1");
  url.searchParams.set("awb_numbers", awb);

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

  if (res.status === 401) return { status: 401, shipment: null };
  if (!res.ok) return { status: res.status, shipment: null };

  const json = await res.json();
  const rows: any[] = json?.data?.shipments || [];
  const match =
    rows.find((s) => String(s.awb_number || "").toLowerCase() === awb.toLowerCase()) ||
    rows[0] ||
    null;
  return { status: res.status, shipment: match };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const awb = String(id || "").trim();
  if (!awb) {
    return NextResponse.json({ error: "AWB required" }, { status: 400 });
  }

  const { token: hmsToken } = await resolveHmsToken(req, session.user.id, session.user);
  if (!hmsToken) {
    return NextResponse.json(
      { error: "No HMS token", message: "Buka HMS di tab lain untuk sync token." },
      { status: 403 }
    );
  }

  const cached = cache.get(awb.toLowerCase());
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.data, meta: { cached: true } });
  }

  // A 401 on the first call refreshes the token once and both leg lookups are
  // retried with the new token.
  let token = hmsToken;
  const legs: Array<"last_mile" | "first_mile"> = ["last_mile", "first_mile"];
  let lastStatus = 0;
  let shipment: any | null = null;
  let matchedLeg: "last_mile" | "first_mile" | null = null;
  let refreshed = false;

  for (const leg of legs) {
    let r = await fetchByLeg(token, awb, leg);
    if (r.status === 401 && !refreshed) {
      const newToken = await refreshStoredHmsToken(session.user.id, token);
      if (newToken?.token) {
        token = newToken.token;
        refreshed = true;
        r = await fetchByLeg(token, awb, leg);
      }
    }
    lastStatus = r.status;
    if (r.shipment) {
      shipment = r.shipment;
      matchedLeg = leg;
      break;
    }
  }

  if (!shipment) {
    if (lastStatus === 401) {
      return NextResponse.json(
        { error: "HMS token expired", message: "Token HMS expired. Buka HMS lagi untuk refresh." },
        { status: 401 }
      );
    }
    if (lastStatus && lastStatus !== 200 && lastStatus !== 404) {
      return NextResponse.json(
        { error: "HMS API failed", status: lastStatus, awb, found: false },
        { status: 502 }
      );
    }

    // AWB genuinely not found under either leg — still 200 so the table can
    // render an explicit "Not found in HMS" instead of silently using Excel.
    const notFound: AwbStatusResponse = {
      awb,
      found: false,
      status: null,
      statusLabel: null,
      logType: null,
      legType: null,
      actualHub: null,
      serviceType: null,
      lastScanAt: null,
    };
    cache.set(awb.toLowerCase(), { data: notFound, at: Date.now() });
    return NextResponse.json(notFound);
  }

  const legType = String(shipment.leg_type || matchedLeg || "");
  const rawStatus = String(shipment.status || "").trim();
  const lastScanAt = Number(shipment.updated_at) || null;

  const data: AwbStatusResponse = {
    awb: String(shipment.awb_number || awb),
    found: true,
    status: rawStatus || null,
    statusLabel: rawStatus ? statusLabelFor(rawStatus) : null,
    logType: legType === "first_mile" ? "FM" : "LM",
    legType: legType || null,
    actualHub: shipment.actual_hub ? String(shipment.actual_hub) : null,
    serviceType: shipment.service_type ? String(shipment.service_type) : null,
    lastScanAt,
  };

  cache.set(awb.toLowerCase(), { data, at: Date.now() });
  return NextResponse.json(data);
}
