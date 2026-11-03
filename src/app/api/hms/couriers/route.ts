import { auth } from "@/lib/auth";
import { resolveActiveHub, resolveHmsToken } from "@/lib/hms-context";
import { buildHmsHeaders } from "@/lib/hms-headers";
import { NextRequest, NextResponse } from "next/server";

// HMS "Last Mile - Driver Productivity (driver level)" dataset (OPC > Last Mile).
// It is the only HMS source that returns one row per courier with the packages
// they carried plus delivered / FTD splits per cycle, so the Ongoing Courier tab
// uses it instead of paging the shipments list (which only exposes shipments
// created today, i.e. never the ones already on the road).
const API_ID_DRIVER_LEVEL = "7591486857905554439";

const JOB_ROLES =
  '["Rider LM 2W - Mitra Prioritas","Ops LM - Mitra","Ops LM - Mitra Oncall","Rider LM 2W","Dedicated Rider LM 2W","Ops LM"]';

// Cycle 1 = fresh C1 (00:00-08:00 WIB). The SD < 12PM ratio only exists there.
const CYCLES = [
  { level: "1", startHour: 0, startMin: 0, endHour: 8, endMin: 0 },
  { level: "2", startHour: 8, startMin: 1, endHour: 14, endMin: 0 },
  { level: "3", startHour: 14, startMin: 1, endHour: 20, endMin: 0 },
];

export const maxDuration = 30;

type CacheEntry = { data: any; timestamp: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000;

type DriverStat = {
  name: string;
  jobRole: string;
  district: string;
  freshC1: number;
  c1Delivered: number;
  c1Ftd: number;
  picked: number;
  delivered: number;
  ftd: number;
  c1Before12: number;
};

function toWIB(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function wibUnix(hour: number, minute: number): number {
  const d = toWIB();
  return Math.floor(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute, 0) -
      7 * 60 * 60 * 1000) /
      1000
  );
}

// HMS enforces ~5 qps per api_id and answers 400/429 with "execced ... qps"
// when the OPC page and this route hit the same dataset at the same time.
async function callHMS(token: string, apiId: string, params: Record<string, any>) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 350 * attempt));
    }
    const res = await fetch(`${process.env.HMS_BASE_URL}/dc/v1/oneservice`, {
      method: "POST",
      headers: { ...buildHmsHeaders(token) },
      body: JSON.stringify({ api_id: apiId, params }),
      cache: "no-store",
    });
    if (!res.ok) {
      lastError = new Error(`HMS HTTP ${res.status}`);
      continue;
    }
    const json = await res.json();
    if (json.code === 200) return json;
    const message = json.data?.base_resp?.message || json.msg || "unknown";
    lastError = new Error(`HMS code ${json.code}: ${message}`);
    if (!/qps|limit|busy/i.test(message)) break;
  }
  throw lastError ?? new Error("HMS request failed");
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

  const drivers = new Map<string, DriverStat>();
  const cycleErrors: string[] = [];

  for (const cyc of CYCLES) {
    try {
      const res = await callHMS(hmsToken, API_ID_DRIVER_LEVEL, {
        hub_id: HUB_ID,
        driver_name: "",
        job_roles: JOB_ROLES,
        cycle_start_time: String(wibUnix(cyc.startHour, cyc.startMin)),
        cycle_end_time: String(wibUnix(cyc.endHour, cyc.endMin)),
        cycle_level: cyc.level,
      });

      const rows: any[] = JSON.parse(res.data?.data || "[]");
      const fields: { name: string }[] = res.data?.fields || [];
      const idx = (name: string) => fields.findIndex((f) => f.name === name);
      const iName = idx("driver_name");
      const iPicked = idx("total_picked");
      const iDelivered = idx("total_delivered");
      const iFtd = idx("total_ftd");
      const iBefore12 = idx("delivered_before_12");
      const iRole = idx("job_role");
      const iDistrict = idx("district");
      if (iName < 0) continue;

      for (const row of rows) {
        const name = String(row[iName] || "").trim();
        if (!name) continue;

        const picked = num(row[iPicked]);
        const delivered = num(row[iDelivered]);
        const ftd = num(row[iFtd]);

        const stat: DriverStat =
          drivers.get(name) || {
            name,
            jobRole: iRole >= 0 ? String(row[iRole] || "") : "",
            district: iDistrict >= 0 ? String(row[iDistrict] || "") : "",
            freshC1: 0,
            c1Delivered: 0,
            c1Ftd: 0,
            picked: 0,
            delivered: 0,
            ftd: 0,
            c1Before12: 0,
          };

        stat.picked += picked;
        stat.delivered += delivered;
        stat.ftd += ftd;
        if (cyc.level === "1") {
          stat.freshC1 += picked;
          stat.c1Delivered += delivered;
          stat.c1Ftd += ftd;
          stat.c1Before12 += iBefore12 >= 0 ? num(row[iBefore12]) : 0;
        }
        drivers.set(name, stat);
      }
    } catch (e: any) {
      cycleErrors.push(`cycle ${cyc.level}: ${e.message}`);
    }
  }

  // HMS can lag per-cycle for the cycle that is still running, so a courier with
  // carried packages and none of them delivered/FTD is counted as ongoing.
  const couriers = Array.from(drivers.values())
    .map((d) => ({
      name: d.name,
      jobRole: d.jobRole,
      district: d.district,
      freshC1: d.freshC1,
      c1Delivered: d.c1Delivered,
      c1Ftd: d.c1Ftd,
      sd12Pct:
        d.freshC1 > 0
          ? parseFloat(((d.c1Before12 / d.freshC1) * 100).toFixed(2))
          : 0,
      totalCarried: d.picked,
      delivered: d.delivered,
      totalFtd: d.ftd,
      ongoing: Math.max(d.picked - d.delivered - d.ftd, 0),
      deliveredPct:
        d.picked > 0
          ? parseFloat(((d.delivered / d.picked) * 100).toFixed(2))
          : 0,
    }))
    .sort((a, b) => b.totalCarried - a.totalCarried);

  const totalCarried = couriers.reduce((a, c) => a + c.totalCarried, 0);
  const c1Total = couriers.reduce((a, c) => a + c.freshC1, 0);
  const delivered = couriers.reduce((a, c) => a + c.delivered, 0);
  const totalFtd = couriers.reduce((a, c) => a + c.totalFtd, 0);
  const c1Before12Total = Array.from(drivers.values()).reduce(
    (a, d) => a + d.c1Before12,
    0
  );

  const payload = {
    hub: { id: HUB_ID, name: activeHub.name },
    meta: {
      cached: false,
      cycles: CYCLES.map((c) => c.level),
      cycle_errors: cycleErrors,
      fetched_at: new Date().toISOString(),
    },
    totals: {
      couriers: couriers.length,
      total_carried: totalCarried,
      fresh_c1: c1Total,
      fresh_c2: Math.max(totalCarried - c1Total, 0),
      delivered,
      total_ftd: totalFtd,
      sd_before_12:
        c1Total > 0
          ? parseFloat(((c1Before12Total / c1Total) * 100).toFixed(2))
          : 0,
      delivered_pct:
        totalCarried > 0
          ? parseFloat(((delivered / totalCarried) * 100).toFixed(2))
          : 0,
    },
    couriers,
  };

  cache.set(HUB_ID, { data: payload, timestamp: Date.now() });
  return NextResponse.json({ success: true, ...payload });
}
