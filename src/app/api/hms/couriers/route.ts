import { loadCurrentAssignments, mergeCurrentCounts, singleFlight, pruneTimedCache, type Assignment } from "@/lib/ongoing-assignment";
import { auth } from "@/lib/auth";
import { resolveActiveHub, resolveHmsToken } from "@/lib/hms-context";
import { buildHmsHeaders } from "@/lib/hms-headers";
import { NextRequest, NextResponse } from "next/server";

// Productivity supplies historical cycle metrics only; ongoing uses current shipment ownership.
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
const inFlight = new Map<string, Promise<{ status: number; body: any }>>();
const CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_ENTRIES = 64;

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
async function callHMS(token: string, apiId: string, params: Record<string, any>, signal: AbortSignal) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 350 * attempt));
    }
    const res = await fetch(`${process.env.HMS_BASE_URL}/dc/v1/oneservice`, {
      method: "POST",
      headers: { ...buildHmsHeaders(token) },
      body: JSON.stringify({ api_id: apiId, params }),
      signal,
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
  const dayStart = wibUnix(0, 0);
  const cacheKey = JSON.stringify([session.user.id, HUB_ID, dayStart]);
  pruneTimedCache(cache, Date.now(), CACHE_TTL_MS, CACHE_MAX_ENTRIES);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ success: true, ...cached.data, meta: { ...cached.data.meta, cached: true } });
  }

  const shared = await singleFlight(inFlight, cacheKey, async () => {
    const controller = new AbortController();
    const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]);
    try {
      const response = await (async () => {
        let assignment: Assignment;
        try {

          assignment = await loadCurrentAssignments(async (page) => {
            const url = new URL(`${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`);
            // HMS Ongoing UI uses today minus 90 days through today (verified network).
            // Include older-created packages still assigned today; productivity cycles remain today-only.
            const params = { type: "order_management", leg_type: "last_mile", tab: "order_view", per_page: "100", page: String(page), status: "picked,out_for_delivery", created_at_from: String(dayStart - 90 * 86400), created_at_to: String(dayStart + 86400 - 1) };
            for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
            const response = await fetch(url, { headers: buildHmsHeaders(hmsToken), cache: "no-store", signal: deadline });
            if (!response.ok) throw new Error(`Current shipment page ${page}: HTTP ${response.status}`);
            return response.json();
          }, String(HUB_ID));
          if (assignment.ambiguous || assignment.unassigned) return NextResponse.json({ success: false, error: "Current shipment ownership incomplete", meta: { complete: false, ongoing_source: "current_assignment", ambiguous_owners: assignment.ambiguous, unassigned_owners: assignment.unassigned } }, { status: 502 });
        } catch (error) {
          return NextResponse.json({ success: false, error: "Current assignments incomplete", detail: error instanceof Error ? error.message : "HMS failed", meta: { complete: false, ongoing_source: "current_assignment" } }, { status: 502 });
        }
        const drivers = new Map<string, DriverStat>();
        const cycleErrors: string[] = [];

        for (const cyc of CYCLES) {
          try {
            const res = await callHMS(hmsToken, API_ID_DRIVER_LEVEL, {
              hub_id: HUB_ID,
              driver_name: "",
              job_roles: JOB_ROLES,
              cycle_start_time: String(dayStart + cyc.startHour * 3600 + cyc.startMin * 60),
              cycle_end_time: String(dayStart + cyc.endHour * 3600 + cyc.endMin * 60),
              cycle_level: cyc.level,
            }, deadline);

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
            if ([iName, iPicked, iDelivered, iFtd].some(i => i < 0)) throw new Error("Productivity schema incomplete");

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

        let currentDrivers: (DriverStat & { ongoing: number })[];
        try {
          currentDrivers = mergeCurrentCounts(Array.from(drivers.values()), assignment, name => ({ name, jobRole: "", district: "", freshC1: 0, c1Delivered: 0, c1Ftd: 0, picked: 0, delivered: 0, ftd: 0, c1Before12: 0 }));
        } catch (error) {
          return NextResponse.json({ success: false, error: "Ambiguous courier identity", meta: { complete: false, ongoing_source: "current_assignment" } }, { status: 502 });
        }
        const couriers = currentDrivers
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
            ongoing: d.ongoing,
            productivityAvailable: drivers.has(d.name),
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
            complete: cycleErrors.length === 0,
            ongoing_source: "current_assignment",
            ongoing_owner_field: "assigned_drivers",
            ongoing_match_key: "normalized_driver_name",
            ongoing_cohort: "HMS_ongoing_UI_created_at_90_days",
            ongoing_created_at_from: dayStart - 90 * 86400,
            ongoing_created_at_to: dayStart + 86400 - 1,
            ongoing_pages: assignment.pages,
            ongoing_page_limit: 120,
            ongoing_page_concurrency: 3,
            upstream_deadline_ms: 25000,
            ongoing_hub_scope: "client_filter_hub_id_on_authenticated_HMS_list",
            ongoing_shipments: assignment.shipments,
            ongoing_unassigned: assignment.unassigned,
            ongoing_ambiguous: assignment.ambiguous,
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

        if (!cycleErrors.length) {
          cache.delete(cacheKey);
          cache.set(cacheKey, { data: payload, timestamp: Date.now() });
          pruneTimedCache(cache, Date.now(), CACHE_TTL_MS, CACHE_MAX_ENTRIES);
        }
        return NextResponse.json({ success: true, ...payload });
      })();
      return { status: response.status, body: await response.json() };
    } finally {
      controller.abort(); // Cancel remaining batch requests on any failure.
    }
  });
  return NextResponse.json(shared.body, { status: shared.status });
}
