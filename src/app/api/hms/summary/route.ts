import { ScopedSingleflightCache } from "@/lib/cache-singleflight";
import { SUMMARY_CACHE_TTL_MS } from "@/lib/constants";
import { auth } from "@/lib/auth";
import { resolveActiveHub, resolveHmsToken, resolvePublicHmsToken } from "@/lib/hms-context";
import { buildHmsHeaders } from '@/lib/hms-headers';
import {
  metricPercent,
  resolveMetricLock,
  setMetricLockCookie,
} from "@/lib/metric-lock";
import { opcCurrDate, opcCycleList, opcDayRangeUnix, wibDate, wibUnixAt, wibHour } from "@/lib/operating-day";
import { getSpvAfifHubByHmsHubId, isSpvAfifPublicHubId } from "@/lib/spv-afif-hubs";
import { refreshStoredHmsToken, type RefreshedHmsToken } from "@/lib/hms-token-refresh";
import { prisma } from "@/lib/prisma";
import { readTokenChunkCount, writeTokenCookies } from "@/lib/hms-token-store";
import { NextRequest, NextResponse } from "next/server";

const API_ID_MAIN = "7564027893345453074";
const API_ID_AGING = "7588046468401988616";
const API_ID_CYCLE1 = "7657180282079970311";
const API_ID_OPS = "7517597334683780103";
const API_ID_COURIER = "7514949742451868679";
const API_ID_DEDICATED = "7591486857905554439";

const PAYMENT_TYPES = '["cashless","cod"]';
const PAYMENT_TYPES_COD = '["cod"]';
const PAYMENT_TYPES_URGENT = '["cashless","cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';
const JOB_ROLES_CYCLE =
  '["Rider LM 2W - Mitra Prioritas","Ops LM - Mitra","Ops LM - Mitra Oncall","Rider LM 2W","Dedicated Rider LM 2W","Ops LM"]';
const JOB_ROLES_DEDICATED = '["Dedicated Rider LM 2W"]';
const DEDICATED_TARGET = 135;

const globalCache = new ScopedSingleflightCache(64);

// Last good value per hub for the slices that can lose a parallel race.
type SliceSnapshot = {
  urgent: { total: number; delivered: number; ftd: number; ongoing: number; pct: number };
  cod: { total: number; ftd: number; readyToReturn: number; delivered: number; fd: number };
  aging: { total48: number; zero48: number; one48: number; more48: number; total72: number };
  c1: {
    c1: number;
    deliveredBefore12: number;
    delivered: number;
    ongoing: number;
    ftd: number;
    others: number;
    pending: number;
    scanned: number;
  };
};
const lastGood = new Map<string, Partial<SliceSnapshot>>();

function rememberSlice<K extends keyof SliceSnapshot>(
  hubId: string,
  key: K,
  value: SliceSnapshot[K]
): SliceSnapshot[K] {
  const entry = lastGood.get(hubId) || {};
  entry[key] = value;
  lastGood.set(hubId, entry);
  return value;
}

function recallSlice<K extends keyof SliceSnapshot>(
  hubId: string,
  key: K
): SliceSnapshot[K] | undefined {
  return lastGood.get(hubId)?.[key];
}

function toWIB(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function formatDateYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// HMS OPC anchors the operational day at 17:00 of the previous WIB day; the
// reasoning lives in lib/operating-day.ts. Every other timestamp path (record
// ranges, metric locks, displayed clock) uses 00:00-23:59:59 WIB.
function getMainCurrDate(): string {
  return opcCurrDate();
}

function getTodayDate(): string {
  return wibDate();
}

function getCycleList(): string {
  return opcCycleList();
}

function getTodayWIBUnix(hour: number): number {
  return wibUnixAt(hour);
}

function get12amWIBUnix(): number {
  return wibUnixAt(0);
}

function get8amWIBUnix(): number {
  return wibUnixAt(8);
}

// The resolved HMS token can be stale (cookie pushed hours ago, expired grant).
// Every call goes through this holder so the first 401 refreshes the token once
// and the remaining slices of the same request reuse the fresh one.
interface HmsTokenHolder {
  token: string;
  userId: string;
  hubId: string;
  refreshed: boolean;
  triedHubToken: boolean;
  refreshResult: RefreshedHmsToken | null;
}

// The hub row is the second token source in the system (the browser extension
// pushes one token per hub). It keeps serving the dashboard when the per-user
// grant can no longer be refreshed.
async function readHubToken(hmsHubId: string): Promise<string | null> {
  try {
    const hub = await prisma.hub.findUnique({
      where: { hmsHubId },
      select: { hmsToken: true },
    });
    return hub?.hmsToken ?? null;
  } catch {
    return null;
  }
}

async function callHMS(
  holder: HmsTokenHolder,
  apiId: string,
  params: Record<string, any>
) {
  const url = `${process.env.HMS_BASE_URL}/dc/v1/oneservice`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHmsHeaders(holder.token),
    },
    body: JSON.stringify({ api_id: apiId, params }),
    cache: "no-store",
  });
  if (res.status === 401) {
    if (!holder.refreshed) {
      holder.refreshed = true;
      const refreshed = await refreshStoredHmsToken(holder.userId, holder.token);
      if (refreshed) {
        holder.token = refreshed.token;
        holder.refreshResult = refreshed;
        console.warn("[summary] HMS token refreshed after 401");
        return callHMS(holder, apiId, params);
      }
    }
    if (!holder.triedHubToken) {
      holder.triedHubToken = true;
      const hubToken = await readHubToken(holder.hubId);
      if (hubToken && hubToken !== holder.token) {
        holder.token = hubToken;
        console.warn("[summary] falling back to hub token after 401");
        return callHMS(holder, apiId, params);
      }
    }
    throw new Error(
      "HMS HTTP 401: token expired and automatic refresh failed. Re-sync the HMS token."
    );
  }
  if (!res.ok) throw new Error(`HMS HTTP ${res.status}${res.status === 401 ? ": token expired" : ""}`);
  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(
      `HMS code ${json.code}: ${
        json.data?.base_resp?.message || json.msg || "unknown"
      }`
    );
  }
  return json;
}

