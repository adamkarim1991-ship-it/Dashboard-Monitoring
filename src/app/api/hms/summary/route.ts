import { auth } from "@/lib/auth";
import { resolveActiveHub, resolveHmsToken } from "@/lib/hms-context";
import { buildHmsHeaders } from '@/lib/hms-headers';
import { applyCleanFloorCookie, resolveCleanFloor } from "@/lib/clean-floor";
import { refreshStoredHmsToken, type RefreshedHmsToken } from "@/lib/hms-token-refresh";
import { prisma } from "@/lib/prisma";
import { readTokenChunkCount, readTokenFromCookies, writeTokenCookies } from "@/lib/hms-token-store";
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

type CacheEntry = { data: any; timestamp: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 1000;

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

function getMainCurrDate(): string {
  const d = toWIB();
  d.setUTCDate(d.getUTCDate() - 1);
  return `${formatDateYMD(d)} 17:00:00`;
}

function getTodayDate(): string {
  return formatDateYMD(toWIB());
}

function getCycleList(): string {
  const start = toWIB();
  start.setUTCDate(start.getUTCDate() - 1);
  start.setUTCHours(17, 0, 0, 0);
  const end = toWIB();
  end.setUTCHours(17, 0, 0, 0);
  const startMs = start.getTime() - 7 * 60 * 60 * 1000;
  const endMs = end.getTime() - 7 * 60 * 60 * 1000;
  return JSON.stringify([
    `${Math.floor(startMs / 1000)}-${Math.floor(endMs / 1000)}`,
  ]);
}

function getTodayWIBUnix(hour: number): number {
  const d = toWIB();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return Math.floor(
    (Date.UTC(y, m, day, hour, 0, 0) - 7 * 60 * 60 * 1000) / 1000
  );
}

function get12amWIBUnix(): number {
  return getTodayWIBUnix(0);
}

function get8amWIBUnix(): number {
  return getTodayWIBUnix(8);
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
// A token is only usable when HMS actually answers 200 for it; the stored ones
// can be revoked long before their expiry timestamp. Validate before spending
// the whole request budget on a dead token.
async function isTokenUsable(token: string, hmsHubId: string): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.HMS_BASE_URL}/dc/v1/oneservice`, {
      method: "POST",
      headers: buildHmsHeaders(token),
      body: JSON.stringify({
        api_id: API_ID_MAIN,
        params: {
          hub_ids: JSON.stringify([hmsHubId]),
          curr_date: getMainCurrDate(),
          payment_types: PAYMENT_TYPES,
          service_types: SERVICE_TYPES,
        },
      }),
      cache: "no-store",
    });
    if (res.status === 401) return false;
    if (!res.ok) return true;
    const json = await res.json();
    return json?.code === 200;
  } catch {
    return false;
  }
}

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

async function computeC1FromInboundScan(hmsToken: string, hubName: string) {
  const fromTs = get12amWIBUnix();
  const toTs = get8amWIBUnix();
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
          .map((page) => fetchInboundTasksPage(hmsToken, page, fromTs, toTs))
      );
      for (const result of results) {
        allTasks = allTasks.concat(result?.data?.tasks || []);
      }
    }
  }

  
  const normalizedTarget = normalizeHubName(hubName);
  const hubTasks = allTasks.filter(
    (task) => normalizeHubName(task.lm_facility || "") === normalizedTarget
  );
  const uniqueFreshC1Tasks = Array.from(
    new Map(
      hubTasks.map((task, index) => [
        task.awb_number ||
          task.tracking_number ||
          task.id ||
          `row-${index}`,
        task,
      ])
    ).values()
  );
  const deliveredFromTs = getTodayWIBUnix(0);
  const deliveredBeforeTs = getTodayWIBUnix(12);
  const freshC1Awbs = uniqueFreshC1Tasks
    .map((task) =>
      String(task.awb_number || task.tracking_number || "").trim()
    )
    .filter(Boolean);
  const shipments = await fetchShipmentsForAwbs(hmsToken, freshC1Awbs);
  const deliveredBefore12 = new Set(
    shipments
      .filter((shipment) => {
        const deliveredAt = toUnixSeconds(
          shipment.destination_details?.delivery_time
        );
        return (
          deliveredAt >= deliveredFromTs && deliveredAt < deliveredBeforeTs
        );
      })
      .map((shipment) => String(shipment.awb_number || "").trim())
      .filter(Boolean)
  ).size;

  // Per package status for the morning (C1) cohort. The shipments endpoint can
  // return more than one row per AWB, so collapse to one row first.
  const byAwb = new Map<string, any>();
  for (const shipment of shipments) {
    const awb = String(shipment.awb_number || "").trim();
    if (!awb) continue;
    const prev = byAwb.get(awb);
    const prevDelivered = Boolean(prev?.destination_details?.delivery_time);
    const currentDelivered = Boolean(shipment.destination_details?.delivery_time);
    if (!prev || (currentDelivered && !prevDelivered)) byAwb.set(awb, shipment);
  }

  let c1Delivered = 0;
  let c1Ongoing = 0;
  let c1Ftd = 0;
  for (const shipment of byAwb.values()) {
    const details = shipment.destination_details || {};
    if (details.delivery_time) {
      c1Delivered += 1;
    } else if (details.out_for_delivery_time) {
      c1Ongoing += 1;
    } else if (Number(shipment.delivery_attempts) > 0) {
      c1Ftd += 1;
    }
  }

  return {
    c1: uniqueFreshC1Tasks.length,
    deliveredBefore12,
    delivered: c1Delivered,
    ongoing: c1Ongoing,
    ftd: c1Ftd,
    scanned: byAwb.size,
  };
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

export async function GET(req: NextRequest) {
  console.log("=== HIT /api/hms/summary ===");
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedToken = await resolveHmsToken(req, session.user.id, session.user);
  const hmsToken = resolvedToken.token;
  if (!hmsToken) {
    return NextResponse.json(
      {
        error: "No HMS token",
        message: "Buka HMS dulu.",
        auth_error: true,
      },
      { status: 403 }
    );
  }

  const requestedHubId = req.nextUrl.searchParams.get("hubId");
  const activeHub = await resolveActiveHub(session.user.id, requestedHubId, session.user);
  if (!activeHub) {
    return NextResponse.json({ error: "No hub access" }, { status: 403 });
  }

  // Pick the first token HMS accepts: hub push first (the extension refreshes
  // it), then the per-user cookie, then whatever the session resolved.
  const hubToken = await readHubToken(activeHub.hmsHubId);
  const cookieToken = readTokenFromCookies(req)?.token ?? null;
  const candidateTokens = [hubToken, cookieToken, hmsToken].filter(
    (value): value is string => Boolean(value)
  );
  const uniqueTokens = Array.from(new Set(candidateTokens));

  let workingToken: string | null = null;
  let rejectedTokens = 0;
  for (const candidate of uniqueTokens) {
    if (await isTokenUsable(candidate, activeHub.hmsHubId)) {
      workingToken = candidate;
      break;
    }
    rejectedTokens += 1;
  }

  if (!workingToken) {
    return NextResponse.json(
      {
        error: "HMS token expired",
        detail: `All ${uniqueTokens.length} stored HMS tokens were rejected by HMS.`,
        auth_error: true,
        message:
          "Semua token HMS ditolak. Buka HMS di tab lain supaya extension mengirim token baru.",
      },
      { status: 401 }
    );
  }

  if (rejectedTokens > 0) {
    console.warn(
      `[summary] skipped ${rejectedTokens} rejected HMS token(s), using a working one`
    );
  }

  const tokenHolder: HmsTokenHolder = {
    token: workingToken,
    userId: session.user.id,
    hubId: activeHub.hmsHubId,
    refreshed: false,
    triedHubToken: false,
    refreshResult: null,
  };

  const HUB_ID = activeHub.hmsHubId;
  const HUB_NAME = activeHub.name;

  const cacheKey = HUB_ID;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({
      success: true,
      meta: { cached: true, cache_age_seconds: Math.floor((now - cached.timestamp) / 1000) },
      summary: cached.data,
    });
  }

  console.log(`[summary] Cache MISS - fetch HMS for ${HUB_NAME} (${HUB_ID})`);

  try {
    const currDate = getMainCurrDate();
    const todayDate = getTodayDate();
    const cycleList = getCycleList();

    const [mainRes, codRes, cycleRes, opsRes, courierRes, urgentRes, dedicatedMerged, c1Result, agingRes] =
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
        computeC1FromInboundScan(workingToken, HUB_NAME).catch((e) => {
          console.warn("[c1c2] Gagal:", e.message);
          return {
            c1: 0,
            deliveredBefore12: 0,
            delivered: 0,
            ongoing: 0,
            ftd: 0,
            scanned: 0,
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

    const deliveredJustArrived = main.delivered_just_arrived || 0;
    const justArrived = Number(main.just_arrived) || 0;

    // The C1 scan needs ~50 paginated calls, so it is the slice most likely to
    // come back empty. Keep the last good scan instead of reporting 0 C1.
    let c1Scan = c1Result;
    if (!c1Scan || !c1Scan.c1) {
      const cachedC1 = recallSlice(HUB_ID, "c1");
      if (cachedC1) c1Scan = cachedC1;
    } else {
      rememberSlice(HUB_ID, "c1", c1Scan);
    }

    const freshC1 = Math.min(c1Scan.c1, justArrived);
    const freshC2 = Math.max(justArrived - freshC1, 0);
    const deliveredBefore12 = c1Scan.deliveredBefore12;
    const sdBefore12 = freshC1 > 0 ? (deliveredBefore12 / freshC1) * 100 : 0;
    const freshSuccess =
      justArrived > 0
        ? parseFloat(((deliveredJustArrived / justArrived) * 100).toFixed(2))
        : 0;

    const backlog = Number(main.backlog) || 0;
    const volumeOverall = justArrived + backlog;
    const cleanFloorOngoing = Number(main.ongoing_delivery) || 0;
    const cleanFloorDelivered = Number(main.delivered) || 0;
    const cleanFloorFtd = Number(main.ftd) || 0;
    const cleanFloorOthers = Number(main.others) || 0;
    const cleanFloorPendingAtHub = Number(main.pending_at_hub) || 0;
    const cleanFloorTodayVolume = justArrived + backlog;
    const currentWibHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();

    // The denominator is frozen at the 08:00 WIB Volume Overall; only the
    // numerator keeps following live HMS data.
    const cleanFloorResult = await resolveCleanFloor({
      req,
      facility: HUB_ID,
      date: todayDate,
      wibHour: currentWibHour,
      live: {
        ongoing: cleanFloorOngoing,
        delivered: cleanFloorDelivered,
        ftd: cleanFloorFtd,
        others: cleanFloorOthers,
        pending: cleanFloorPendingAtHub,
        todayVolume: cleanFloorTodayVolume,
      },
    });
    const cleanFloor = cleanFloorResult.payload;

    // Clean Floor (Overall C1): morning target metric, not a snapshot. The pool
    // is today's C1 arrivals plus yesterday's FTD carried over as backlog. C2
    // arrivals are excluded, so only the C1 cohort is counted on both sides.
    const c1Pool = freshC1 + backlog;
    const c1FreshProcessed = Math.min(
      c1Scan.delivered + c1Scan.ongoing + c1Scan.ftd,
      freshC1
    );
    const c1BacklogProcessed = Math.min(
      (Number(main.delivered_backlog) || 0) +
        (Number(main.ongoing_delivery_backlog) || 0),
      backlog
    );
    const c1Numerator = Math.min(c1FreshProcessed + c1BacklogProcessed, c1Pool);
    const cleanFloorC1 = {
      value:
        c1Pool > 0
          ? parseFloat(((c1Numerator / c1Pool) * 100).toFixed(2))
          : 0,
      numerator: c1Numerator,
      denominator: c1Pool,
      fresh_c1: freshC1,
      backlog,
      fresh_processed: c1FreshProcessed,
      backlog_processed: c1BacklogProcessed,
      fresh_delivered: c1Scan.delivered,
      fresh_ongoing: c1Scan.ongoing,
      fresh_ftd: c1Scan.ftd,
      c1_scanned: c1Scan.scanned,
      target_hour_wib: 8,
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
      delivered_just_arrived: deliveredJustArrived,
      delivered_backlog: main.delivered_backlog || 0,
      fresh_success: freshSuccess,
      cycle_total_picked: freshC1,
      delivered_before_12: deliveredBefore12,
      sd_before_12: parseFloat(sdBefore12.toFixed(2)),
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
      fetched_at: new Date().toISOString(),
    };

    cache.set(cacheKey, { data: summary, timestamp: Date.now() });

    const response = NextResponse.json({
      success: true,
      meta: {
        cached: false,
        fetched_at: new Date().toISOString(),
        hub_id: HUB_ID,
        hub_name: HUB_NAME,
      },
      summary,
    });
    applyCleanFloorCookie(response, cleanFloorResult.cookie);
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
        debug: {
          hub: tokenHolder.hubId,
          token_len: tokenHolder.token.length,
          refreshed: tokenHolder.refreshed,
          tried_hub: tokenHolder.triedHubToken,
          token_source: resolvedToken.source,
        },
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
