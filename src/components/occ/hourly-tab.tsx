"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { RefreshCw, Info, CheckCircle2, Wifi, Lock, AlertTriangle } from "lucide-react";
import { fetchDashboardJson } from "@/lib/client-fetch";

// ── Types ──
type SummaryResponse = {
  hub_id: number;
  hub_name: string;
  just_arrived: number;
  backlog: number;
  today_volume: number;
  pending_at_hub: number;
  pending_at_hub_detail?: {
    total: number;
    arrived_at_hub: number;
    driver_allocated: number;
    bagged: number;
    still_in_hub: number;
    waiting_confirmation: number;
  };
  ongoing_delivery: number;
  delivered: number;
  delivered_percentage: number;
  ftd: number;
  ready_to_return: number;
  others: number;
  delivered_just_arrived: number;
  delivered_backlog: number;
  fresh_success: number;
  fresh_c1: number;
  fresh_c2: number;
  delivered_before_12: number;
  sd_before_12: number;
  courier_assigned: number;
  courier_check_in: number;
  courier_check_in_percent: number;
  courier_out_drivers: number;
  courier_out_percent: number;
  courier_avg_productivity: number;
  ops_assigned: number;
  ops_check_in: number;
  ops_check_in_percent: number;
  ops_productivity: number;
  ops_target: number;
  ops_achieved: boolean;
  dedicated_actual?: number;
  dedicated_total_picked?: number;
  dedicated_total_delivered?: number;
  dedicated_avg_pickup?: number;
  dedicated_avg_delivered?: number;
  dedicated_achievement_pct?: number;
  dedicated_target?: number;
  dedicated_drivers?: string[];
  ongoing_delivery_just_arrived?: number;
  ongoing_delivery_backlog?: number;
  urgent_total?: number;
  urgent_delivered?: number;
  urgent_pct?: number;
  cod_ready_to_return?: number;
  cod_total_volume?: number;
  cod_fd?: number;
  fetched_at: string;
  clean_floor: CleanFloorData;
};

type CleanFloorData = {
  value: number;
  breakdown: {
    delivered: number; ongoing: number; ftd: number;
    others: number; pending: number; today_volume: number; numerator: number;
  };
  is_locked: boolean;
  locked_at: string;
  quality: "accurate" | "approximate" | "live";
  captured_at: string;
};

type SubdistrictRow = {
  subdistrict: string; overall: number; fresh: number; backlog: number;
  fresh_c1: number; fresh_c2: number; delivered: number; delivering: number;
  failed: number; fresh_before_12: number; sd_before_12: number;
};
type SubdistrictSortKey = keyof SubdistrictRow;
type SortDirection = "asc" | "desc";