// Secondary slices (urgent, COD, aging) must not flicker to zero when one
// parallel call loses a race against the HMS rate limiter. HMS signals that
// case with an HTTP 200 plus an empty row array, so an empty payload counts as
// a failure and gets retried; the caller keeps the last good value when every
// attempt stays empty.
async function callHMSRetry(
  holder: HmsTokenHolder,
  apiId: string,
  params: Record<string, any>,
  attempts = 3
) {
  let lastError: any = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await callHMS(holder, apiId, params);
      const rows = JSON.parse(res?.data?.data ?? "[]");
      if (Array.isArray(rows) && rows.length > 0) return res;
      lastError = new Error("empty slice");
    } catch (e: any) {
      lastError = e;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}

function parseCompact(dataStr: string, fields: { name: string }[]) {
  const rows = JSON.parse(dataStr);
  if (rows.length === 0) return null;
  const obj: Record<string, any> = {};
  const row = rows[0];
  fields.forEach((f, i) => {
    obj[f.name] = row[i];
  });
  return obj;
}

function toUnixSeconds(value: unknown): number {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000
        ? Math.floor(numeric / 1000)
        : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }
  return 0;
}

async function fetchInboundTasksPage(
  token: string,
  page: number,
  fromTs: number,
  toTs: number
) {
  const res = await fetch(
    `${process.env.HMS_BASE_URL}/api/hms/v1/ui/task/search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://gtl-id.tokgistic.com",
        Referer: "https://gtl-id.tokgistic.com/hms/order-management",
      },
      body: JSON.stringify({
        filters: { received_at_from: fromTs, received_at_to: toTs },
        page,
        size: 100,
      }),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`HMS task page ${page}: ${res.status}`);
  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(`HMS task error: ${json.message || json.code}`);
  }
  return json;
}

async function fetchShipmentsPage(
  token: string,
  page: number,
  awbNumbers: string[]
) {
  const url = new URL(
    `${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`
  );
  url.searchParams.set("type", "order_management");
  url.searchParams.set("leg_type", "last_mile");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("tab", "order_view");
  url.searchParams.set("page", String(page));
  url.searchParams.set("awb_numbers", awbNumbers.join(","));

  const res = await fetch(url.toString(), {
    headers: {
      ...buildHmsHeaders(token),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`TMS shipments page ${page}: ${res.status}`);
  return res.json();
}

async function fetchShipmentsForAwbs(token: string, awbs: string[]) {
  const chunks = Array.from(
    { length: Math.ceil(awbs.length / 50) },
    (_, i) => awbs.slice(i * 50, i * 50 + 50)
  );
  const shipments: any[] = [];
  for (let i = 0; i < chunks.length; i += 5) {
    const results = await Promise.all(
      chunks
        .slice(i, i + 5)
        .map((chunk) => fetchShipmentsPage(token, 1, chunk))
    );
    for (const result of results) {
      shipments.push(...(result?.data?.shipments || []));
    }
  }
  return shipments;
}


// Normalize hub name for matching (strip GTL/Hub tokens, remove non-alphanumeric)
function normalizeHubName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\bgtl\b/g, "")
    .replace(/\bhub\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

type CohortCounts = {
  total: number;
  deliveredBefore12: number;
  delivered: number;
  ongoing: number;
  ftd: number;
  others: number;
  pending: number;
  scanned: number;
};

function normalizeShipmentStatus(status: unknown): string {
  return String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function classifyCohortShipment(shipment: any): "delivered" | "delivering" | "failed" | "other" | "pending" {
  const status = normalizeShipmentStatus(shipment?.status);
  const details = shipment?.destination_details || {};

  if (details.delivery_time || status === "delivered" || status === "pod_confirmed" || status === "success_delivery") {
    return "delivered";
  }
  if (details.out_for_delivery_time || status === "ofd" || status === "out_for_delivery" || status === "ongoing_delivery" || status === "on_delivery" || status === "delivering" || status === "in_driver") {
    return "delivering";
  }
  if (status === "ftd" || status === "failed_to_deliver" || status === "failed_delivery") {
    return "failed";
  }
  if (status === "ready_to_return" || status === "rtr" || status === "cancelled" || status === "canceled" || status === "wbc" || status === "return_to_hub" || status === "returned_to_hub") {
    return "other";
  }
  if (status === "arrived_at_hub" || status === "arrive_at_hub" || status === "inbound_to_sorting" || status === "inbounded_to_sorting" || status === "vehicle_arrival" || status === "still_in_hub" || status === "at_hub" || status === "pending_at_hub" || status === "bagged" || status === "driver_allocated" || status === "assigned_to_driver" || status === "waiting_confirmation" || status === "received") {
    return "pending";
  }
  if (Number(shipment?.delivery_attempts) > 0) {
    return "failed";
  }
  return "pending";
}

function shipmentPriority(shipment: any): number {
  const cls = classifyCohortShipment(shipment);
  const rank = cls === "delivered" ? 5 : cls === "other" ? 4 : cls === "failed" ? 3 : cls === "delivering" ? 2 : 1;
  const updatedAt = toUnixSeconds(
    shipment?.updated_at ||
      shipment?.destination_details?.delivery_time ||
      shipment?.destination_details?.out_for_delivery_time
  );
  return rank * 10_000_000_000 + updatedAt;
}

async function fetchInboundAwbMap(
  hmsToken: string,
  hubName: string,
  fromTs: number,
  toTs: number
) {
  const normalizedTarget = normalizeHubName(hubName);
  const inboundByAwb = new Map<string, number>();

  const firstPage = await fetchInboundTasksPage(hmsToken, 1, fromTs, toTs);
  const totalRecords = Number(firstPage?.data?.pagination?.total) || 0;
  const totalPages = Math.ceil(totalRecords / 100);
  let allTasks: any[] = firstPage?.data?.tasks || [];

  if (totalPages > 1) {
    const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    for (let i = 0; i < pages.length; i += 5) {
      const results = await Promise.all(
        pages
          .slice(i, i + 5)
          .map((page) => fetchInboundTasksPage(hmsToken, page, fromTs, toTs).catch(() => null))
      );
      for (const result of results) {
        if (result) allTasks = allTasks.concat(result?.data?.tasks || []);
      }
    }
  }

  for (const task of allTasks) {
    if (normalizeHubName(task.lm_facility || "") !== normalizedTarget) continue;
    if (task.delivery_type && task.delivery_type !== "Forward") continue;

    const awb = String(task.awb_number || task.tracking_number || "").trim();
    const receivedAt = toUnixSeconds(task.received_at);
    if (!awb || !receivedAt) continue;

    const existing = inboundByAwb.get(awb);
    if (!existing || receivedAt < existing) inboundByAwb.set(awb, receivedAt);
  }

  return inboundByAwb;
}

async function computeMorningCutoffMetrics(hmsToken: string, hubName: string) {
  const todayStartTs = get12amWIBUnix();
  const cutoff8Ts = get8amWIBUnix();
  const cutoff12Ts = getTodayWIBUnix(12);
  const operationalFromTs = opcDayRangeUnix().from;
  const inboundByAwb = await fetchInboundAwbMap(hmsToken, hubName, operationalFromTs, cutoff8Ts);
  const awbs = Array.from(inboundByAwb.keys());

  const empty: CohortCounts = {
    total: 0,
    deliveredBefore12: 0,
    delivered: 0,
    ongoing: 0,
    ftd: 0,
    others: 0,
    pending: 0,
    scanned: 0,
  };

  if (awbs.length === 0) {
    return { operational: empty, freshC1: empty };
  }

  const shipments = await fetchShipmentsForAwbs(hmsToken, awbs);
  const byAwb = new Map<string, any>();
  for (const shipment of shipments) {
    const awb = String(shipment.awb_number || "").trim();
    if (!awb || !inboundByAwb.has(awb)) continue;
    const prev = byAwb.get(awb);
    if (!prev || shipmentPriority(shipment) >= shipmentPriority(prev)) {
      byAwb.set(awb, shipment);
    }
  }

  const operational: CohortCounts = { ...empty, total: awbs.length, scanned: byAwb.size };
  const freshC1: CohortCounts = { ...empty };

  for (const awb of awbs) {
    const inboundAt = inboundByAwb.get(awb) || 0;
    const isFreshC1 = inboundAt >= todayStartTs;
    if (isFreshC1) freshC1.total += 1;

    const shipment = byAwb.get(awb);
    const cls = shipment ? classifyCohortShipment(shipment) : "pending";

    if (cls === "delivered") operational.delivered += 1;
    else if (cls === "delivering") operational.ongoing += 1;
    else if (cls === "failed") operational.ftd += 1;
    else if (cls === "other") operational.others += 1;

    if (isFreshC1) {
      if (cls === "delivered") freshC1.delivered += 1;
      else if (cls === "delivering") freshC1.ongoing += 1;
      else if (cls === "failed") freshC1.ftd += 1;
      else if (cls === "other") freshC1.others += 1;

      const deliveredAt = toUnixSeconds(shipment?.destination_details?.delivery_time);
      if (deliveredAt >= todayStartTs && deliveredAt < cutoff12Ts) {
        freshC1.deliveredBefore12 += 1;
      }
    }
  }

  operational.pending = Math.max(operational.total - operational.delivered - operational.ongoing - operational.ftd - operational.others, 0);
  freshC1.pending = Math.max(freshC1.total - freshC1.delivered - freshC1.ongoing - freshC1.ftd - freshC1.others, 0);

  return { operational, freshC1 };
}

async function fetchDedicatedMerged(holder: HmsTokenHolder, hubId: string) {
  const result = {
    actual: 0, totalPicked: 0, totalDelivered: 0,
    avgPickup: 0, avgDelivered: 0, achievementPct: 0, drivers: [] as string[],
  };

  const cycles = [
    { level: "1", startHour: 0, startMin: 0, endHour: 8, endMin: 0 },
    { level: "2", startHour: 8, startMin: 1, endHour: 14, endMin: 0 },
    { level: "3", startHour: 14, startMin: 1, endHour: 20, endMin: 0 },
  ];

  const driverMap = new Map<string, { picked: number; delivered: number }>();

  for (const cyc of cycles) {
    try {
      const now = toWIB();
      const startUnix = Math.floor(
        (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), cyc.startHour, cyc.startMin, 0) - 7 * 60 * 60 * 1000) / 1000
      );
      const endUnix = Math.floor(
        (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), cyc.endHour, cyc.endMin, 0) - 7 * 60 * 60 * 1000) / 1000
      );

      const res = await callHMS(holder, API_ID_DEDICATED, {
        hub_id: hubId,
        driver_name: "",
        job_roles: JOB_ROLES_DEDICATED,
        cycle_start_time: String(startUnix),
        cycle_end_time: String(endUnix),
        cycle_level: cyc.level,
      });

      if (!res?.data?.data || !res?.data?.fields) continue;
      const rows = JSON.parse(res.data.data);
      const fields: { name: string }[] = res.data.fields;
      const pickedIdx = fields.findIndex((f: any) => f.name === "total_picked");
      const deliveredIdx = fields.findIndex((f: any) => f.name === "total_delivered");
      const driverIdx = fields.findIndex((f: any) => f.name === "driver_name");

      for (const row of rows) {
        const driverName = driverIdx >= 0 ? String(row[driverIdx] || "").trim() : "";
        if (!driverName) continue;
        const picked = Number(row[pickedIdx]) || 0;
        const delivered = Number(row[deliveredIdx]) || 0;
        const existing = driverMap.get(driverName);
        if (existing) {
          existing.picked += picked;
          existing.delivered += delivered;
        } else {
          driverMap.set(driverName, { picked, delivered });
        }
      }
    } catch (e: any) {
      console.warn(`[dedicated-c${cyc.level}] Gagal:`, e.message);
    }
  }

  let totalPicked = 0;
  let totalDelivered = 0;
  const drivers: string[] = [];
  for (const [driverName, data] of driverMap.entries()) {
    totalPicked += data.picked;
    totalDelivered += data.delivered;
    drivers.push(driverName);
  }

  result.actual = driverMap.size;
  result.totalPicked = totalPicked;
  result.totalDelivered = totalDelivered;
  result.avgPickup = driverMap.size > 0 ? Math.round(totalPicked / driverMap.size) : 0;
  result.avgDelivered = driverMap.size > 0 ? Math.round(totalDelivered / driverMap.size) : 0;
  result.achievementPct =
    driverMap.size > 0
      ? parseFloat(((totalDelivered / (driverMap.size * DEDICATED_TARGET)) * 100).toFixed(2))
      : 0;
  result.drivers = drivers;

  return result;
}

function applyPublicCacheHeaders(response: NextResponse, isPublic: boolean) {
  if (isPublic) {
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
  }
  return response;
}

async function originalGET(req: NextRequest, startTimestamp: string) {
  const session = await auth();
  const requestedHubId = req.nextUrl.searchParams.get("hubId");
  const isPublic = req.nextUrl.searchParams.get("public") === "1";

  const activeHub = session?.user?.id
    ? await resolveActiveHub(session.user.id, requestedHubId, session.user)
    : isPublic && isSpvAfifPublicHubId(requestedHubId)
      ? getSpvAfifHubByHmsHubId(requestedHubId)
      : null;
  if (!activeHub) {
    return NextResponse.json(
      { error: session?.user?.id ? "No hub access" : "Unauthorized" },
      { status: session?.user?.id ? 403 : 401 }
    );
  }

  const HUB_ID = activeHub.hmsHubId;
  const HUB_NAME = activeHub.name;

  const resolvedToken = session?.user?.id
    ? await resolveHmsToken(req, session.user.id, session.user)
    : await resolvePublicHmsToken(req, HUB_ID);
  if (!resolvedToken.token) {
    return NextResponse.json(
      {
        error: "No HMS token",
        message: "Buka HMS dulu.",
        auth_error: true,
      },
      { status: 403 }
    );
  }

  // resolveHmsToken already validated the candidates against HMS (cookie, hub
  // push, database), so the first accepted one is what we use here.
  const tokenHolder: HmsTokenHolder = {
    token: resolvedToken.token,
    userId: session?.user?.id ?? `public:${HUB_ID}`,
    hubId: HUB_ID,
    refreshed: false,
    triedHubToken: false,
    refreshResult: null,
  };

  console.log(`[summary] Cache MISS - fetch HMS for ${HUB_NAME} (${HUB_ID})`);

  try {
    const currDate = getMainCurrDate();
    const todayDate = getTodayDate();
    const cycleList = getCycleList();

    // No per-package C1 inbound scan any more: HMS OPC already prints the
    // fresh/backlog split, and the 08:00 lock freezes the fresh C1 cohort.
    const [mainRes, codRes, cycleRes, opsRes, courierRes, urgentRes, dedicatedMerged, agingRes] =
      await Promise.all([
        callHMS(tokenHolder, API_ID_MAIN, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date: currDate,
          payment_types: PAYMENT_TYPES,
          service_types: SERVICE_TYPES,
        }),
        callHMSRetry(tokenHolder, API_ID_MAIN, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date: currDate,
          payment_types: PAYMENT_TYPES_COD,
          service_types: SERVICE_TYPES,
        }).catch((e) => {
          console.warn("[cod] Gagal:", e.message);
          return null;
        }),
        callHMS(tokenHolder, API_ID_CYCLE1, {
          hub_id: HUB_ID,
          driver_name: "",
          job_roles: JOB_ROLES_CYCLE,
          cycle_list: cycleList,
        }).catch((e) => {
          console.warn("[cycle1] Gagal:", e.message);
          return null;
        }),
        callHMS(tokenHolder, API_ID_OPS, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date_start: currDate,
          date: todayDate,
        }).catch((e) => {
          console.warn("[ops] Gagal:", e.message);
          return null;
        }),
        callHMS(tokenHolder, API_ID_COURIER, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date_start: currDate,
          date: todayDate,
          job_roles: JOB_ROLES_CYCLE,
        }).catch((e) => {
          console.warn("[courier] Gagal:", e.message);
          return null;
        }),
        callHMSRetry(tokenHolder, API_ID_MAIN, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date: currDate,
          payment_types: PAYMENT_TYPES_URGENT,
          service_types: SERVICE_TYPES,
          is_urgent: "true",
        }).catch((e) => {
          console.warn("[urgent] Gagal:", e.message);
          return null;
        }),
        fetchDedicatedMerged(tokenHolder, HUB_ID).catch((e) => {
          console.warn("[dedicated] Gagal:", e.message);
          return {
            actual: 0, totalPicked: 0, totalDelivered: 0,
            avgPickup: 0, avgDelivered: 0, achievementPct: 0, drivers: [],
          };
        }),

        callHMSRetry(tokenHolder, API_ID_AGING, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date: currDate,
          payment_types: PAYMENT_TYPES,
          service_types: SERVICE_TYPES,
        }).catch((e) => {
          console.warn("[aging] Gagal:", e.message);
          return null;
        }),
      ]);

    if (!mainRes) {
      return NextResponse.json({ error: "HMS MAIN failed" }, { status: 502 });
    }

    const main = parseCompact(mainRes.data.data, mainRes.data.fields)!;
    const cycle = cycleRes ? parseCompact(cycleRes.data.data, cycleRes.data.fields) : null;
    const ops = opsRes ? parseCompact(opsRes.data.data, opsRes.data.fields) : null;
    const courier = courierRes ? parseCompact(courierRes.data.data, courierRes.data.fields) : null;

    // COD FD % = Ready to Return (RTR) / Today's Volume, both on the COD slice.
    // RTR is the numerator: FTD must never be used here.
    let codReadyToReturn = 0, codJustArrived = 0, codBacklog = 0, codTotalVolume = 0, codFd = 0;
    let codFtd = 0, codDelivered = 0;

    if (codRes) {
      const codMain = parseCompact(codRes.data.data, codRes.data.fields);
      if (codMain) {
        codReadyToReturn = Number(codMain.ready_to_return) || 0;
        codJustArrived = Number(codMain.just_arrived) || 0;
        codBacklog = Number(codMain.backlog) || 0;
        codFtd = Number(codMain.ftd) || 0;
        codDelivered = Number(codMain.delivered) || 0;
        codTotalVolume =
          Number(codMain.today_volume) || codJustArrived + codBacklog;
        codFd = codTotalVolume > 0
          ? parseFloat(((codReadyToReturn / codTotalVolume) * 100).toFixed(2))
          : 0;
        rememberSlice(HUB_ID, "cod", {
          total: codTotalVolume,
          ftd: codFtd,
          readyToReturn: codReadyToReturn,
          delivered: codDelivered,
          fd: codFd,
        });
      }
    }

    if (codTotalVolume === 0) {
      const cached = recallSlice(HUB_ID, "cod");
      if (cached) {
        codTotalVolume = cached.total;
        codFtd = cached.ftd;
        codReadyToReturn = cached.readyToReturn;
        codDelivered = cached.delivered;
        codFd = cached.fd;
      }
    }

    // Urgent slice: is_urgent = "true" is exactly what the Last Mile OPC page
    // sends when its Urgent filter is set to Yes.
    let urgentTotal = 0, urgentDelivered = 0, urgentPct = 0, urgentFtd = 0, urgentOngoing = 0;
    if (urgentRes) {
      const urg = parseCompact(urgentRes.data.data, urgentRes.data.fields);
      if (urg) {
        const urgentJustArrived = Number(urg.just_arrived) || 0;
        const urgentBacklog = Number(urg.backlog) || 0;
        urgentTotal =
          Number(urg.today_volume) || urgentJustArrived + urgentBacklog;
        urgentDelivered = Number(urg.delivered) || 0;
        urgentFtd = Number(urg.ftd) || 0;
        urgentOngoing = Number(urg.ongoing_delivery) || 0;
        urgentPct = urgentTotal > 0 ? parseFloat(((urgentDelivered / urgentTotal) * 100).toFixed(2)) : 0;
        rememberSlice(HUB_ID, "urgent", {
          total: urgentTotal,
          delivered: urgentDelivered,
          ftd: urgentFtd,
          ongoing: urgentOngoing,
          pct: urgentPct,
        });
      }
    }

    if (urgentTotal === 0) {
      const cached = recallSlice(HUB_ID, "urgent");
      if (cached) {
        urgentTotal = cached.total;
        urgentDelivered = cached.delivered;
        urgentFtd = cached.ftd;
        urgentOngoing = cached.ongoing;
        urgentPct = cached.pct;
      }
    }

    // ── HMS OPC field map ─────────────────────────────────────────────────
    // A single OPC row carries every number the Performance page prints,
    // including the sub-totals under each card, so every metric below reads the
    // total and its printed breakdown from that row instead of recomputing.
    const toCount = (value: unknown) => Number(value) || 0;

    const totalVolume = toCount(main.today_volume);
    const justArrived = toCount(main.just_arrived);
    const backlog = toCount(main.backlog);

    const pendingHub = {
      total: toCount(main.pending_at_hub),
      arrived_at_hub: toCount(main.arrived_at_hub),
      driver_allocated: toCount(main.driver_allocated),
      bagged: toCount(main.bagged),
      still_in_hub: toCount(main.still_in_hub),
      waiting_confirmation: toCount(main.waiting_confirmation),
    };
    const ongoingDelivery = {
      total: toCount(main.ongoing_delivery),
      fresh: toCount(main.ongoing_delivery_just_arrived),
      backlog: toCount(main.ongoing_delivery_backlog),
    };
    const deliveredSplit = {
      total: toCount(main.delivered),
      fresh: toCount(main.delivered_just_arrived),
      backlog: toCount(main.delivered_backlog),
    };
    const ftdSplit = {
      total: toCount(main.ftd),
      in_driver: toCount(main.in_driver),
      return_to_hub: toCount(main.ftd_return_to_hub),
    };
    const othersSplit = {
      total: toCount(main.others),
      wbc: toCount(main.wbc),
      cancelled: toCount(main.cancelled),
      ready_to_return: toCount(main.ready_to_return),
    };
    // Clean Floor numerator: everything that already left "Pending at Hub".
    const processedLive =
      ongoingDelivery.total + deliveredSplit.total + ftdSplit.total + othersSplit.total;

    // 08:00 WIB lock. Today's Volume, Just Arrived and the whole Clean Floor
    // numerator are frozen together, so the percentage shown at 09:00 is still
    // the percentage shown at 17:00.
    const volumeLockResult = await resolveMetricLock({
      req,
      facility: HUB_ID,
      kind: "clean_floor_08",
      live: {
        today_volume: totalVolume,
        just_arrived: justArrived,
        backlog,
        ongoing: ongoingDelivery.total,
        delivered: deliveredSplit.total,
        ftd: ftdSplit.total,
        others: othersSplit.total,
        pending_at_hub: pendingHub.total,
        clean_floor_numerator: processedLive,
        clean_floor_denominator: totalVolume,
      },
      metric: (values) =>
        Math.min(
          metricPercent(
            values.clean_floor_numerator,
            values.clean_floor_denominator
          ),
          100
        ),
    });

    // 12:00 WIB lock: Delivered > Just Arrived = the SD<12PM numerator. This is
    // a different OPC field from today_volume.just_arrived, which is the
    // denominator frozen at 08:00 above.
    const deliveryLockResult = await resolveMetricLock({
      req,
      facility: HUB_ID,
      kind: "sd12_numerator_12",
      live: { delivered_fresh: deliveredSplit.fresh },
      metric: (values) => values.delivered_fresh,
    });

    const volumeLock = volumeLockResult.payload;
    const deliveryLock = deliveryLockResult.payload;
    const volumeOverall = totalVolume || justArrived + backlog;
    // Once a cutoff lock exists, keep serving that locked population.
    // A later inbound/shipment scan can be useful for investigation, but it must
    // not redefine C1 / Clean Floor populations or move SD<12 after the lock.
    const fallbackFreshC1 = volumeLock.values.just_arrived;

    const freshC1 = fallbackFreshC1;
    const freshC2 = Math.max(justArrived - freshC1, 0);
    const deliveredBefore12 = freshC1 > 0
      ? Math.min(deliveryLock.values.delivered_fresh, freshC1)
      : 0;
    const sdBefore12 = metricPercent(deliveredBefore12, freshC1);
    const freshSuccess = metricPercent(deliveredSplit.fresh, justArrived);
    const successDelivered = metricPercent(deliveredSplit.total, volumeOverall);

    const cleanFloorNumerator = volumeLock.values.clean_floor_numerator;
    const cleanFloorDenominator = volumeLock.values.clean_floor_denominator || volumeOverall;
    const cleanFloorDelivered = volumeLock.values.delivered;
    const cleanFloorOngoing = volumeLock.values.ongoing;
    const cleanFloorFtd = volumeLock.values.ftd;
    const cleanFloorOthers = volumeLock.values.others;
    const cleanFloorPending = volumeLock.values.pending_at_hub;
    const cleanFloorValue = metricPercent(cleanFloorNumerator, cleanFloorDenominator);

    const cleanFloor = {
      value: Math.min(cleanFloorValue, 100),
      breakdown: {
        ongoing: cleanFloorOngoing,
        delivered: cleanFloorDelivered,
        ftd: cleanFloorFtd,
        others: cleanFloorOthers,
        pending: cleanFloorPending,
        numerator: cleanFloorNumerator,
        today_volume: cleanFloorDenominator,
      },
      is_locked: volumeLock.is_locked,
      locked_at: volumeLock.is_locked ? volumeLock.captured_at : null,
      captured_at: volumeLock.captured_at,
      quality: volumeLock.quality,
      lock_source: volumeLock.source,
      lock_hour_wib: volumeLock.lock_hour_wib,
      live_processed: processedLive,
      post_lock_volume: volumeOverall,
      excluded_processed: Math.max(0, processedLive - cleanFloorNumerator),
    };

    const cleanFloorC1 = {
      value: Math.min(cleanFloorValue, 100),
      numerator: cleanFloorNumerator,
      denominator: cleanFloorDenominator,
      fresh_c1: freshC1,
      backlog: Math.max(cleanFloorDenominator - freshC1, 0),
      today_volume: cleanFloorDenominator,
      delivered: cleanFloorDelivered,
      ongoing: cleanFloorOngoing,
      ftd: cleanFloorFtd,
      others: cleanFloorOthers,
      target_hour_wib: volumeLock.lock_hour_wib,
      is_locked: volumeLock.is_locked,
      captured_at: volumeLock.captured_at,
      quality: volumeLock.quality,
      lock_source: volumeLock.source,
      live_value: metricPercent(processedLive, volumeOverall),
      live_numerator: processedLive,
      live_denominator: volumeOverall,
      source: "opc_main",
    };

    // Pending 48H: first inbound older than 48 hours and still not delivered,
    // counted across all attempts (OPC "Need to Expedite" block).
    let pending48h = { total: 0, attempt_zero: 0, attempt_one: 0, attempt_more: 0, pct: 0 };
    let pending72hTotal = 0;
    if (agingRes) {
      const aging = parseCompact(agingRes.data.data, agingRes.data.fields);
      if (aging) {
        const attemptZero = Number(aging.attempt_zero_48) || 0;
        const attemptOne = Number(aging.attempt_one_48) || 0;
        const attemptMore = Number(aging.attempt_over_one_48) || 0;
        const total = Number(aging.inbound_over_48) || attemptZero + attemptOne + attemptMore;
        pending48h = {
          total,
          attempt_zero: attemptZero,
          attempt_one: attemptOne,
          attempt_more: attemptMore,
          pct:
            volumeOverall > 0
              ? parseFloat(((total / volumeOverall) * 100).toFixed(2))
              : 0,
        };
        pending72hTotal = Number(aging.inbound_over_72) || 0;
        rememberSlice(HUB_ID, "aging", {
          total48: pending48h.total,
          zero48: pending48h.attempt_zero,
          one48: pending48h.attempt_one,
          more48: pending48h.attempt_more,
          total72: pending72hTotal,
        });
      }
    }

    if (pending48h.total === 0) {
      const cached = recallSlice(HUB_ID, "aging");
      if (cached) {
        pending48h = {
          total: cached.total48,
          attempt_zero: cached.zero48,
          attempt_one: cached.one48,
          attempt_more: cached.more48,
          pct:
            volumeOverall > 0
              ? parseFloat(((cached.total48 / volumeOverall) * 100).toFixed(2))
              : 0,
        };
        pending72hTotal = cached.total72;
      }
    }

    const opsProductivity = parseFloat(ops?.avg_productivity) || 0;
    const opsTarget = 1100;
    const opsAchieved = opsProductivity >= opsTarget;

    const ftdInDriver = Number(main.in_driver) || 0;
    const ftdTotal = Number(main.ftd) || 0;
    const pendingAtHub = Number(main.pending_at_hub) || 0;

    const summary = {
      hub_id: main.hub_id,
      hub_name: main.hub_name,
      just_arrived: justArrived,
      backlog,
      today_volume: volumeOverall,
      pending_at_hub: pendingAtHub,
      pending_at_hub_detail: pendingHub,
      clean_floor: cleanFloor,
      clean_floor_c1: cleanFloorC1,
      fresh_c1: freshC1,
      fresh_c2: freshC2,
      fresh_total_computed: freshC1 + freshC2,
      ongoing_delivery: main.ongoing_delivery || 0,
      ongoing_delivery_just_arrived: Number(main.ongoing_delivery_just_arrived) || 0,
      ongoing_delivery_backlog: Number(main.ongoing_delivery_backlog) || 0,
      delivered: main.delivered || 0,
      delivered_percentage: parseFloat(main.delivered_percentage) || 0,
      ftd: ftdInDriver,
      ftd_total: ftdTotal,
      ready_to_return: main.ready_to_return || 0,
      others: main.others || 0,
      cod_ready_to_return: codReadyToReturn,
      cod_just_arrived: codJustArrived,
      cod_backlog: codBacklog,
      cod_total_volume: codTotalVolume,
      cod_ftd: codFtd,
      cod_rtr: codReadyToReturn,
      cod_delivered: codDelivered,
      cod_fd: codFd,
      delivered_just_arrived: deliveredSplit.fresh,
      delivered_backlog: main.delivered_backlog || 0,
      fresh_success: freshSuccess,
      cycle_total_picked: freshC1,
      delivered_before_12: deliveredBefore12,
      sd_before_12: parseFloat(sdBefore12.toFixed(2)),
      sd_before_12_locked: deliveryLock.is_locked,
      sd_before_12_quality: deliveryLock.quality,
      sd_before_12_captured_at: deliveryLock.captured_at,
      courier_assigned: courier?.assigned || 0,
      courier_check_in: courier?.check_in || 0,
      courier_check_in_percent: parseFloat(courier?.check_in_percent) || 0,
      courier_out_drivers: courier?.out_drivers || 0,
      courier_out_percent: parseFloat(courier?.out_percent) || 0,
      courier_avg_productivity: parseFloat(courier?.avg_productivity) || 0,
      dedicated_actual: dedicatedMerged.actual,
      dedicated_total_picked: dedicatedMerged.totalPicked,
      dedicated_total_delivered: dedicatedMerged.totalDelivered,
      dedicated_avg_pickup: dedicatedMerged.avgPickup,
      dedicated_avg_delivered: dedicatedMerged.avgDelivered,
      dedicated_achievement_pct: dedicatedMerged.achievementPct,
      dedicated_target: DEDICATED_TARGET,
      dedicated_drivers: dedicatedMerged.drivers,
      ops_assigned: ops?.assigned || 0,
      ops_check_in: ops?.check_in || 0,
      ops_check_in_percent: parseFloat(ops?.check_in_percent) || 0,
      ops_productivity: opsProductivity,
      ops_target: opsTarget,
      ops_achieved: opsAchieved,
      cycle_name: cycle?.cycle_name || "",
      urgent_total: urgentTotal,
      urgent_delivered: urgentDelivered,
      urgent_ftd: urgentFtd,
      urgent_ongoing: urgentOngoing,
      urgent_pct: urgentPct,
      pending_48h_pct: pending48h.pct,
      pending_48h_total: pending48h.total,
      pending_48h_attempt_zero: pending48h.attempt_zero,
      pending_48h_attempt_one: pending48h.attempt_one,
      pending_48h_attempt_more: pending48h.attempt_more,
      pending_48h_volume: volumeOverall,
      pending_72h_total: pending72hTotal,
      fetched_at: startTimestamp,
    };


    const response = applyPublicCacheHeaders(NextResponse.json({
      success: true,
      meta: {
        cached: false,
        fetched_at: startTimestamp,
        hub_id: HUB_ID,
        hub_name: HUB_NAME,
      },
      summary,
    }), isPublic);
    setMetricLockCookie(response, volumeLockResult.cookie);
    setMetricLockCookie(response, deliveryLockResult.cookie);
    applyRefreshedToken(response, req, tokenHolder);
    return response;
  } catch (e: any) {
    const message = String(e?.message ?? e);
    const isAuth = message.includes("401");
    console.error("[summary] Error:", message);
    return NextResponse.json(
      {
        error: isAuth ? "HMS token expired" : "HMS failed",
        detail: message,
        auth_error: isAuth,
        message: isAuth
          ? "Token HMS expired dan refresh otomatis gagal. Buka HMS di tab lain untuk sync token baru."
          : "HMS tidak merespons dengan benar. Coba lagi sebentar.",
      },
      { status: isAuth ? 401 : 502 }
    );
  }
}

// Hand the refreshed token back to the browser so the cookies used by the
// following requests already carry a valid grant.
function applyRefreshedToken(
  response: NextResponse,
  req: NextRequest,
  holder: HmsTokenHolder
) {
  const refreshed = holder.refreshResult;
  if (!refreshed) return;
  try {
    writeTokenCookies(
      response,
      {
        token: refreshed.token,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        updatedAt: Date.now(),
      },
      readTokenChunkCount(req)
    );
  } catch (e: any) {
    console.warn(`[summary] cookie refresh skipped: ${e?.message ?? e}`);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const hubId = req.nextUrl.searchParams.get("hubId");
    const isPublic = req.nextUrl.searchParams.get("public") === "1";

    const activeHub = session?.user?.id
      ? await resolveActiveHub(session.user.id, hubId, session.user as any)
      : isPublic && isSpvAfifPublicHubId(hubId)
        ? getSpvAfifHubByHmsHubId(hubId)
        : null;
    if (!activeHub) {
      return NextResponse.json(
        { error: session?.user?.id ? "Hub not found" : "Unauthorized" },
        { status: session?.user?.id ? 404 : 401 }
      );
    }

    const HUB_ID = activeHub.hmsHubId;
    const today = wibDate();
    const hour = wibHour();
    const phase = hour < 8 ? "pre08" : (hour < 12 ? "08to12" : "post12");
    const key = JSON.stringify([session?.user?.id ?? `public:${HUB_ID}`, HUB_ID, today, phase]);
    const { data, source, leaderRes } = await globalCache.getOrFetch(
      key,
      SUMMARY_CACHE_TTL_MS,
      async () => {
        const startTimestamp = new Date().toISOString();
        return await originalGET(req, startTimestamp);
      }
    );

    let obj: any;
    try { obj = JSON.parse(data.body); } catch {
      return leaderRes ?? new NextResponse(data.body, { status: data.status, headers: data.headers });
    }
    if (obj?.summary) {
      const dataAge = Math.max(0, Math.floor((Date.now() - new Date(data.fetchedAt).getTime()) / 1000));
      obj.meta = {
        ...obj.meta,
        cached: source === "cache",
        data_age_seconds: dataAge,
        deduplicated: source === "inflight"
      };
    }

    if (leaderRes) {
      return new NextResponse(JSON.stringify(obj), {
        status: leaderRes.status,
        headers: leaderRes.headers,
      });
    }

    return new NextResponse(JSON.stringify(obj), {
      status: data.status,
      headers: new Headers(data.headers),
    });
  } catch (e: any) {
    console.error("[summary] GET Wrapper Error:", e.message);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}




