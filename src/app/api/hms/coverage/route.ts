import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildHmsHeaders } from '@/lib/hms-headers';
import { refreshHmsToken } from '@/lib/hms-client';
import { NextRequest, NextResponse } from "next/server";

const REFRESH_WINDOW_MS = 30 * 60 * 1000;

const API_ID_MAIN = "7564027893345453074";
const API_ID_COURIER = "7514949742451868679";
const API_ID_DEDICATED = "7591486857905554439";

const PAYMENT_TYPES_ALL = '["cashless","cod"]';
const PAYMENT_TYPES_COD = '["cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';
const JOB_ROLES_CYCLE =
  '["Rider LM 2W - Mitra Prioritas","Ops LM - Mitra","Ops LM - Mitra Oncall","Rider LM 2W","Dedicated Rider LM 2W","Ops LM"]';
const JOB_ROLES_DEDICATED = '["Dedicated Rider LM 2W"]';
const DEDICATED_TARGET = 135;

type CacheEntry = { data: any; timestamp: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

// ============================================================
// WAKTU
// ============================================================
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

function getCurrentWIBHour(): number {
  return toWIB().getUTCHours();
}

function getTodayWIBUnix(hour: number): number {
  const d = toWIB();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return Math.floor((Date.UTC(y, m, day, hour, 0, 0) - 7 * 60 * 60 * 1000) / 1000);
}

// ============================================================
// HMS CALL
// ============================================================
async function callHMS(
  token: string,
  apiId: string,
  params: Record<string, any>,
  retries = 2
) {
  const url = `${process.env.HMS_BASE_URL}/dc/v1/oneservice`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          ...buildHmsHeaders(token),
        },
        body: JSON.stringify({ api_id: apiId, params }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HMS HTTP ${res.status}`);
      const json = await res.json();
      if (json.code !== 200) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new Error(`HMS code ${json.code}`);
      }
      return json;
    } catch (e: any) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error("HMS retry exhausted");
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
      return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }
  return 0;
}

// ============================================================
// C1 SCANNER (untuk SD12)
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
        filters: { received_at_from: fromTs, received_at_to: toTs },
        page,
        size: 100,
      }),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`HMS task page ${page}: ${res.status}`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(`HMS task error: ${json.message || json.code}`);
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
      ...buildHmsHeaders(token),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`TMS page ${page}: ${res.status}`);
  return res.json();
}

async function fetchShipmentsForAwbs(token: string, awbs: string[]) {
  if (awbs.length === 0) return [];
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


// Normalize hub name for matching (strip GTL/Hub tokens, remove non-alphanumeric)
function normalizeHubName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\bgtl\b/g, "")
    .replace(/\bhub\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function computeC1FromInboundScan(
  hmsToken: string,
  hubName: string
): Promise<{ c1: number; deliveredBefore12: number }> {
  const fromTs = getTodayWIBUnix(0);
  const toTs = getTodayWIBUnix(8);
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

  return { c1: uniqueFreshC1Tasks.length, deliveredBefore12 };
}

// ============================================================
// DEDICATED MERGED
// ============================================================
async function fetchDedicatedMerged(token: string, hubId: string) {
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

      const res = await callHMS(token, API_ID_DEDICATED, {
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

// ============================================================
// CLEAN FLOOR (live)
// ============================================================
function computeCleanFloor(main: any, freshC1: number): number {
  const justArrived = Number(main.just_arrived) || 0;
  const backlog = Number(main.backlog) || 0;
  const volumeOverall = justArrived + backlog;
  const pendingAtHub = Number(main.pending_at_hub) || 0;
  const numerator = volumeOverall - pendingAtHub;
  return volumeOverall > 0 ? Math.min((numerator / volumeOverall) * 100, 100) : 0;
}

// ============================================================
// FETCH HUB SUMMARY
// ============================================================
async function fetchHubSummary(
  token: string,
  hubId: string,
  hubName: string,
  currDate: string,
  todayDate: string
) {
  try {
    const [mainRes, codRes, urgentRes, courierRes] = await Promise.all([
      callHMS(token, API_ID_MAIN, {
        hub_ids: JSON.stringify([hubId]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES_ALL,
        service_types: SERVICE_TYPES,
      }),
      callHMS(token, API_ID_MAIN, {
        hub_ids: JSON.stringify([hubId]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES_COD,
        service_types: SERVICE_TYPES,
      }).catch(() => null),
      callHMS(token, API_ID_MAIN, {
        hub_ids: JSON.stringify([hubId]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES_ALL,
        service_types: SERVICE_TYPES,
        is_urgent: "true",
      }).catch(() => null),
      callHMS(token, API_ID_COURIER, {
        hub_ids: JSON.stringify([hubId]),
        curr_date_start: currDate,
        date: todayDate,
        job_roles: JOB_ROLES_CYCLE,
      }).catch(() => null),
    ]);

    const main = parseCompact(mainRes.data.data, mainRes.data.fields);
    if (!main) {
      return { hubId, hubName, success: false, error: "Empty response" };
    }

    let dedicated = {
      actual: 0, totalPicked: 0, totalDelivered: 0,
      avgPickup: 0, avgDelivered: 0, achievementPct: 0, drivers: [] as string[],
    };
    try {
      dedicated = await fetchDedicatedMerged(token, hubId);
    } catch (e: any) {
      console.warn(`[coverage] Dedicated failed for ${hubName}:`, e.message);
    }
    // SD12 = C1 delivered before 12 / C1 volume
    const c1Result = await computeC1FromInboundScan(token, hubName).catch((e: any) => {
      console.warn(`[coverage] C1 scan failed for ${hubName}:`, e.message);
      return { c1: 0, deliveredBefore12: 0 };
    });
    const justArrived = Number(main.just_arrived) || 0;
    const backlog = Number(main.backlog) || 0;

    let freshC1 = Math.min(c1Result.c1, justArrived);
    let sdBefore12 = freshC1 > 0 ? (c1Result.deliveredBefore12 / freshC1) * 100 : 0;
    let c1Count = freshC1;
    let deliveredBefore12 = c1Result.deliveredBefore12;
    const delivered = Number(main.delivered) || 0;
    const ongoing = Number(main.ongoing_delivery) || 0;
    const ftdInDriver = Number(main.in_driver) || 0;
    const ftdTotal = Number(main.ftd) || 0;
    const pendingAtHub = Number(main.pending_at_hub) || 0;

    const others = Number(main.others) || 0;
    const todayVolume = justArrived + backlog;

    const deliveredPct = Number(main.delivered_percentage) || 0;
    const freshSuccess =
      justArrived > 0
        ? ((Number(main.delivered_just_arrived) || 0) / justArrived) * 100
        : 0;

    const cleanFloorLive = computeCleanFloor(main, c1Count);

    let codFd = 0;
    let codTotal = 0;
    if (codRes) {
      const cod = parseCompact(codRes.data.data, codRes.data.fields);
      if (cod) {
        const codJust = Number(cod.just_arrived) || 0;
        const codBack = Number(cod.backlog) || 0;
        const codRtr = Number(cod.ready_to_return) || 0;
        codTotal = codJust + codBack;
        codFd = codTotal > 0 ? (codRtr / codTotal) * 100 : 0;
      }
    }

    let urgentPct = 0, urgentTotal = 0, urgentDelivered = 0;
    if (urgentRes) {
      const urg = parseCompact(urgentRes.data.data, urgentRes.data.fields);
      if (urg) {
        urgentTotal = (Number(urg.just_arrived) || 0) + (Number(urg.backlog) || 0);
        urgentDelivered = Number(urg.delivered) || 0;
        urgentPct = urgentTotal > 0 ? (urgentDelivered / urgentTotal) * 100 : 0;
      }
    }

    // Oncall = Courier (Rider LM 2W Mitra)
    let oncallAvgProductivity = 0;
    let oncallCheckIn = 0;
    let oncallAssigned = 0;
    let oncallOutDrivers = 0;
    if (courierRes) {
      const courier = parseCompact(courierRes.data.data, courierRes.data.fields);
      if (courier) {
        oncallAvgProductivity = parseFloat(courier.avg_productivity) || 0;
        oncallCheckIn = Number(courier.check_in) || 0;
        oncallAssigned = Number(courier.assigned) || 0;
        oncallOutDrivers = Number(courier.out_drivers) || 0;
      }
    }

    return {
      hubId,
      hubName,
      success: true,
      just_arrived: justArrived,
      backlog,
      today_volume: todayVolume,
      pending_at_hub: pendingAtHub,
      delivered,
      ongoing_delivery: ongoing,
      ftd: ftdInDriver,
      ftd_total: ftdTotal,
      others,
      delivered_percentage: parseFloat(deliveredPct.toFixed(2)),
      fresh_success: parseFloat(freshSuccess.toFixed(2)),
      sd_before_12: parseFloat(sdBefore12.toFixed(2)),
      sd12_c1_total: c1Count,
      sd12_delivered_before_12: deliveredBefore12,
      cod_fd: parseFloat(codFd.toFixed(2)),
      cod_total: codTotal,
      urgent_pct: parseFloat(urgentPct.toFixed(2)),
      urgent_total: urgentTotal,
      urgent_delivered: urgentDelivered,
      dedicated_avg_delivered: dedicated.avgDelivered,
      dedicated_total_delivered: dedicated.totalDelivered,
      dedicated_achievement_pct: dedicated.achievementPct,
      dedicated_actual: dedicated.actual,
      dedicated_drivers: dedicated.drivers,
      oncall_avg_productivity: parseFloat(oncallAvgProductivity.toFixed(2)),
      oncall_check_in: oncallCheckIn,
      oncall_assigned: oncallAssigned,
      oncall_out_drivers: oncallOutDrivers,
      clean_floor: parseFloat(cleanFloorLive.toFixed(2)),
    };
  } catch (e: any) {
    return { hubId, hubName, success: false, error: e.message };
  }
}

async function fetchInBatches(
  hubs: Array<{ hubId: string; hubName: string }>,
  token: string,
  currDate: string,
  todayDate: string,
  batchSize = 2,
  delayMs = 1500
) {
  const results: any[] = [];
  for (let i = 0; i < hubs.length; i += batchSize) {
    const batch = hubs.slice(i, i + batchSize);
    console.log(`[coverage] Batch ${Math.floor(i / batchSize) + 1}: ${batch.map((h) => h.hubName).join(", ")}`);
    const batchResults = await Promise.all(
      batch.map((h) => fetchHubSummary(token, h.hubId, h.hubName, currDate, todayDate))
    );
    results.push(...batchResults);
    if (i + batchSize < hubs.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

export async function GET(req: NextRequest) {
  console.log("=== HIT /api/hms/coverage ===");
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userHubs = await prisma.userHub.findMany({
    where: { userId: session.user.id },
    include: { hub: true },
  });
  if (userHubs.length === 0) {
    return NextResponse.json({ error: "No hub access" }, { status: 403 });
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

  const currDate = getMainCurrDate();
  const todayDate = getTodayDate();
  const currentHour = getCurrentWIBHour();

  const cleanFloorRows = await prisma.cleanFloorSnapshot.findMany({
    where: {
      facility: { in: userHubs.map((uh) => uh.hub.hmsHubId) },
      date: todayDate,
    },
    select: { facility: true, value: true },
  });
  const cleanFloorMap = new Map<string, number>();
  for (const row of cleanFloorRows) {
    cleanFloorMap.set(row.facility, parseFloat(row.value.toFixed(2)));
  }

  const results = await fetchInBatches(
    userHubs.map((uh) => ({ hubId: uh.hub.hmsHubId, hubName: uh.hub.name })),
    user.hmsToken,
    currDate,
    todayDate,
    2,
    1500
  );

  for (const r of results) {
    if (r.success) {
      const cf = cleanFloorMap.get(r.hubId);
      if (cf !== undefined) {
        r.clean_floor = cf;
        r.clean_floor_locked = true;
      } else {
        r.clean_floor_locked = currentHour >= 8;
      }
    }
  }

  const aggregated = results.reduce(
    (acc, r: any) => {
      if (!r.success) return acc;
      acc.total_volume += r.today_volume || 0;
      acc.total_delivered += r.delivered || 0;
      acc.total_ongoing += r.ongoing_delivery || 0;
      acc.total_ftd += r.ftd || 0;
      acc.total_pending += r.pending_at_hub || 0;
      return acc;
    },
    { total_volume: 0, total_delivered: 0, total_ongoing: 0, total_ftd: 0, total_pending: 0 }
  );

  const avgSuccess =
    aggregated.total_volume > 0
      ? parseFloat(((aggregated.total_delivered / aggregated.total_volume) * 100).toFixed(2))
      : 0;

  const successCount = results.filter((r: any) => r.success).length;

  return NextResponse.json({
    success: true,
    meta: {
      hubs_count: userHubs.length,
      success_count: successCount,
      fail_count: userHubs.length - successCount,
      fetched_at: new Date().toISOString(),
      current_wib_hour: currentHour,
    },
    aggregated: { ...aggregated, avg_success: avgSuccess, total_pending: aggregated.total_pending },
    hubs: results,
  });
}


