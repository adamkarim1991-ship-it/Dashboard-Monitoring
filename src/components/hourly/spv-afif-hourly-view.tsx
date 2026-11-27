"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  LogOut,
  Wifi,
  CheckCircle2,
  Info,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { fetchDashboardJson } from "@/lib/client-fetch";
import { SUMMARY_POLL_INTERVAL_MS, SUMMARY_TICK_MS } from "@/lib/constants";
import type { SessionUser } from "@/components/dashboard/dashboard-view";
import { SPV_AFIF_HUBS, type SpvAfifHubConfig } from "@/lib/spv-afif-hubs";

/* ---------- Types ---------- */

type SummaryPayload = {
  hub_id?: number | string;
  hub_name?: string;
  today_volume?: number;
  just_arrived?: number;
  backlog?: number;
  delivered?: number;
  delivered_percentage?: number;
  ongoing_delivery?: number;
  ftd?: number;
  ready_to_return?: number;
  others?: number;
  fresh_c1?: number;
  fresh_c2?: number;
  fresh_success?: number;
  delivered_just_arrived?: number;
  delivered_backlog?: number;
  delivered_before_12?: number;
  sd_before_12?: number;
  sd_before_12_quality?: string;
  sd_before_12_captured_at?: string | null;
  clean_floor_c1?: {
    value?: number;
    numerator?: number;
    denominator?: number;
    quality?: string;
    captured_at?: string | null;
  };
  clean_floor?: {
    value?: number;
    numerator?: number;
    denominator?: number;
  };
  pending_at_hub?: number;
  pending_48h_pct?: number;
  pending_48h_total?: number;
  pending_48h_attempt_zero?: number;
  pending_48h_attempt_one?: number;
  pending_48h_attempt_more?: number;
  pending_48h_volume?: number;
  cod_total_volume?: number;
  cod_fd?: number;
  cod_ftd?: number;
  cod_rtr?: number;
  cod_delivered?: number;
  urgent_total?: number;
  urgent_delivered?: number;
  urgent_pct?: number;
  urgent_ftd?: number;
  urgent_ongoing?: number;
  dedicated_actual?: number;
  dedicated_total_picked?: number;
  dedicated_total_delivered?: number;
  dedicated_avg_pickup?: number;
  dedicated_avg_delivered?: number;
  dedicated_achievement_pct?: number;
  dedicated_target?: number;
  dedicated_drivers?: string[];
  ops_assigned?: number;
  ops_check_in?: number;
  ops_check_in_percent?: number;
  ops_productivity?: number;
  ops_target?: number;
  ops_achieved?: boolean;
  courier_assigned?: number;
  courier_check_in?: number;
  courier_check_in_percent?: number;
  courier_avg_productivity?: number;
  fetched_at?: string;
};

type HubSummaryState = {
  hub: SpvAfifHubConfig;
  loading: boolean;
  error?: string | null;
  data?: SummaryPayload;
};

/* ---------- Helpers ---------- */

const WIB_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const WIB_DATE_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const WIB_TIME_SHORT = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function readNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(value: unknown): string {
  const n = readNumber(value);
  if (n === null) return "-";
  return n.toLocaleString("en-US");
}

function fmtPct(value: unknown): string {
  const n = readNumber(value);
  if (n === null) return "-";
  return `${n.toFixed(2)}%`;
}

function wibTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return WIB_TIME_SHORT.format(date);
}

function lockText(quality?: string, capturedAt?: string | null): string {
  if (!quality) return "waiting";
  const time = wibTime(capturedAt);
  return `${quality} - ${time ? `${time} WIB` : "not locked"}`;
}

function unwrapSummary(payload: any): SummaryPayload {
  return payload?.summary ?? payload;
}

