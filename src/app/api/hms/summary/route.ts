import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// API IDs
const API_ID_MAIN = "7564027893345453074";
const API_ID_CYCLE1 = "7657180282079970311";
const API_ID_OPS = "7517597334683780103";
const API_ID_COURIER = "7514949742451868679";

const HUB_ID_JATINEGARA = "460450593288";
const HUB_NAME_JATINEGARA = "GTL Jatinegara Hub";
const PAYMENT_TYPES = '["cashless","cod"]';
const PAYMENT_TYPES_COD = '["cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';
const JOB_ROLES_CYCLE =
  '["Rider LM 2W - Mitra Prioritas","Ops LM - Mitra","Ops LM - Mitra Oncall","Rider LM 2W","Dedicated Rider LM 2W","Ops LM"]';

// Cache
type CacheEntry = { data: any; timestamp: number };
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5 * 1000;

// ============================================================
// HELPER: WIB Dates
// ============================================================
function getMainCurrDate(): string {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate() - 1;
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")} 17:00:00`;
}

function getTodayDate(): string {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function getCycleList(): string {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate() - 1;
  const startMs = Date.UTC(y, m, d, 17, 0, 0) - wibOffsetMs;
  const endMs = Date.UTC(y, m, d + 1, 17, 0, 0) - wibOffsetMs;
  return JSON.stringify([
    `${Math.floor(startMs / 1000)}-${Math.floor(endMs / 1000)}`,
  ]);
}

/** Timestamp jam 08:00 WIB hari ini */
function get8amWIBUnix(): number {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate();
  const cutoffMs = Date.UTC(y, m, d, 8, 0, 0) - wibOffsetMs;
  return Math.floor(cutoffMs / 1000);
}

/** Timestamp jam 00:00 WIB hari ini */
function getTodayWIBUnix(hour: number): number {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate();
  const timestampMs = Date.UTC(y, m, d, hour, 0, 0) - wibOffsetMs;
  return Math.floor(timestampMs / 1000);
}

function get12amWIBUnix(): number {
  return getTodayWIBUnix(0);
}

// ============================================================
// HELPER: Call HMS
// ============================================================
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
      Referer:
        "https://gtl-id.tokgistic.com/tms/operation-performance-central",
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

// ============================================================
// HELPER: Fetch HMS task page by inbound scan (received_at)
// ============================================================
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
        filters: {
          received_at_from: fromTs,
          received_at_to: toTs,
        },
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
  const url = new URL(`${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`);
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
      chunks.slice(i, i + 5).map((chunk) => fetchShipmentsPage(token, 1, chunk))
    );
    for (const result of results) {
      shipments.push(...(result?.data?.shipments || []));
    }
  }
  return shipments;
}

// ============================================================
// HELPER: C1 from actual inbound scan timestamp (received_at)
// ============================================================
function toUnixSeconds(value: unknown): number {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }
  return 0;
}

async function computeC1FromInboundScan(hmsToken: string) {
  const fromTs = get12amWIBUnix();
  const toTs = get8amWIBUnix();
  const firstPage = await fetchInboundTasksPage(hmsToken, 1, fromTs, toTs);
  const totalRecords = Number(firstPage?.data?.pagination?.total) || 0;
  const totalPages = Math.ceil(totalRecords / 100);
  let allTasks: any[] = firstPage?.data?.tasks || [];

  if (totalPages > 1) {
    const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const batchSize = 5;
    for (let i = 0; i < pages.length; i += batchSize) {
      const results = await Promise.all(
        pages
          .slice(i, i + batchSize)
          .map((page) => fetchInboundTasksPage(hmsToken, page, fromTs, toTs))
      );
      for (const result of results) {
        allTasks = allTasks.concat(result?.data?.tasks || []);
      }
    }
  }

  // The API can return a small number of records from nearby facilities.
  // Use the task's actual LM facility to keep only Jatinegara inbound scans.
  const jatinegaraTasks = allTasks.filter(
    (task) => task.lm_facility === HUB_NAME_JATINEGARA
  );
  const uniqueFreshC1Tasks = Array.from(
    new Map(
      jatinegaraTasks.map((task, index) => [
        task.awb_number || task.tracking_number || task.id || `row-${index}`,
        task,
      ])
    ).values()
  );
  const deliveredFromTs = getTodayWIBUnix(0);
  const deliveredBeforeTs = getTodayWIBUnix(12);
  const freshC1Awbs = uniqueFreshC1Tasks
    .map((task) => String(task.awb_number || task.tracking_number || "").trim())
    .filter(Boolean);
  const shipments = await fetchShipmentsForAwbs(hmsToken, freshC1Awbs);
  const deliveredBefore12 = new Set(
    shipments
      .filter((shipment) => {
        const deliveredAt = toUnixSeconds(
          shipment.destination_details?.delivery_time
        );
        return deliveredAt >= deliveredFromTs && deliveredAt < deliveredBeforeTs;
      })
      .map((shipment) => String(shipment.awb_number || "").trim())
      .filter(Boolean)
  ).size;

  console.log(
    `C1 received 00:00-08:00: API=${totalRecords}, Jatinegara=${uniqueFreshC1Tasks.length}, delivered before noon=${deliveredBefore12}`
  );

  return { c1: uniqueFreshC1Tasks.length, deliveredBefore12 };
}

