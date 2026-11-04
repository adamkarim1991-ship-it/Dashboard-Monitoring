import { auth } from "@/lib/auth";
import { resolveCleanFloor } from "@/lib/clean-floor";
import { resolveActiveHub, resolveHmsToken } from "@/lib/hms-context";
import { NextRequest, NextResponse } from "next/server";

const REFRESH_WINDOW_MS = 30 * 60 * 1000;

const API_ID_MAIN = "7564027893345453074";
const PAYMENT_TYPES_ALL = '["cashless","cod"]';
const PAYMENT_TYPES_COD = '["cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';

type CacheEntry = { data: any; timestamp: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000;

function getWIBDate(): { date: string; hour: number; minute: number } {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate();
  const h = nowWIB.getUTCHours();
  const min = nowWIB.getUTCMinutes();
  const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { date, hour: h, minute: min };
}

function getMainCurrDate(): string {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate() - 1;
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")} 00:00:00`;
}

function getCycleStartUnix(): number {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate() - 1;
  const startMs = Date.UTC(y, m, d, 0, 0, 0) - wibOffsetMs;
  return Math.floor(startMs / 1000);
}

function getTodayWIBUnix(hour: number): number {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const timestampMs =
    Date.UTC(
      nowWIB.getUTCFullYear(),
      nowWIB.getUTCMonth(),
      nowWIB.getUTCDate(),
      hour
    ) - wibOffsetMs;
  return Math.floor(timestampMs / 1000);
}

function normalizeHubName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\bgtl\b/g, "")
    .replace(/\bhub\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function callHMS(
  token: string,
  apiId: string,
  params: Record<string, any>
) {
  const url = `${process.env.HMS_BASE_URL}/dc/v1/oneservice`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "x-location": "Asia/Jakarta",
      "x-request-source": "web",
      Origin: "https://gtl-id.tokgistic.com",
      Referer: "https://gtl-id.tokgistic.com/tms/operation-performance-central",
    },
    body: JSON.stringify({ api_id: apiId, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HMS ${res.status}`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(`HMS error: ${json.msg}`);
  return json;
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

function toSafeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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

function getShipmentStatus(status: unknown) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "delivered") return "delivered";
  if (normalized === "ofd" || normalized === "out_for_delivery") {
    return "delivering";
  }
  if (normalized === "ftd" || normalized === "failed_to_deliver") {
    return "failed";
  }
  return null;
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
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
      Origin: "https://gtl-id.tokgistic.com",
      Referer: "https://gtl-id.tokgistic.com/hms/order-management",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Page ${page}: ${res.status}`);
  return res.json();
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

async function fetchOperationalInboundByAwb(
  token: string,
  hubName: string,
  fromTs: number,
  toTs: number
) {
  const inboundByAwb = new Map<string, number>();
  const debugFacilities = new Set<string>();
  const debugChunks: Array<{ from: number; to: number; count: number }> = [];
  const normalizedHubName = normalizeHubName(hubName);

  const firstPage = await fetchInboundTasksPage(token, 1, fromTs, toTs);
  const totalRecords = Number(firstPage?.data?.pagination?.total) || 0;
  const totalPages = Math.ceil(totalRecords / 100);
  let allTasks: any[] = firstPage?.data?.tasks || [];

  if (totalPages > 1) {
    const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    for (let i = 0; i < pages.length; i += 5) {
      const results = await Promise.all(
        pages
          .slice(i, i + 5)
          .map((page) =>
            fetchInboundTasksPage(token, page, fromTs, toTs).catch(() => null)
          )
      );
      for (const result of results) {
        if (result) allTasks = allTasks.concat(result?.data?.tasks || []);
      }
    }
  }

  debugChunks.push({ from: fromTs, to: toTs, count: allTasks.length });

  for (const task of allTasks) {
    const taskFacility = String(task.lm_facility || "");
    if (taskFacility) debugFacilities.add(taskFacility);
    if (normalizeHubName(taskFacility) !== normalizedHubName) continue;
    if (task.delivery_type && task.delivery_type !== "Forward") continue;
    const awb = String(task.awb_number || task.tracking_number || "").trim();
    const receivedAt = toUnixSeconds(task.received_at);
    if (!awb || !receivedAt) continue;
    const existing = inboundByAwb.get(awb);
    if (!existing || receivedAt < existing) inboundByAwb.set(awb, receivedAt);
  }

  return { inboundByAwb, debugFacilities, debugChunks };
}

async function fetchShipmentsForAwbs(token: string, awbs: string[]) {
  const chunks = Array.from({ length: Math.ceil(awbs.length / 50) }, (_, i) =>
    awbs.slice(i * 50, i * 50 + 50)
  );
  const shipments: any[] = [];

  for (let i = 0; i < chunks.length; i += 5) {
    const results = await Promise.all(
      chunks.slice(i, i + 5).map(async (chunk) => {
        const firstPage = await fetchShipmentsPage(token, 1, chunk);
        const totalRecords = Number(firstPage?.data?.total_records) || 0;
        const totalPages = Math.ceil(totalRecords / 100);
        let chunkShipments = firstPage?.data?.shipments || [];

        if (totalPages > 1) {
          const pages = await Promise.all(
            Array.from({ length: totalPages - 1 }, (_, pageIndex) =>
              fetchShipmentsPage(token, pageIndex + 2, chunk)
            )
          );
          for (const page of pages) {
            chunkShipments = chunkShipments.concat(page?.data?.shipments || []);
          }
        }
        return chunkShipments;
      })
    );
    for (const result of results) shipments.push(...result);
  }

  return shipments;
}

// Clean Floor is resolved by the shared morning-lock helper so this route and
// /api/hms/summary always report the same frozen 08:00 denominator.
async function getCleanFloor(
  req: NextRequest,
  mainAll: any,
  wib: { date: string; hour: number; minute: number },
  hmsHubId: string
) {
  if (!mainAll) return null;

  const result = await resolveCleanFloor({
    req,
    facility: hmsHubId,
    date: wib.date,
    wibHour: wib.hour,
    live: {
      delivered: toSafeNumber(mainAll.delivered),
      ongoing: toSafeNumber(mainAll.ongoing_delivery),
      ftd: toSafeNumber(mainAll.ftd),
      others: toSafeNumber(mainAll.others),
      pending: toSafeNumber(mainAll.pending_at_hub),
      todayVolume:
        toSafeNumber(mainAll.just_arrived) + toSafeNumber(mainAll.backlog),
    },
  });

  return result.payload;
}

export async function GET(req: NextRequest) {
  console.log("=== HIT /api/hms/subdistrict ===");
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token: hmsToken } = await resolveHmsToken(req, session.user.id, session.user);
  if (!hmsToken) {
    return NextResponse.json({ error: "No HMS token" }, { status: 403 });
  }

  const requestedHubId = req.nextUrl.searchParams.get("hubId");
  const activeHub = await resolveActiveHub(session.user.id, requestedHubId, session.user);
  if (!activeHub) {
    return NextResponse.json({ error: "No hub access" }, { status: 403 });
  }

  const HUB_ID = activeHub.hmsHubId;
  const HUB_NAME = activeHub.name;

  console.log(`[subdistrict] hub = ${HUB_NAME} (${HUB_ID})`);
  const currDate = getMainCurrDate();

  let mainAll: any = null;
  let mainCod: any = null;
  let mainUrgent: any = null;
  try {
    const [allRes, codRes, urgentRes] = await Promise.all([
      callHMS(hmsToken, API_ID_MAIN, {
        hub_ids: JSON.stringify([HUB_ID]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES_ALL,
        service_types: SERVICE_TYPES,
      }),
      callHMS(hmsToken, API_ID_MAIN, {
        hub_ids: JSON.stringify([HUB_ID]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES_COD,
        service_types: SERVICE_TYPES,
      }),
      callHMS(hmsToken, API_ID_MAIN, {
        hub_ids: JSON.stringify([HUB_ID]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES_ALL,
        service_types: SERVICE_TYPES,
        is_urgent: "true",
      }),
    ]);
    mainAll = parseCompact(allRes.data.data, allRes.data.fields);
    mainCod = parseCompact(codRes.data.data, codRes.data.fields);
    mainUrgent = parseCompact(urgentRes.data.data, urgentRes.data.fields);
  } catch (e: any) {
    console.warn("[subdistrict] Gagal fetch MAIN:", e.message);
  }

  const cleanFloorData = await getCleanFloor(req, mainAll, getWIBDate(), HUB_ID);

  // COD FD = Ready To Return on COD packages / COD volume.
  let codData = { total: 0, ready_to_return: 0, ftd: 0, fd_percentage: 0 };
  if (mainCod) {
    const readyToReturn = toSafeNumber(mainCod.ready_to_return);
    const codFtd = toSafeNumber(mainCod.ftd);
    const codTotal =
      toSafeNumber(mainCod.today_volume) ||
      toSafeNumber(mainCod.just_arrived) + toSafeNumber(mainCod.backlog);
    const fdPercentage = codTotal > 0 ? (readyToReturn / codTotal) * 100 : 0;
    codData = {
      total: codTotal, ready_to_return: readyToReturn, ftd: codFtd,
      fd_percentage: parseFloat(fdPercentage.toFixed(2)),
    };
  }

  let urgentData = { total: 0, delivered: 0, failed: 0, delivered_percentage: 0 };
  if (mainUrgent) {
    const urgentTotal = toSafeNumber(mainUrgent.just_arrived) + toSafeNumber(mainUrgent.backlog);
    const urgentDelivered = toSafeNumber(mainUrgent.delivered);
    const urgentFailed = toSafeNumber(mainUrgent.ftd);
    const deliveredPercentage = urgentTotal > 0 ? (urgentDelivered / urgentTotal) * 100 : 0;
    urgentData = {
      total: urgentTotal, delivered: urgentDelivered,
      failed: urgentFailed,
      delivered_percentage: parseFloat(deliveredPercentage.toFixed(2)),
    };
  }

  const now = Date.now();
  const cached = cache.get(HUB_ID);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    console.log("[subdistrict] Cache HIT", HUB_ID);
    return NextResponse.json({
      success: true,
      meta: { cached: true, hub_id: HUB_ID, hub_name: HUB_NAME },
      subdistricts: cached.data.subdistricts,
      cod: codData, urgent: urgentData,
      clean_floor: cleanFloorData,
    });
  }

  console.log("[subdistrict] Cache MISS -> fetch shipments", HUB_ID);

  try {
    const fromTs = getCycleStartUnix();
    const toTs = Math.floor(Date.now() / 1000);

    const todayStartTs = getTodayWIBUnix(0);
    const c1EndTs = getTodayWIBUnix(8);
    const before12Ts = getTodayWIBUnix(12);

    const inboundResult = await fetchOperationalInboundByAwb(
      hmsToken, HUB_NAME, fromTs, toTs
    );
    const operationalInboundByAwb = inboundResult.inboundByAwb;
    const debugFacilitiesAll = Array.from(inboundResult.debugFacilities).sort();
    const debugChunks = inboundResult.debugChunks;

    const allShipments = await fetchShipmentsForAwbs(
      hmsToken, Array.from(operationalInboundByAwb.keys())
    );

    const uniqueMap = new Map<string, any>();
    for (const [index, shipment] of allShipments.entries()) {
      const key = String(shipment.awb_number || shipment.id || `row-${index}`);
      if (!uniqueMap.has(key)) uniqueMap.set(key, shipment);
    }

    const normalizedHubName = normalizeHubName(HUB_NAME);
    const filtered = Array.from(uniqueMap.values()).filter(
      (shipment) =>
        normalizeHubName(String(shipment.actual_hub || "")) === normalizedHubName
    );

    type GroupData = {
      subdistrict: string; overall: number; fresh: number; backlog: number;
      fresh_c1: number; fresh_c2: number; delivered: number;
      delivering: number; failed: number; fresh_before_12: number;
    };
    const bySubdistrict = new Map<string, GroupData>();

    for (const shipment of filtered) {
      const rawSubdistrict =
        shipment.destination_details?.destination_sub_district_name ||
        shipment.district?.sub_district_name;
      const subdistrict =
        typeof rawSubdistrict === "string" && rawSubdistrict.trim()
          ? rawSubdistrict.trim()
          : "Unmapped";

      if (!bySubdistrict.has(subdistrict)) {
        bySubdistrict.set(subdistrict, {
          subdistrict, overall: 0, fresh: 0, backlog: 0,
          fresh_c1: 0, fresh_c2: 0, delivered: 0,
          delivering: 0, failed: 0, fresh_before_12: 0,
        });
      }
      const group = bySubdistrict.get(subdistrict)!;
      group.overall++;

      const awb = String(shipment.awb_number || "").trim();
      const inboundAt = operationalInboundByAwb.get(awb) || 0;
      const isFresh = inboundAt >= todayStartTs;
      const isFreshC1 = isFresh && inboundAt < c1EndTs;

      if (isFresh) group.fresh++;
      else group.backlog++;
      if (isFreshC1) group.fresh_c1++;
      else if (isFresh) group.fresh_c2++;

      const status = getShipmentStatus(shipment.status);
      if (status === "delivered") group.delivered++;
      if (status === "delivering") group.delivering++;
      if (status === "failed") group.failed++;

      if (isFreshC1) {
        const deliveredAt = toUnixSeconds(shipment.destination_details?.delivery_time);
        if (deliveredAt >= todayStartTs && deliveredAt < before12Ts) {
          group.fresh_before_12++;
        }
      }
    }

    const subdistricts = Array.from(bySubdistrict.values())
      .map((group) => ({
        ...group,
        sd_before_12:
          group.fresh_c1 > 0
            ? parseFloat(((group.fresh_before_12 / group.fresh_c1) * 100).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.overall - a.overall);

    cache.set(HUB_ID, { data: { subdistricts }, timestamp: Date.now() });

    return NextResponse.json({
      success: true,
      meta: {
        cached: false,
        fetched_at: new Date().toISOString(),
        hub_id: HUB_ID, hub_name: HUB_NAME,
        total_shipments: filtered.length,
        operational_awbs: operationalInboundByAwb.size,
        debug_lm_facilities_count: debugFacilitiesAll.length,
        debug_lm_facilities_jatinegara_like: debugFacilitiesAll.filter((f) =>
          /jatinegara|pulogadung/i.test(f)
        ),
        debug_chunks: debugChunks,
        missing_tms_shipments: Math.max(operationalInboundByAwb.size - filtered.length, 0),
        expected_today_volume: toSafeNumber(mainAll?.today_volume),
        coverage_percentage:
          toSafeNumber(mainAll?.today_volume) > 0
            ? parseFloat(((filtered.length / toSafeNumber(mainAll.today_volume)) * 100).toFixed(2))
            : 0,
        fresh_c1_shipments: subdistricts.reduce((sum, row) => sum + row.fresh_c1, 0),
      },
      subdistricts,
      cod: codData,
      urgent: urgentData,
      clean_floor: cleanFloorData,
    });
  } catch (e: any) {
    console.error("[subdistrict] Error:", e.message);
    return NextResponse.json(
      { error: "HMS failed", detail: e.message },
      { status: 502 }
    );
  }
}