async function fetchHubSummary(hub: SpvAfifHubConfig): Promise<HubSummaryState> {
  try {
    const response = await fetchDashboardJson<any>(`/api/hms/summary?hubId=${hub.hmsHubId}`);
    if (!response?.success || !response?.summary) {
      const message = response?.message || response?.detail || response?.error || "HMS summary returned no data";
      throw new Error(String(message));
    }
    return { hub, loading: false, data: unwrapSummary(response), error: null };
  } catch (error: any) {
    return {
      hub,
      loading: false,
      error: error?.message || "Failed to load HMS summary",
    };
  }
}

/* ---------- Main Component ---------- */

export default function SpvAfifHourlyView({ user: _user }: { user: SessionUser }) {
  const [states, setStates] = useState<HubSummaryState[]>(() =>
    SPV_AFIF_HUBS.map((hub) => ({ hub, loading: true }))
  );
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const requestIdRef = useRef(0);

  const loadAll = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setRefreshing(true);
    setStates((prev) => prev.map((item) => ({ ...item, loading: true, error: null })));

    const results: HubSummaryState[] = [];
    for (let i = 0; i < SPV_AFIF_HUBS.length; i += 3) {
      const batch = SPV_AFIF_HUBS.slice(i, i + 3);
      results.push(...(await Promise.all(batch.map(fetchHubSummary))));
      if (requestIdRef.current !== requestId) return;
    }

    setStates(results);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadAll();
    const timer = window.setInterval(loadAll, SUMMARY_POLL_INTERVAL_MS);
    const tickTimer = window.setInterval(() => setNow(Date.now()), SUMMARY_TICK_MS);
    return () => {
      requestIdRef.current += 1;
      window.clearInterval(timer);
      window.clearInterval(tickTimer);
    };
  }, [loadAll]);

  const opDate = WIB_DATE_FORMATTER.format(now);
  const opTime = WIB_FORMATTER.format(now);

  /* Aggregate totals */
  const totals = useMemo(() => {
    return states.reduce(
      (acc, item) => {
        const d = item.data;
        if (!d || item.error) return acc;
        const vol = readNumber(d.today_volume);
        const del = readNumber(d.delivered);
        const ongoing = readNumber(d.ongoing_delivery);
        const ftd = readNumber(d.ftd);
        const success = readNumber(d.delivered_percentage);
        acc.loaded += 1;
        if (vol !== null) acc.volume += vol;
        if (del !== null) acc.delivered += del;
        if (ongoing !== null) acc.ongoing += ongoing;
        if (ftd !== null) acc.ftd += ftd;
        if (success !== null) {
          acc.successSum += success;
          acc.successCount += 1;
        }
        return acc;
      },
      { loaded: 0, volume: 0, delivered: 0, ongoing: 0, ftd: 0, successSum: 0, successCount: 0 }
    );
  }, [states]);

  const avgSuccess = totals.successCount > 0 ? totals.successSum / totals.successCount : 0;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* HEADER */}
      <header className="bg-[#0f1e3d] text-white">
        <div className="w-full px-6 py-3 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold tracking-widest text-gray-400">OPERATIONS CONTROL</span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/40">
                <Wifi className="w-3 h-3" /> LIVE GTL/TMS
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight mt-1 text-white">COVERAGE - JABODETABEK EAST</h1>
            <p className="text-[11px] text-gray-300 mt-0.5">SPV: Afif Effendi | 9 hub coverage</p>
            <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5">
              <Info className="w-3 h-3 flex-shrink-0" />
              <span>Live observation at {opDate} {opTime} WIB</span>
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => loadAll()} disabled={refreshing} className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: "/login" })} className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white">
              <LogOut className="w-3.5 h-3.5 mr-1.5" /> Logout
            </Button>
          </div>
        </div>
      </header>

      {/* STATUS BAR */}
      <div className="bg-green-50 border-b border-green-200">
        <div className="w-full px-6 py-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 text-green-700">
            <Wifi className="w-3.5 h-3.5" /> Live GTL/TMS | secure local bridge | UI received at {opDate} {opTime} WIB
          </span>
          <span className="flex items-center gap-1 text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" /> No sheet dependency | {totals.loaded}/9 hubs loaded
          </span>
        </div>
      </div>

      <main className="w-full px-6 py-4 space-y-4">
        {/* SUMMARY CARDS - 5 columns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard label="TOTAL VOLUME" value={fmtNum(totals.volume)} accent="blue" icon={<Info className="w-3 h-3 text-gray-300" />} />
          <SummaryCard label="TOTAL DELIVERED" value={fmtNum(totals.delivered)} accent="green" icon={<Info className="w-3 h-3 text-gray-300" />} />
          <SummaryCard label="ONGOING" value={fmtNum(totals.ongoing)} accent="purple" icon={<Info className="w-3 h-3 text-gray-300" />} />
          <SummaryCard label="FTD" value={fmtNum(totals.ftd)} accent="red" icon={<Info className="w-3 h-3 text-gray-300" />} />
          <SummaryCard label="AVG SUCCESS" value={fmtPct(avgSuccess)} accent="teal" icon={<Info className="w-3 h-3 text-gray-300" />} />
        </div>

        {/* HUB SCORECARDS - 3 columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {states.map((item) => (
            <HubScorecard key={item.hub.slug} item={item} />
          ))}
        </div>

        <p className="text-center text-[10px] text-gray-400 py-2">
          Live monitoring | Auto-refresh every {Math.round(SUMMARY_POLL_INTERVAL_MS / 1000)}s |{" "}
          {totals.loaded > 0 ? `${totals.loaded} hubs active` : "Loading..."}
        </p>
      </main>
    </div>
  );
}

/* ---------- Summary Card ---------- */

function SummaryCard({ label, value, accent, icon }: { label: string; value: string; accent: "blue" | "green" | "purple" | "red" | "teal"; icon?: React.ReactNode }) {
  const accents = { blue: "border-l-blue-500", green: "border-l-green-500", purple: "border-l-purple-500", red: "border-l-red-500", teal: "border-l-teal-500" };
  const textColors = { blue: "text-blue-600", green: "text-green-600", purple: "text-purple-600", red: "text-red-600", teal: "text-teal-600" };
  return (
    <div className={`bg-white rounded shadow-sm border-l-4 ${accents[accent]} px-4 py-3`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-gray-500 tracking-wide">{label}</p>
        {icon}
      </div>
      <p className={`text-3xl font-bold mt-1.5 ${textColors[accent]}`}>{value}</p>
    </div>
  );
}

/* ---------- Hub Scorecard ---------- */

function HubScorecard({ item }: { item: HubSummaryState }) {
  const d = item.data;
  const clean = d?.clean_floor_c1;
  const fetchedTime = wibTime(d?.fetched_at);

  return (
    <div className="bg-white rounded-lg shadow-sm border-l-4 border-l-green-500 overflow-hidden">
      {/* Hub header */}
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-800">{item.hub.name}</h3>
          <p className="text-[9px] text-gray-400">HMS ID: {item.hub.hmsHubId} {fetchedTime ? `| Fetch: ${fetchedTime} WIB` : ""}</p>
        </div>
        {item.data?.fetched_at && (
          <FreshnessBadge fetchedAt={item.data.fetched_at} />
        )}
      </div>

      {item.error ? (
        <div className="px-4 py-6 text-center">
          <div className="flex items-center justify-center gap-2 font-semibold text-red-600 text-sm">
            <AlertTriangle className="w-4 h-4" /> Failed to load
          </div>
          <p className="mt-2 text-xs text-red-400">{item.error}</p>
        </div>
      ) : item.loading || !d ? (
        <div className="h-48 animate-pulse bg-gray-50" />
      ) : (
        <>
          {/* Two-column metrics */}
          <div className="grid grid-cols-2 divide-x divide-gray-100">
            {/* Left column */}
            <div className="px-4 py-3 space-y-2.5">
              <MetricRow label="Volume Overall" value={fmtNum(d.today_volume)} valueClass="text-gray-900" />
              <MetricRow label="Volume Fresh" value={fmtNum(d.just_arrived)} valueClass="text-purple-600" sub={d.fresh_c1 != null ? `C1: ${fmtNum(d.fresh_c1)} | C2: ${fmtNum(d.fresh_c2)}` : undefined} />
              <MetricRow label="Clean Floor" value={fmtPct(clean?.value)} valueClass="text-teal-600" sub={lockText(clean?.quality, clean?.captured_at)} />
              <MetricRow label="SD < 12 PM" value={fmtPct(d.sd_before_12)} valueClass="text-blue-600" sub={lockText(d?.sd_before_12_quality, d?.sd_before_12_captured_at)} />
              <MetricRow label="Fresh Success" value={fmtPct(d.fresh_success)} valueClass="text-green-600" />
              <MetricRow label="Success Delivered" value={fmtPct(d.delivered_percentage)} valueClass="text-purple-600" />
              <MetricRow label="Pending 48H" value={fmtPct(d.pending_48h_pct)} valueClass="text-orange-600" sub={d.pending_48h_total != null ? `${fmtNum(d.pending_48h_total)} / ${fmtNum(d.pending_48h_volume)}` : undefined} />
              <MetricRow label="COD FD" value={fmtPct(d.cod_fd)} valueClass="text-purple-600" sub={d.cod_total_volume != null ? `${fmtNum(d.cod_total_volume)} COD` : undefined} />
            </div>

            {/* Right column */}
            <div className="px-4 py-3 space-y-2.5">
              <MetricRow label="Delivered" value={fmtNum(d.delivered)} valueClass="text-gray-900" />
              <MetricRow label="Pending at Hub" value={fmtNum(d.pending_at_hub)} valueClass="text-orange-600" />
              <MetricRow label="FTD" value={fmtNum(d.ftd)} valueClass="text-red-600" />
              <MetricRow label="Urgent %" value={fmtPct(d.urgent_pct)} valueClass="text-red-600" />
              <MetricRow label="Dedicated Actual" value={fmtNum(d.dedicated_actual)} valueClass="text-amber-600" />
              <MetricRow label="Dedicated Avg Del" value={d.dedicated_avg_delivered != null && d.dedicated_avg_delivered > 0 ? d.dedicated_avg_delivered.toFixed(0) : "-"} valueClass="text-amber-600" />
              <MetricRow label="Prod Ops" value={d.ops_productivity != null ? d.ops_productivity.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "-"} valueClass="text-teal-600" sub={d.ops_check_in != null ? `${d.ops_check_in}/${d.ops_assigned ?? 0} check-in` : undefined} />
            </div>
          </div>

          {/* Bottom: Success Rate + Button */}
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <div>
              <p className="text-[10px] text-gray-500 tracking-wide">SUCCESS RATE</p>
              <p className="text-2xl font-bold text-green-600">{fmtPct(d.delivered_percentage)}</p>
            </div>
            <Link href={`/hourly/spv-afif/${item.hub.slug}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f1e3d] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#1a2f5a]">
              Open detail <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Metric Row ---------- */

function MetricRow({ label, value, valueClass, sub }: { label: string; value: string; valueClass?: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-gray-500 tracking-wide truncate">{label}</p>
        {sub && <p className="text-[9px] text-gray-400 truncate">{sub}</p>}
      </div>
      <p className={`text-sm font-bold tabular-nums text-right whitespace-nowrap ${valueClass || "text-gray-900"}`}>{value}</p>
    </div>
  );
}

/* ---------- Freshness Badge ---------- */

function FreshnessBadge({ fetchedAt }: { fetchedAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), SUMMARY_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const date = new Date(fetchedAt);
  if (isNaN(date.getTime())) return null;

  const ageMs = now - date.getTime();
  const isStale = ageMs > 300000; // 5 min
  const timeStr = WIB_TIME_SHORT.format(date);

  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-medium ${isStale ? "bg-red-50 text-red-600 border-red-200" : "bg-green-50 text-green-600 border-green-200"}`}>
      {isStale ? <AlertTriangle className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
      {timeStr} WIB
    </span>
  );
}