// ============================================================
// MAIN
// ============================================================
export async function GET(req: NextRequest) {
  console.log("=== HIT /api/hms/summary ===");

  const session = await auth();

if (!session?.user?.id) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hmsToken: true },
  });

  if (!user?.hmsToken) {
    return NextResponse.json(
      { error: "No HMS token", message: "Buka HMS dulu." },
      { status: 403 }
    );
  }

  // Cache
  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({
      success: true,
      meta: {
        cached: true,
        cache_age_seconds: Math.floor((now - cache.timestamp) / 1000),
      },
      summary: cache.data,
    });
  }

  console.log("[summary] Cache MISS - fetch HMS");

  try {
    const currDate = getMainCurrDate();
    const todayDate = getTodayDate();
    const cycleList = getCycleList();

    // Fetch HMS metrics in parallel + C1 from received_at inbound scans.
    const [mainRes, codRes, cycleRes, opsRes, courierRes, c1Result] =
      await Promise.all([
        callHMS(user.hmsToken, API_ID_MAIN, {
          hub_ids: JSON.stringify([HUB_ID_JATINEGARA]),
          curr_date: currDate,
          payment_types: PAYMENT_TYPES,
          service_types: SERVICE_TYPES,
        }),
        // COD-only: untuk menghitung COD FD
        callHMS(user.hmsToken, API_ID_MAIN, {
          hub_ids: JSON.stringify([HUB_ID_JATINEGARA]),
          curr_date: currDate,
          payment_types: PAYMENT_TYPES_COD,
          service_types: SERVICE_TYPES,
        }).catch((e) => {
          console.warn("[cod-fd] Gagal fetch COD:", e.message);
          return null;
        }),
        callHMS(user.hmsToken, API_ID_CYCLE1, {
          hub_id: HUB_ID_JATINEGARA,
          driver_name: "",
          job_roles: JOB_ROLES_CYCLE,
          cycle_list: cycleList,
        }),
        callHMS(user.hmsToken, API_ID_OPS, {
          hub_ids: JSON.stringify([HUB_ID_JATINEGARA]),
          curr_date_start: currDate,
          date: todayDate,
        }),
        callHMS(user.hmsToken, API_ID_COURIER, {
          hub_ids: JSON.stringify([HUB_ID_JATINEGARA]),
          curr_date_start: currDate,
          date: todayDate,
          job_roles: JOB_ROLES_CYCLE,
        }),
        computeC1FromInboundScan(user.hmsToken).catch((e) => {
          console.warn("[c1c2] Gagal menghitung C1 dari received_at:", e.message);
          return { c1: 0, deliveredBefore12: 0 };
        }),
      ]);

    const main = parseCompact(mainRes.data.data, mainRes.data.fields)!;
    const cycle = parseCompact(cycleRes.data.data, cycleRes.data.fields)!;
    const ops = parseCompact(opsRes.data.data, opsRes.data.fields)!;
    const courier = parseCompact(courierRes.data.data, courierRes.data.fields)!;

    // --- COD FD ---
    // Formula: COD FD (%) = (COD ready_to_return) / (COD just_arrived + COD backlog) * 100
    let codReadyToReturn = 0;
    let codJustArrived = 0;
    let codBacklog = 0;
    let codTotalVolume = 0;
    let codFd = 0;

    if (codRes) {
      const codMain = parseCompact(codRes.data.data, codRes.data.fields);
      if (codMain) {
        codReadyToReturn = codMain.ready_to_return || 0;
        codJustArrived = codMain.just_arrived || 0;
        codBacklog = codMain.backlog || 0;
        codTotalVolume = codJustArrived + codBacklog;
        codFd =
          codTotalVolume > 0
            ? parseFloat(((codReadyToReturn / codTotalVolume) * 100).toFixed(2))
            : 0;
      }
    }

    console.log(`[cod-fd] ready_to_return=${codReadyToReturn} | just_arrived=${codJustArrived} | backlog=${codBacklog} | total=${codTotalVolume} | COD FD=${codFd}%`);
    // --- END COD FD ---

    // Fresh Success
    const deliveredJustArrived = main.delivered_just_arrived || 0;
    const justArrived = Number(main.just_arrived) || 0;
    const freshC1 = Math.min(c1Result.c1, justArrived);
    // Every fresh package not scanned during C1 belongs to C2. This keeps
    // C1 + C2 reconciled with the OPC Just Arrived (Fresh) population.
    const freshC2 = Math.max(justArrived - freshC1, 0);
    // SD < 12 PM = Fresh C1 AWBs delivered before 12:00 WIB / Fresh C1.
    const deliveredBefore12 = Math.min(c1Result.deliveredBefore12, freshC1);
    const sdBefore12 =
      freshC1 > 0 ? (deliveredBefore12 / freshC1) * 100 : 0;
    const freshSuccess =
      justArrived > 0
        ? parseFloat(((deliveredJustArrived / justArrived) * 100).toFixed(2))
        : 0;

    // Clean Floor: live before 08:00 WIB, then immutable per facility/date.
    const backlog = Number(main.backlog) || 0;
    const cleanFloorOngoing = Number(main.ongoing_delivery) || 0;
    const cleanFloorDelivered = Number(main.delivered) || 0;
    const cleanFloorFtd = Number(main.ftd) || 0;
    const cleanFloorOthers = Number(main.others) || 0;
    const cleanFloorTodayVolume = justArrived + backlog;
    const cleanFloorNumerator =
      cleanFloorOngoing + cleanFloorDelivered + cleanFloorFtd + cleanFloorOthers;
    const cleanFloorValue =
      cleanFloorTodayVolume > 0
        ? (cleanFloorNumerator / cleanFloorTodayVolume) * 100
        : 0;
    const currentWibHour = new Date(
      Date.now() + 7 * 60 * 60 * 1000
    ).getUTCHours();
    const lockedAt = `${todayDate}T01:00:00.000Z`;
    const snapshotKey = {
      facility: HUB_ID_JATINEGARA,
      date: todayDate,
    };

    const formatLockedSnapshot = (snapshot: {
      value: number;
      delivered: number;
      ongoing: number;
      ftd: number;
      others: number;
      denominator: number;
      numerator: number;
      capturedAt: Date;
    }) => ({
      value: parseFloat(snapshot.value.toFixed(2)),
      breakdown: {
        delivered: snapshot.delivered,
        ongoing: snapshot.ongoing,
        ftd: snapshot.ftd,
        others: snapshot.others,
        pending: 0,
        today_volume: snapshot.denominator,
        numerator: snapshot.numerator,
      },
      is_locked: true,
      locked_at: lockedAt,
      quality: "accurate" as const,
      captured_at: snapshot.capturedAt.toISOString(),
    });

    let cleanFloor;
    if (currentWibHour < 8) {
      cleanFloor = {
        value: parseFloat(cleanFloorValue.toFixed(2)),
        breakdown: {
          delivered: cleanFloorDelivered,
          ongoing: cleanFloorOngoing,
          ftd: cleanFloorFtd,
          others: cleanFloorOthers,
          pending: Number(main.pending_at_hub) || 0,
          today_volume: cleanFloorTodayVolume,
          numerator: cleanFloorNumerator,
        },
        is_locked: false,
        locked_at: lockedAt,
        quality: "live" as const,
        captured_at: new Date().toISOString(),
      };
    } else {
      const existing = await prisma.cleanFloorSnapshot.findUnique({
        where: { facility_date: snapshotKey },
      });

      if (existing) {
        cleanFloor = formatLockedSnapshot(existing);
      } else {
        try {
          const created = await prisma.cleanFloorSnapshot.create({
            data: {
              ...snapshotKey,
              value: cleanFloorValue,
              numerator: cleanFloorNumerator,
              denominator: cleanFloorTodayVolume,
              delivered: cleanFloorDelivered,
              ongoing: cleanFloorOngoing,
              ftd: cleanFloorFtd,
              others: cleanFloorOthers,
            },
          });
          cleanFloor = formatLockedSnapshot(created);
        } catch (error: any) {
          if (error.code !== "P2002") throw error;
          const winner = await prisma.cleanFloorSnapshot.findUnique({
            where: { facility_date: snapshotKey },
          });
          if (!winner) throw error;
          cleanFloor = formatLockedSnapshot(winner);
        }
      }
    }
    // OPS
    const opsProductivity = parseFloat(ops?.avg_productivity) || 0;
    const opsTarget = 1100;
    const opsAchieved = opsProductivity >= opsTarget;

    const summary = {
      hub_id: main.hub_id,
      hub_name: main.hub_name,

      // Volume
      just_arrived: justArrived,
      backlog,
      today_volume: cleanFloorTodayVolume,
      clean_floor: cleanFloor,

      // C1 uses HMS task received_at (actual inbound scan). C2 is the
      // remaining OPC Fresh Volume, so the two batches always reconcile.
      fresh_c1: freshC1,
      fresh_c2: freshC2,
      fresh_total_computed: freshC1 + freshC2,

      // Status
      pending_at_hub: main.pending_at_hub || 0,
      ongoing_delivery: main.ongoing_delivery || 0,
      delivered: main.delivered || 0,
      delivered_percentage: parseFloat(main.delivered_percentage) || 0,
      ftd: main.ftd || 0,
      ready_to_return: main.ready_to_return || 0,
      others: main.others || 0,

      // COD FD
      cod_ready_to_return: codReadyToReturn,
      cod_just_arrived: codJustArrived,
      cod_backlog: codBacklog,
      cod_total_volume: codTotalVolume,
      cod_fd: codFd,

      // Fresh Success
      delivered_just_arrived: deliveredJustArrived,
      delivered_backlog: main.delivered_backlog || 0,
      fresh_success: freshSuccess,

      // SD < 12 PM: Fresh delivered before noon / Fresh C1.
      cycle_total_picked: freshC1,
      delivered_before_12: deliveredBefore12,
      sd_before_12: parseFloat(sdBefore12.toFixed(2)),

      // COURIER
      courier_assigned: courier?.assigned || 0,
      courier_check_in: courier?.check_in || 0,
      courier_check_in_percent:
        parseFloat(courier?.check_in_percent) || 0,
      courier_out_drivers: courier?.out_drivers || 0,
      courier_out_percent: parseFloat(courier?.out_percent) || 0,
      courier_avg_productivity:
        parseFloat(courier?.avg_productivity) || 0,

      // OPS
      ops_assigned: ops?.assigned || 0,
      ops_check_in: ops?.check_in || 0,
      ops_check_in_percent: parseFloat(ops?.check_in_percent) || 0,
      ops_productivity: opsProductivity,
      ops_target: opsTarget,
      ops_achieved: opsAchieved,

      cycle_name: cycle?.cycle_name || "",
      fetched_at: new Date().toISOString(),
    };

    cache = { data: summary, timestamp: Date.now() };

    return NextResponse.json({
      success: true,
      meta: { cached: false, fetched_at: new Date().toISOString() },
      summary,
    });
  } catch (e: any) {
    console.error("[summary] Error:", e.message);
    return NextResponse.json(
      { error: "HMS failed", detail: e.message },
      { status: 502 }
    );
  }
}