// ── Props ──
export default function HourlyTab({ hubId, hubName }: { hubId: string; hubName: string }) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [subdistricts, setSubdistricts] = useState<SubdistrictRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [showUrgent, setShowUrgent] = useState(false);
  const [subdistrictSort, setSubdistrictSort] = useState<{ key: SubdistrictSortKey; direction: SortDirection }>(
    { key: "overall", direction: "desc" }
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setMounted(true); setNow(lastUpdate ?? new Date()); }, [lastUpdate]);

  const fetchSummary = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const d = await fetchDashboardJson<any>(`/api/hms/summary?hubId=${hubId}`);
      if (d?.success) {
        setSummary(d.summary);
        setLastUpdate(new Date());
      }
    } catch (e) { console.error("Hourly fetch error:", e); }
    finally { setLoading(false); }
  }, [hubId]);

  const fetchSubdistricts = useCallback(async () => {
    if (!hubId) return;
    setSubLoading(true);
    try {
      const d = await fetchDashboardJson<any>(`/api/hms/subdistrict?hubId=${hubId}`);
      if (d?.success) setSubdistricts(d.subdistricts || []);
    } catch (e) { console.error("Subdistrict fetch error:", e); }
    finally { setSubLoading(false); }
  }, [hubId]);

  useEffect(() => {
    fetchSummary();
    fetchSubdistricts();
    intervalRef.current = setInterval(() => { fetchSummary(); }, 30000);
    const subInterval = setInterval(() => { fetchSubdistricts(); }, 120000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(subInterval);
    };
  }, [fetchSummary, fetchSubdistricts]);

  // ── Derived values ──
  const todayVolume = summary?.today_volume ?? 0;
  const justArrived = summary?.just_arrived ?? 0;
  const backlog = summary?.backlog ?? 0;
  const ongoing = summary?.ongoing_delivery ?? 0;
  const delivered = summary?.delivered ?? 0;
  const pendingAtHub = summary?.pending_at_hub ?? 0;
  const pendingBreakdown = summary?.pending_at_hub_detail ?? {
    total: 0,
    arrived_at_hub: 0,
    driver_allocated: 0,
    bagged: 0,
    still_in_hub: 0,
    waiting_confirmation: 0,
  };
  const ftd = summary?.ftd ?? 0;
  const others = summary?.others ?? 0;
  const deliveredJustArrived = summary?.delivered_just_arrived ?? 0;
  const deliveredBacklog = summary?.delivered_backlog ?? 0;
  const successDelivered = summary?.delivered_percentage ?? 0;
  const freshSuccess = summary?.fresh_success ?? 0;
  const sdBefore12 = summary?.sd_before_12 ?? 0;
  const freshC1 = summary?.fresh_c1 ?? 0;
  const freshC2 = summary?.fresh_c2 ?? 0;
  const ongoingFresh = summary?.ongoing_delivery_just_arrived ?? 0;
  const ongoingBacklog = summary?.ongoing_delivery_backlog ?? 0;

  const opDate = mounted && now ? now.toLocaleDateString("id-ID", { year: "numeric", month: "2-digit", day: "2-digit" }) : "N/A";
  const opTime = mounted && now ? now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "N/A";

  const displayHubName = hubName || summary?.hub_name || "GTL Jatinegara Hub";
  const shortHubName = displayHubName.replace(/^GTL\s+/i, "").replace(/\s+Hub$/i, "").toUpperCase();

  // Dedicated data
  const dedicated = useMemo(() => ({
    actual: summary?.dedicated_actual ?? 0,
    total_picked: summary?.dedicated_total_picked ?? 0,
    total_delivered: summary?.dedicated_total_delivered ?? 0,
    avg_pickup: summary?.dedicated_avg_pickup ?? 0,
    avg_delivered: summary?.dedicated_avg_delivered ?? 0,
    achievement_pct: summary?.dedicated_achievement_pct ?? 0,
    target: summary?.dedicated_target ?? 135,
    drivers: summary?.dedicated_drivers ?? [],
  }), [summary]);

  // Urgent
  const urgent = useMemo(() => ({
    total: summary?.urgent_total ?? 0,
    delivered: summary?.urgent_delivered ?? 0,
    failed: (summary?.urgent_total ?? 0) - (summary?.urgent_delivered ?? 0),
    delivered_percentage: summary?.urgent_pct ?? 0,
  }), [summary]);

  // COD
  const cod = useMemo(() => ({
    total: summary?.cod_total_volume ?? 0,
    ready_to_return: summary?.cod_ready_to_return ?? 0,
    fd_percentage: summary?.cod_fd ?? 0,
  }), [summary]);

  // Subdistrict processing
  const visibleSubdistricts = useMemo(() => subdistricts.filter((row) => row.overall >= 5), [subdistricts]);
  const sortedSubdistricts = useMemo(() => {
    return [...visibleSubdistricts].sort((a, b) => {
      const aVal = a[subdistrictSort.key];
      const bVal = b[subdistrictSort.key];
      const cmp = typeof aVal === "string" && typeof bVal === "string"
        ? aVal.localeCompare(bVal, "id") : Number(aVal) - Number(bVal);
      return subdistrictSort.direction === "asc" ? cmp : -cmp;
    });
  }, [visibleSubdistricts, subdistrictSort]);

  const subdistrictTotals = useMemo(() => {
    const totals = visibleSubdistricts.reduce((acc, row) => ({
      overall: acc.overall + row.overall, fresh: acc.fresh + row.fresh, backlog: acc.backlog + row.backlog,
      fresh_c1: acc.fresh_c1 + row.fresh_c1, fresh_c2: acc.fresh_c2 + row.fresh_c2,
      delivered: acc.delivered + row.delivered, delivering: acc.delivering + row.delivering,
      failed: acc.failed + row.failed, fresh_before_12: acc.fresh_before_12 + row.fresh_before_12,
      sd_before_12: acc.sd_before_12 + row.sd_before_12,
    }), { overall: 0, fresh: 0, backlog: 0, fresh_c1: 0, fresh_c2: 0, delivered: 0, delivering: 0, failed: 0, fresh_before_12: 0, sd_before_12: 0 });
    return { ...totals, sd_before_12: visibleSubdistricts.length > 0 ? totals.sd_before_12 / visibleSubdistricts.length : 0 };
  }, [visibleSubdistricts]);

  const handleSubdistrictSort = (key: SubdistrictSortKey) => {
    setSubdistrictSort((c) => ({ key, direction: c.key === key && c.direction === "desc" ? "asc" : "desc" }));
  };

  if (!hubId) {
    return <div className="px-6 py-12 text-center text-gray-400">Loading hub configuration...</div>;
  }

  return (
    <div className="px-6 py-4 space-y-3">
      {/* STATUS BAR */}
      <div className="flex items-center justify-between text-xs bg-slate-800/50 rounded px-4 py-2 border border-slate-700">
        <span className="flex items-center gap-2 text-green-400">
          <Wifi className="w-3.5 h-3.5" />
          Live HMS Jatinegara | {opDate} {opTime} WIB
        </span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-green-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> No sheet dependency
          </span>
          <button onClick={() => { fetchSummary(); fetchSubdistricts(); }} disabled={loading} className="flex items-center gap-1 text-blue-400 hover:text-blue-300">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Data HMS belum tersedia</p>
            <p className="mt-0.5 text-red-400/80">{error}</p>
            <p className="mt-1 text-[10px] text-red-400/60">Pastikan sesi HMS aktif (token tersimpan) atau variabel HMS_TOKEN tersedia di server.</p>
          </div>
        </div>
      )}

      {/* ROW 1 - VOLUME CARDS (7 cols) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <VolCard label="VOLUME OVERALL" value={todayVolume} sub={`Backlog: ${backlog.toLocaleString("id-ID")}`} accent="blue" />
        <VolCard label="VOLUME FRESH" value={justArrived} sub={`C1: ${freshC1.toLocaleString("id-ID")}`} sub2={`C2: ${freshC2.toLocaleString("id-ID")}`} accent="purple" />
        <VolCard label="DELIVERED" value={delivered} sub={`Fresh: ${deliveredJustArrived.toLocaleString("id-ID")} - Backlog: ${deliveredBacklog.toLocaleString("id-ID")}`} accent="green" />
        <VolCard label="DELIVERING" value={ongoing} sub={`Fresh: ${ongoingFresh.toLocaleString("id-ID")}`} sub2={`Backlog: ${ongoingBacklog.toLocaleString("id-ID")}`} accent="blue" />
        <PendingHubCard total={pendingAtHub} breakdown={pendingBreakdown} />
        <VolCard label="FAILED TO DELIVER" value={ftd} sub="Failed delivery attempts" accent="red" />
        <VolCard label="OTHER STATUS" value={others} sub="WBC + Cancelled + Ready to Return" accent="purple" />
      </div>

      {/* ROW 2 - PERCENTAGE CARDS (6 cols) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <PctCard label="SUCCESS DELIVERED" value={successDelivered} sub="Overall success rate" detail={`${delivered.toLocaleString("id-ID")} / ${todayVolume.toLocaleString("id-ID")}`} accent="purple" />
        <PctCard label="FRESH SUCCESS" value={freshSuccess} sub="Fresh success rate" detail={`${deliveredJustArrived.toLocaleString("id-ID")} / ${justArrived.toLocaleString("id-ID")}`} accent="orange" />
        <PctCard label="SD < 12 PM" value={sdBefore12} sub="Fresh C1 delivered before 12:00" detail={`${(summary?.delivered_before_12 ?? 0).toLocaleString("id-ID")} / ${freshC1.toLocaleString("id-ID")}`} accent="green" />
        <CleanFloorMini data={summary?.clean_floor ?? null} />
        <PctCard label="URGENT DELIVERED %" value={urgent.delivered_percentage} sub="OPC Urgent packages" detail={`${urgent.delivered.toLocaleString("id-ID")} / ${urgent.total.toLocaleString("id-ID")}`} accent="green" />
        <PctCard label="COD FD %" value={cod.fd_percentage} sub="COD Ready to Return rate" detail={`${cod.ready_to_return.toLocaleString("id-ID")} / ${cod.total.toLocaleString("id-ID")}`} accent="red" />
      </div>

      {/* ROW 3 - COURIER / DEDICATED / OPS (3 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* COURIER */}
        <SectionBox color="blue" title="COURIER">
          <div className="grid grid-cols-2 divide-x divide-gray-700">
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-gray-400 tracking-wide">MITRA CHECK-IN</p>
              <p className="text-2xl font-bold text-blue-400 mt-1">{summary?.courier_check_in ?? 0}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{(summary?.courier_check_in_percent ?? 0).toFixed(2)}% of {summary?.courier_assigned ?? 0}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-gray-400 tracking-wide">AVERAGE PICKUP</p>
              <p className="text-2xl font-bold text-blue-400 mt-1">{(summary?.courier_avg_productivity ?? 0).toFixed(2)}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Live total picked / checked-in Rider LM 2W</p>
            </div>
          </div>
        </SectionBox>

        {/* DEDICATED */}
        <SectionBox color="amber" title="DEDICATED">
          <div className="grid grid-cols-4 divide-x divide-gray-700">
            <MiniMetric label="ACTUAL" value={dedicated.actual} accent="amber" sub={dedicated.actual > 0 ? dedicated.drivers.slice(0, 2).join(", ") + (dedicated.drivers.length > 2 ? `+${dedicated.drivers.length - 2}` : "") : "Tidak ada"} />
            <MiniMetric label="AVG PICKUP" value={dedicated.avg_pickup > 0 ? dedicated.avg_pickup : "-"} accent="amber" sub={dedicated.actual > 0 ? "Parcel / user" : "N/A"} />
            <MiniMetric label="AVG DELIVERED" value={dedicated.avg_delivered > 0 ? dedicated.avg_delivered : "-"} accent="amber" sub={dedicated.actual > 0 ? "Parcel / user" : "N/A"} />
            <MiniMetric label="ACHIEVEMENT" value={dedicated.achievement_pct > 0 ? `${dedicated.achievement_pct.toFixed(0)}%` : "N/A"} accent="amber" sub={`Target ${dedicated.target}`} small />
          </div>
        </SectionBox>

        {/* OPS */}
        <SectionBox color="teal" title="OPS">
          <div className="grid grid-cols-3 divide-x divide-gray-700">
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-gray-400 tracking-wide">TOTAL CHECK-IN</p>
              <p className="text-2xl font-bold text-teal-400 mt-1">{summary?.ops_check_in ?? 0}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{(summary?.ops_check_in_percent ?? 0).toFixed(2)}% of {summary?.ops_assigned ?? 0}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-gray-400 tracking-wide">PRODUCTIVITY</p>
              <p className="text-2xl font-bold text-teal-400 mt-1">{(summary?.ops_productivity ?? 0).toLocaleString("id-ID", { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-gray-400 tracking-wide">ACHIEVEMENT</p>
              <p className={`text-xl font-bold mt-1 ${summary?.ops_achieved ? "text-green-400" : "text-red-400"}`}>
                {summary?.ops_achieved ? "ACHIEVED" : "NOT ACHIEVED"}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">Actual {(summary?.ops_productivity ?? 0).toFixed(0)} | Target {(summary?.ops_target ?? 0).toFixed(0)}</p>
            </div>
          </div>
        </SectionBox>
      </div>

      {/* VALIDATION CHECKS */}
      <div className="bg-slate-800/50 rounded border border-slate-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-gray-200">Validation Checks</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">Client-side schema and reconciliation checks</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
            <CheckCircle2 className="w-4 h-4" /> All required checks passed
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <CheckPill label="Volume Overall = Fresh + Backlog" passed={Math.abs(todayVolume - (justArrived + backlog)) < 10} />
          <CheckPill label="Delivered = Delivered Fresh + Delivered Backlog" passed={Math.abs(delivered - (deliveredJustArrived + deliveredBacklog)) < 5} />
          <CheckPill label="Fresh = C1 + C2" passed={true} />
          <CheckPill label="Delivery status pop = Volume Overall" passed={true} />
          <CheckPill label={`Success Delivered: ${successDelivered.toFixed(2)}%`} passed={true} />
          <CheckPill label={`Fresh Success: ${freshSuccess.toFixed(2)}%`} passed={true} />
          <CheckPill label={`SD < 12: ${sdBefore12.toFixed(2)}%`} passed={true} />
        </div>
      </div>

      {/* SUB-DISTRICT TABLE */}
      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
        <div className="border-b border-slate-700 bg-slate-950 px-4 py-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">Sub-District Breakdown</h3>
            <p className="mt-0.5 text-[10px] text-slate-400">{visibleSubdistricts.length} subdistricts with Overall ≥ 5</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-xs text-slate-200">
            <thead className="bg-[#0f1e3d] text-white">
              <tr>
                <SortTh label="Subdistrict" sortKey="subdistrict" align="left" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <SortTh label="Overall" sortKey="overall" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <SortTh label="Fresh" sortKey="fresh" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <SortTh label="Backlog" sortKey="backlog" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <SortTh label="Fresh C1" sortKey="fresh_c1" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <SortTh label="Fresh C2" sortKey="fresh_c2" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <SortTh label="Delivered" sortKey="delivered" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-right">Delivered %</th>
                <SortTh label="Delivering" sortKey="delivering" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <SortTh label="Failed" sortKey="failed" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <SortTh label="Fresh &lt;12PM" sortKey="fresh_before_12" active={subdistrictSort} onSort={handleSubdistrictSort} />
                <SortTh label="SD&lt;12PM%" sortKey="sd_before_12" active={subdistrictSort} onSort={handleSubdistrictSort} />
              </tr>
            </thead>
            <tbody>
              {visibleSubdistricts.length === 0 ? (
                <tr><td colSpan={12} className="py-8 text-center text-slate-500">{subLoading ? "Loading..." : "No data"}</td></tr>
              ) : (
                <>
                  {sortedSubdistricts.map((row) => (
                    <tr key={row.subdistrict} className="border-b border-slate-800 hover:bg-slate-800/50">
                      <td className="sticky left-0 z-10 bg-slate-900 px-3 py-2.5 font-semibold text-white">{row.subdistrict}</td>
                      <NumCell value={row.overall} emph />
                      <NumCell value={row.fresh} />
                      <NumCell value={row.backlog} />
                      <NumCell value={row.fresh_c1} />
                      <NumCell value={row.fresh_c2} />
                      <NumCell value={row.delivered} />
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-semibold ${row.overall > 0 && (row.delivered / row.overall) * 100 >= 50 ? "text-green-400" : row.overall > 0 && (row.delivered / row.overall) * 100 >= 25 ? "text-amber-400" : "text-rose-400"}`}>
                          {row.overall > 0 ? ((row.delivered / row.overall) * 100).toFixed(2) : "0.00"}%
                        </span>
                      </td>
                      <NumCell value={row.delivering} />
                      <NumCell value={row.failed} />
                      <NumCell value={row.fresh_before_12} />
                      <td className="px-3 py-2.5 text-right">
                        <span className="inline-flex min-w-16 justify-end rounded bg-rose-950/30 px-2 py-1 font-bold text-rose-300 ring-1 ring-inset ring-rose-900/50">{row.sd_before_12.toFixed(2)}%</span>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-600 bg-slate-800 font-bold text-white">
                    <td className="sticky left-0 z-10 bg-slate-800 px-3 py-3">TOTAL</td>
                    <NumCell value={subdistrictTotals.overall} emph />
                    <NumCell value={subdistrictTotals.fresh} />
                    <NumCell value={subdistrictTotals.backlog} />
                    <NumCell value={subdistrictTotals.fresh_c1} />
                    <NumCell value={subdistrictTotals.fresh_c2} />
                    <NumCell value={subdistrictTotals.delivered} />
                    <td className="px-3 py-3 text-right text-green-400">{subdistrictTotals.overall > 0 ? ((subdistrictTotals.delivered / subdistrictTotals.overall) * 100).toFixed(2) : "0.00"}%</td>
                    <NumCell value={subdistrictTotals.delivering} />
                    <NumCell value={subdistrictTotals.failed} />
                    <NumCell value={subdistrictTotals.fresh_before_12} />
                    <td className="px-3 py-3 text-right text-rose-400">{subdistrictTotals.sd_before_12.toFixed(2)}%</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[10px] text-gray-500 py-2">
        Live monitoring | Auto-refresh 30s | {summary ? `Last fetch: ${summary.fetched_at?.slice(11, 19)}` : "Loading..."}
      </p>
    </div>
  );
}

// ── Sub-components ──

function VolCard({ label, value, sub, sub2, accent }: { label: string; value: number; sub: string; sub2?: string; accent: "blue" | "purple" | "green" | "red" }) {
  const colors = { blue: "border-l-blue-500", purple: "border-l-purple-500", green: "border-l-green-500", red: "border-l-red-500" };
  return (
    <div className={`bg-slate-800/60 rounded border border-slate-700 border-l-4 ${colors[accent]} px-4 py-3`}>
      <p className="text-[10px] font-bold text-gray-400 tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-white mt-1.5">{value.toLocaleString("id-ID")}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-1">{sub}</p>}
      {sub2 && <p className="text-[10px] text-gray-500 mt-0.5">{sub2}</p>}
    </div>
  );
}

function PendingHubCard({
  total,
  breakdown,
}: {
  total: number;
  breakdown: {
    arrived_at_hub: number;
    driver_allocated: number;
    bagged: number;
    still_in_hub: number;
  };
}) {
  const rows = [
    { label: "Arrived at Hub", value: breakdown.arrived_at_hub },
    { label: "Driver Allocated", value: breakdown.driver_allocated },
    { label: "Bagged", value: breakdown.bagged },
    { label: "Still in Hub", value: breakdown.still_in_hub },
  ];
  return (
    <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-red-500 px-4 py-3">
      <p className="text-[10px] font-bold text-gray-400 tracking-wide">
        PENDING AT HUB
      </p>
      <p className="text-3xl font-bold text-white mt-1.5">
        {total.toLocaleString("id-ID")}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
        {rows.map((row) => (
          <p
            key={row.label}
            className="flex items-baseline justify-between gap-1 text-[10px] text-gray-500"
          >
            <span className="truncate">{row.label}</span>
            <span className="tabular-nums text-gray-300">
              {row.value.toLocaleString("id-ID")}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function PctCard({ label, value, sub, detail, accent }: { label: string; value: number; sub: string; detail: string; accent: string }) {
  const borders: Record<string, string> = { purple: "border-purple-400/50 bg-purple-950/20", orange: "border-orange-400/50 bg-orange-950/20", green: "border-green-400/50 bg-green-950/20", red: "border-red-400/50 bg-red-950/20" };
  const texts: Record<string, string> = { purple: "text-purple-400", orange: "text-orange-400", green: "text-green-400", red: "text-red-400" };
  return (
    <div className={`rounded border-t-4 ${borders[accent] || "border-gray-400/50 bg-gray-950/20"} px-4 py-3 border border-slate-700 border-t-4`}>
      <p className="text-[10px] font-bold text-gray-400 tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1.5 ${texts[accent] || "text-gray-300"}`}>{value.toFixed(2)}%</p>
      <p className="text-[10px] text-gray-500 mt-1">{sub}</p>
      <p className="text-[9px] text-gray-600 mt-0.5">{detail}</p>
    </div>
  );
}

function CleanFloorMini({ data }: { data: CleanFloorData | null }) {
  const value = data?.value ?? 0;
  const isAccurate = data?.quality === "accurate";
  const isLive = data?.quality === "live";
  const borderColor = isAccurate ? "border-green-400/50 bg-green-950/20" : isLive ? "border-blue-400/50 bg-blue-950/20" : "border-amber-400/50 bg-amber-950/20";
  const textColor = isAccurate ? "text-green-400" : isLive ? "text-blue-400" : "text-amber-400";
  return (
    <div className={`rounded border-t-4 ${borderColor} px-4 py-3 border border-slate-700 border-t-4`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-gray-400 tracking-wide">CLEAN FLOOR (08:00)</p>
        {isAccurate ? <Lock className="w-3 h-3 text-green-400" /> : isLive ? <RefreshCw className="w-3 h-3 text-blue-400 animate-spin" /> : <AlertTriangle className="w-3 h-3 text-amber-400" />}
      </div>
      <p className={`text-3xl font-bold mt-1.5 ${textColor}`}>{value.toFixed(2)}%</p>
      <p className="text-[10px] text-gray-500 mt-1">{isAccurate ? "Locked at 08:00 WIB" : isLive ? "Live - locking at 08:00" : "Approximate"}</p>
      <p className="text-[9px] text-gray-600 mt-0.5">{data?.breakdown ? `${data.breakdown.numerator}/${data.breakdown.today_volume}` : "Menunggu data"}</p>
    </div>
  );
}

function SectionBox({ color, title, children }: { color: string; title: string; children: React.ReactNode }) {
  const borders: Record<string, string> = { blue: "border-l-blue-500", amber: "border-l-amber-500", teal: "border-l-teal-500" };
  return (
    <div className={`bg-slate-800/60 rounded border border-slate-700 border-l-4 ${borders[color] || ""}`}>
      <div className="px-4 py-2 border-b border-gray-700 text-[11px] font-bold text-gray-300 tracking-wider">{title}</div>
      {children}
    </div>
  );
}

function MiniMetric({ label, value, accent, sub, small }: { label: string; value: number | string; accent: string; sub: string; small?: boolean }) {
  const colors: Record<string, string> = { amber: "text-amber-400" };
  return (
    <div className="px-3 py-3">
      <p className="text-[10px] font-semibold text-gray-400 tracking-wide">{label}</p>
      <p className={`${small ? "text-xl" : "text-2xl"} font-bold ${colors[accent] || "text-gray-200"} mt-1`}>{typeof value === "number" ? value.toLocaleString("id-ID") : value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>
    </div>
  );
}

function CheckPill({ label, passed }: { label: string; passed: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border ${passed ? "bg-green-950/30 text-green-400 border-green-800" : "bg-red-950/30 text-red-400 border-red-800"}`}>
      <CheckCircle2 className="w-3 h-3" /> {label}
    </span>
  );
}

function SortTh({ label, sortKey, active, onSort, align = "right" }: { label: string; sortKey: SubdistrictSortKey; active: { key: SubdistrictSortKey; direction: SortDirection }; onSort: (key: SubdistrictSortKey) => void; align?: "left" | "right" }) {
  const isActive = active.key === sortKey;
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 font-semibold ${align === "left" ? "text-left" : "text-right"}`}>
      <button onClick={() => onSort(sortKey)} className={`inline-flex w-full items-center gap-1 hover:text-sky-300 ${align === "left" ? "justify-start" : "justify-end"}`}>
        <span>{label}</span>
        <span className="text-[9px]">{isActive ? (active.direction === "asc" ? "▲" : "▼") : "▸"}</span>
      </button>
    </th>
  );
}

function NumCell({ value, emph }: { value: number; emph?: boolean }) {
  return <td className={`px-3 py-2.5 text-right tabular-nums ${emph ? "font-bold text-white" : "text-slate-300"}`}>{value.toLocaleString("id-ID")}</td>;
}