import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const API_ID_MAIN = "7564027893345453074";
const API_ID_CYCLE1 = "7657180282079970311";
const API_ID_OPS = "7517597334683780103";
const API_ID_COURIER = "7514949742451868679";
const API_ID_DEDICATED = "7591486857905554439";

const PAYMENT_TYPES = '["cashless","cod"]';
const PAYMENT_TYPES_COD = '["cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';
const JOB_ROLES_CYCLE =
  '["Rider LM 2W - Mitra Prioritas","Ops LM - Mitra","Ops LM - Mitra Oncall","Rider LM 2W","Dedicated Rider LM 2W","Ops LM"]';
const JOB_ROLES_DEDICATED = '["Dedicated Rider LM 2W"]';
const DEDICATED_TARGET = 135;

type CacheEntry = { data: any; timestamp: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 1000;

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
  if (!res.ok) throw new Error(`HMS HTTP ${res.status}`);
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

  const hubTasks = allTasks.filter((task) => task.lm_facility === hubName);
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

  return { c1: uniqueFreshC1Tasks.length, deliveredBefore12 };
}

async function resolveActiveHub(
  userId: string,
  requestedHmsHubId: string | null
) {
  const userHubs = await prisma.userHub.findMany({
    where: { userId },
    include: { hub: true },
  });
  if (userHubs.length === 0) return null;
  if (requestedHmsHubId) {
    const match = userHubs.find(
      (uh) => uh.hub.hmsHubId === requestedHmsHubId
    );
    if (match) return match.hub;
  }
  return userHubs[0].hub;
}

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

  const requestedHubId = req.nextUrl.searchParams.get("hubId");
  const activeHub = await resolveActiveHub(session.user.id, requestedHubId);
  if (!activeHub) {
    return NextResponse.json({ error: "No hub access" }, { status: 403 });
  }

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

    const [mainRes, codRes, cycleRes, opsRes, courierRes, dedicatedMerged, c1Result] =
      await Promise.all([
        callHMS(user.hmsToken, API_ID_MAIN, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date: currDate,
          payment_types: PAYMENT_TYPES,
          service_types: SERVICE_TYPES,
        }),
        callHMS(user.hmsToken, API_ID_MAIN, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date: currDate,
          payment_types: PAYMENT_TYPES_COD,
          service_types: SERVICE_TYPES,
        }).catch((e) => {
          console.warn("[cod] Gagal:", e.message);
          return null;
        }),
        callHMS(user.hmsToken, API_ID_CYCLE1, {
          hub_id: HUB_ID,
          driver_name: "",
          job_roles: JOB_ROLES_CYCLE,
          cycle_list: cycleList,
        }).catch((e) => {
          console.warn("[cycle1] Gagal:", e.message);
          return null;
        }),
        callHMS(user.hmsToken, API_ID_OPS, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date_start: currDate,
          date: todayDate,
        }).catch((e) => {
          console.warn("[ops] Gagal:", e.message);
          return null;
        }),
        callHMS(user.hmsToken, API_ID_COURIER, {
          hub_ids: JSON.stringify([HUB_ID]),
          curr_date_start: currDate,
          date: todayDate,
          job_roles: JOB_ROLES_CYCLE,
        }).catch((e) => {
          console.warn("[courier] Gagal:", e.message);
          return null;
        }),
        fetchDedicatedMerged(user.hmsToken, HUB_ID).catch((e) => {
          console.warn("[dedicated] Gagal:", e.message);
          return {
            actual: 0, totalPicked: 0, totalDelivered: 0,
            avgPickup: 0, avgDelivered: 0, achievementPct: 0, drivers: [],
          };
        }),
        computeC1FromInboundScan(user.hmsToken, HUB_NAME).catch((e) => {
          console.warn("[c1c2] Gagal:", e.message);
          return { c1: 0, deliveredBefore12: 0 };
        }),
      ]);

    if (!mainRes) {
      return NextResponse.json({ error: "HMS MAIN failed" }, { status: 502 });
    }

    const main = parseCompact(mainRes.data.data, mainRes.data.fields)!;
    const cycle = cycleRes ? parseCompact(cycleRes.data.data, cycleRes.data.fields) : null;
    const ops = opsRes ? parseCompact(opsRes.data.data, opsRes.data.fields) : null;
    const courier = courierRes ? parseCompact(courierRes.data.data, courierRes.data.fields) : null;

    let codReadyToReturn = 0, codJustArrived = 0, codBacklog = 0, codTotalVolume = 0, codFd = 0;

    if (codRes) {
      const codMain = parseCompact(codRes.data.data, codRes.data.fields);
      if (codMain) {
        codReadyToReturn = codMain.ready_to_return || 0;
        codJustArrived = codMain.just_arrived || 0;
        codBacklog = codMain.backlog || 0;
        codTotalVolume = codJustArrived + codBacklog;
        codFd = codTotalVolume > 0
          ? parseFloat(((codReadyToReturn / codTotalVolume) * 100).toFixed(2))
          : 0;
      }
    }

    const deliveredJustArrived = main.delivered_just_arrived || 0;
    const justArrived = Number(main.just_arrived) || 0;
    const freshC1 = Math.min(c1Result.c1, justArrived);
    const freshC2 = Math.max(justArrived - freshC1, 0);
    const deliveredBefore12 = Math.min(c1Result.deliveredBefore12, freshC1);
    const sdBefore12 = freshC1 > 0 ? (deliveredBefore12 / freshC1) * 100 : 0;
    const freshSuccess =
      justArrived > 0
        ? parseFloat(((deliveredJustArrived / justArrived) * 100).toFixed(2))
        : 0;

    const backlog = Number(main.backlog) || 0;
    const cleanFloorOngoing = Number(main.ongoing_delivery) || 0;
    const cleanFloorDelivered = Number(main.delivered) || 0;
    const cleanFloorFtd = Number(main.ftd) || 0;
    const cleanFloorOthers = Number(main.others) || 0;
    const cleanFloorTodayVolume = justArrived + backlog;
    const cleanFloorNumerator = cleanFloorOngoing + cleanFloorDelivered + cleanFloorFtd + cleanFloorOthers;
    const cleanFloorValue = cleanFloorTodayVolume > 0
      ? (cleanFloorNumerator / cleanFloorTodayVolume) * 100
      : 0;
    const currentWibHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
    const lockedAt = `${todayDate}T01:00:00.000Z`;
    const snapshotKey = { facility: HUB_ID, date: todayDate };

    const formatLockedSnapshot = (snapshot: any) => ({
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
          delivered: cleanFloorDelivered, ongoing: cleanFloorOngoing,
          ftd: cleanFloorFtd, others: cleanFloorOthers,
          pending: Number(main.pending_at_hub) || 0,
          today_volume: cleanFloorTodayVolume, numerator: cleanFloorNumerator,
        },
        is_locked: false, locked_at: lockedAt,
        quality: "live" as const, captured_at: new Date().toISOString(),
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
      today_volume: cleanFloorTodayVolume,
      pending_at_hub: pendingAtHub,
      clean_floor: cleanFloor,
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
      fetched_at: new Date().toISOString(),
    };

    cache.set(cacheKey, { data: summary, timestamp: Date.now() });

    return NextResponse.json({
      success: true,
      meta: {
        cached: false,
        fetched_at: new Date().toISOString(),
        hub_id: HUB_ID,
        hub_name: HUB_NAME,
      },
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