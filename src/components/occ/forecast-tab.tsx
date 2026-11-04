"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle, Info } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchDashboardJson } from "@/lib/client-fetch";

// Fixed historical assumption for the top cards. The slider below is a planning
// knob that only drives "Target Delivered" / "Target FTD".
const HISTORICAL_RATE = 97;
const DEFAULT_C1_RATIO = 0.7;

type DayResult = {
  date: string;
  received: number;
  receivedHubWide: number;
  districtMatched: number;
  totalRecords?: number;
  hourly: number[];
  error?: string;
};

type FmResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  filters?: { legType: string; status: string; district: string; date: string };
  today?: DayResult;
  history?: DayResult[];
  avgHistory?: number | null;
};

type WeekDay = {
  date: string;
  label: string;
  received: number;
  receivedHubWide: number;
  totalRecords?: number;
  isToday: boolean;
  isFuture: boolean;
  error?: string;
};

type WeekResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  weekStart?: string;
  weekEnd?: string;
  week?: WeekDay[];
  ado?: number | null;
};

type HubSummary = {
  ftd?: number;
  ftd_total?: number;
  ready_to_return?: number;
  just_arrived?: number;
  backlog?: number;
  today_volume?: number;
  fresh_c1?: number;
  fresh_c2?: number;
};

type ChartRow = {
  label: string;
  date: string;
  volume: number;
  cumulative: number | null;
  isToday: boolean;
  isFuture: boolean;
  isAdo: boolean;
};

export default function ForecastTab({ hubId }: { hubId: string }) {
  const [data, setData] = useState<FmResponse | null>(null);
  const [week, setWeek] = useState<WeekDay[]>([]);
  const [weekAdo, setWeekAdo] = useState<number | null>(null);
  const [summary, setSummary] = useState<HubSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetRate, setTargetRate] = useState(HISTORICAL_RATE);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchDaily = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/hms/fm?hubId=${hubId}&district=jatinegara&countOnly=1`,
        { cache: "no-store" }
      );
      const d: FmResponse = await res.json();
      if (d.success && d.today) {
        setData(d);
        setError(null);
        setLastUpdate(new Date());
      } else {
        setError(d.message || d.error || `HMS error (HTTP ${res.status})`);
      }
    } catch {
      setError("Tidak dapat menghubungi server HMS.");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  const fetchWeek = useCallback(async () => {
    if (!hubId) return;
    try {
      const res = await fetch(
        `/api/hms/fm?hubId=${hubId}&range=week&district=jatinegara&countOnly=1`,
        { cache: "no-store" }
      );
      const d: WeekResponse = await res.json();
      if (d.success && Array.isArray(d.week)) {
        setWeek(d.week);
        setWeekAdo(d.ado ?? null);
      }
    } catch {
      // keep the previous weekly chart on transient failures
    }
  }, [hubId]);

  const fetchSummary = useCallback(async () => {
    if (!hubId) return;
    // The HMS summary endpoint is heavy and can answer 502 on a cold start, so
    // retry a couple of times before leaving the FTD cards empty.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const d = await fetchDashboardJson<any>(`/api/hms/summary?hubId=${hubId}`, 1, 1500);
      if (d?.success && d.summary) {
        setSummary(d.summary as HubSummary);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }, [hubId]);

  useEffect(() => {
    fetchDaily();
    fetchWeek();
    fetchSummary();

    const dailyTimer = setInterval(fetchDaily, 120000);
    const weekTimer = setInterval(fetchWeek, 300000);
    const summaryTimer = setInterval(fetchSummary, 60000);
    return () => {
      clearInterval(dailyTimer);
      clearInterval(weekTimer);
      clearInterval(summaryTimer);
    };
  }, [fetchDaily, fetchWeek, fetchSummary]);

  const received = data?.today?.received || 0;
  const avgHistory = data?.avgHistory ?? null;

  // ── top cards: driven by the actual HMS received volume only ──
  const freshEstimated = Math.round((received * HISTORICAL_RATE) / 100);
  const ftdInDriver = summary?.ftd ?? 0;
  const ftdReturned = summary?.ready_to_return ?? 0;
  const ftdTotal = summary?.ftd_total ?? 0;
  const backlog = ftdInDriver + ftdReturned > 0 ? ftdInDriver + ftdReturned : ftdTotal;
  const forecastVolume = freshEstimated + backlog;
  const backlogKnown = summary !== null;

  const justArrived = summary?.just_arrived ?? 0;
  const rawC1Ratio =
    justArrived > 0 && (summary?.fresh_c1 ?? 0) > 0
      ? (summary?.fresh_c1 ?? 0) / justArrived
      : DEFAULT_C1_RATIO;
  const c1Ratio = Math.min(Math.max(rawC1Ratio, 0.05), 0.95);
  const estC1 = Math.round(forecastVolume * c1Ratio);
  const estC2 = Math.max(forecastVolume - estC1, 0);

  // ── bottom row: the only numbers the slider is allowed to move ──
  const targetDelivered = Math.round((forecastVolume * targetRate) / 100);
  const targetFtd = Math.max(forecastVolume - targetDelivered, 0);

  const num = (value: number) => (backlogKnown ? value.toLocaleString("id-ID") : "—");

  const potentialGap = received - freshEstimated;
  const vsAvg = avgHistory && avgHistory > 0 ? ((received - avgHistory) / avgHistory) * 100 : null;
  const nowHour = Number(new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(11, 13));
  const remainingHours = Math.max(24 - nowHour, 0);
  const pacePerHour = nowHour > 0 ? received / nowHour : 0;
  const projectedEod = Math.round(received + pacePerHour * remainingHours);

  const chartRows: ChartRow[] = useMemo(() => {
    let acc = 0;
    const rows: ChartRow[] = week.map((d) => {
      const volume = d.isFuture ? 0 : d.received;
      acc += volume;
      return {
        label: d.label,
        date: d.date,
        volume,
        cumulative: d.isFuture ? null : acc,
        isToday: d.isToday,
        isFuture: d.isFuture,
        isAdo: false,
      };
    });

    const activeDays = rows.filter((r) => !r.isFuture);
    const fallbackAdo = activeDays.length
      ? Math.round(activeDays.reduce((sum, r) => sum + r.volume, 0) / activeDays.length)
      : 0;
    const ado = weekAdo ?? fallbackAdo;

    rows.push({
      label: "ADO",
      date: "",
      volume: ado,
      cumulative: null,
      isToday: false,
      isFuture: false,
      isAdo: true,
    });
    return rows;
  }, [week, weekAdo]);

  const adoValue = chartRows.length ? chartRows[chartRows.length - 1].volume : 0;
  const hasWeekData = week.some((d) => !d.isFuture);

  return (
    <div className="px-6 py-4 space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Data FM HMS belum tersedia</p>
            <p className="mt-0.5 text-red-400/80">{error}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="Leg type" value="Last Mile" />
        <FilterChip label="Status" value="Received" />
        <FilterChip label="District" value="Jatinegara" />
        <FilterChip label="Date" value={`${data?.filters?.date || "today"} (hari ini)`} />
        <button
          onClick={() => {
            fetchDaily();
            fetchWeek();
            fetchSummary();
          }}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MetricCard
          label="Volume Received"
          value={received.toLocaleString("id-ID")}
          sub="HMS · hari ini, status Received"
          accent="border-l-blue-500"
        />
        <MetricCard
          label="Backlog FTD"
          value={num(backlog)}
          sub={`In driver ${ftdInDriver.toLocaleString("id-ID")} · Returned hub ${ftdReturned.toLocaleString("id-ID")}`}
          accent="border-l-red-500"
        />
        <MetricCard
          label="Forecast Volume"
          value={num(forecastVolume)}
          sub="Fresh Estimated + Backlog"
          accent="border-l-cyan-400"
          emphasis
        />
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MetricCard
          label="Fresh Estimated"
          value={freshEstimated.toLocaleString("id-ID")}
          sub={`Received × ${HISTORICAL_RATE}%`}
          accent="border-l-green-500"
        />
        <MetricCard
          label="Estimated Volume C1"
          value={num(estC1)}
          sub={`Forecast × ${(c1Ratio * 100).toFixed(0)}%`}
          accent="border-l-violet-500"
        />
        <MetricCard
          label="Estimated Volume C2"
          value={num(estC2)}
          sub={`Forecast × ${(100 - c1Ratio * 100).toFixed(0)}%`}
          accent="border-l-yellow-500"
        />
      </div>

      {/* Chart + projection */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-lg border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs font-bold text-white">Volume Harian Minggu Ini</p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Sen–Sab · actual received per day + ADO (Average Daily Order)
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-gray-500">ADO</p>
              <p className="text-lg font-bold text-amber-400 tabular-nums">
                {adoValue.toLocaleString("id-ID")}
              </p>
            </div>
          </div>

          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={{ stroke: "#1e293b" }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="vol"
                  tick={{ fontSize: 9, fill: "#64748b" }}
                  width={40}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="cum"
                  orientation="right"
                  tick={{ fontSize: 9, fill: "#475569" }}
                  width={44}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", fontSize: 11 }}
                  labelStyle={{ color: "#e2e8f0" }}
                  formatter={(v: any, n: any) => [Number(v).toLocaleString("id-ID"), n]}
                />
                <Bar yAxisId="vol" dataKey="volume" name="Volume" radius={[3, 3, 0, 0]} maxBarSize={54}>
                  {chartRows.map((row) => (
                    <Cell
                      key={row.label}
                      fill={
                        row.isAdo
                          ? "#f59e0b"
                          : row.isToday
                          ? "#3b82f6"
                          : row.isFuture
                          ? "#1e293b"
                          : "#334155"
                      }
                    />
                  ))}
                </Bar>
                <Line
                  yAxisId="cum"
                  type="monotone"
                  dataKey="cumulative"
                  name="Kumulatif"
                  stroke="#22d3ee"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                />
                <Legend
                  wrapperStyle={{ fontSize: 10, color: "#94a3b8" }}
                  iconType="circle"
                  iconSize={7}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-2 text-[9px] text-gray-500">
            <LegendDot color="#3b82f6" label="Hari ini" />
            <LegendDot color="#334155" label="Hari sebelumnya" />
            <LegendDot color="#f59e0b" label="ADO" />
            <LegendDot color="#22d3ee" label="Kumulatif (sumbu kanan)" />
            {!hasWeekData && <span className="text-amber-500">Menunggu data minggu ini…</span>}
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-3">
          <p className="text-xs font-bold text-white">Proyeksi</p>
          <Row label="Received sampai jam ini" value={received.toLocaleString("id-ID")} />
          <Row label="Pace per jam" value={pacePerHour ? pacePerHour.toFixed(1) : "0"} />
          <Row label="Sisa jam operasional" value={`${remainingHours} jam`} />
          <Row label="Proyeksi EOD (pace)" value={projectedEod.toLocaleString("id-ID")} strong />
          <Row label={`Potensi gagal (${100 - HISTORICAL_RATE}%)`} value={potentialGap.toLocaleString("id-ID")} danger />
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <Row label="Fresh estimated" value={freshEstimated.toLocaleString("id-ID")} />
            <Row label="Backlog FTD" value={num(backlog)} />
            <Row label="Forecast volume" value={num(forecastVolume)} strong />
          </div>
          {vsAvg !== null && (
            <div className="pt-2 border-t border-slate-800">
              <Row
                label="vs rata-rata 3 hari"
                value={`${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(1)}%`}
                strong={vsAvg >= 0}
                danger={vsAvg < 0}
              />
            </div>
          )}
        </div>
      </div>

      {/* Delivery rate slider — full width, only drives the target cards */}
      <div className="rounded-lg border border-slate-700 border-l-4 border-l-purple-500 bg-slate-800/60 px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-white">Delivery Rate: {targetRate}%</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Fresh Estimated = Received × rate</p>
          </div>
          <p className="text-[10px] text-gray-500 max-w-md text-right leading-relaxed">
            Slider hanya mengubah <span className="text-blue-300">Target Delivered</span> dan{" "}
            <span className="text-red-300">Target FTD</span>. Kartu di atas memakai rate historis{" "}
            {HISTORICAL_RATE}% dari HMS.
          </p>
        </div>
        <input
          type="range"
          min={80}
          max={100}
          step={0.5}
          value={targetRate}
          onChange={(e) => setTargetRate(Number(e.target.value))}
          className="w-full mt-3 accent-purple-500"
        />
        <div className="flex justify-between text-[9px] text-gray-600 mt-1">
          <span>80%</span>
          <span>85%</span>
          <span>90%</span>
          <span>95%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Bottom row — target cards, only these move with the slider */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TargetCard
          label="Forecast Volume"
          value={num(forecastVolume)}
          sub="Static · Fresh Estimated + Backlog"
          tone="text-cyan-300"
        />
        <TargetCard
          label="Target Delivered"
          value={num(targetDelivered)}
          sub={`Forecast × ${targetRate}%`}
          tone="text-blue-300"
        />
        <TargetCard
          label="Target FTD"
          value={num(targetFtd)}
          sub={`Forecast × ${(100 - targetRate).toFixed(0)}%`}
          tone="text-red-300"
        />
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <p className="text-xs font-bold text-white">Volume Received Harian</p>
          <p className="text-[10px] text-gray-500">Jatinegara · 3 hari terakhir</p>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-[#0f1e3d] text-white">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold">Tanggal</th>
              <th className="px-4 py-2.5 text-right font-semibold">Received (Jatinegara)</th>
              <th className="px-4 py-2.5 text-right font-semibold">Hub-wide</th>
              <th className="px-4 py-2.5 text-right font-semibold">Fresh Estimated</th>
              <th className="px-4 py-2.5 text-right font-semibold">vs ADO</th>
            </tr>
          </thead>
          <tbody>
            {[...(data?.history || []), ...(data?.today ? [data.today] : [])].length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  {loading ? "Loading..." : "Belum ada data FM"}
                </td>
              </tr>
            ) : (
              [...(data?.history || []), ...(data?.today ? [data.today] : [])].map((d, i, arr) => {
                const diff = adoValue > 0 ? ((d.received - adoValue) / adoValue) * 100 : null;
                return (
                  <tr
                    key={d.date}
                    className={`border-b border-slate-800 ${
                      i === arr.length - 1 ? "bg-blue-950/20 font-semibold" : ""
                    }`}
                  >
                    <td className="px-4 py-2 text-white">
                      {d.date}
                      {i === arr.length - 1 && (
                        <span className="ml-2 text-[10px] text-blue-400">TODAY</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {d.received.toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-400">
                      {(d.receivedHubWide ?? d.received).toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-400">
                      {Math.round((d.received * HISTORICAL_RATE) / 100).toLocaleString("id-ID")}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        diff === null ? "text-gray-500" : diff >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {diff === null ? "-" : `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 rounded border border-slate-700 bg-slate-800/40 px-4 py-3 text-[10px] text-gray-400">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-blue-400" />
        <div className="space-y-1">
          <p>
            Sumber: HMS FM Volume = Last Mile · Status{" "}
            <span className="text-gray-200">Received</span> · District{" "}
            <span className="text-gray-200">Jatinegara</span> ·{" "}
            <span className="text-gray-200">tanggal hari ini saja</span> (00:00–23:59 WIB, hub
            460450593288). Angka volume diambil dari <span className="text-gray-200">total_records</span>{" "}
            HMS untuk filter tersebut, bukan hasil hitung halaman, supaya sama dengan yang tampil di
            HMS.
          </p>
          <p>
            Backlog FTD = FTD in driver + returned to hub (HMS summary). Forecast Volume = Fresh
            Estimated ({HISTORICAL_RATE}% historis) + Backlog. Slider delivery rate hanya dipakai
            untuk Target Delivered dan Target FTD.
            {lastUpdate && ` Terakhir update: ${lastUpdate.toLocaleTimeString("id-ID")}.`}
          </p>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function FilterChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-[10px] text-gray-300">
      <span className="text-gray-500">{label}:</span>
      <span className="font-semibold text-white">{value}</span>
    </span>
  );
}

function MetricCard({
  label,
  value,
  sub,
  accent,
  emphasis,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`bg-slate-800/60 rounded border ${
        emphasis ? "border-cyan-500/60" : "border-slate-700"
      } border-l-4 ${accent} px-4 py-3`}
    >
      <p className="text-[10px] font-bold text-gray-400 tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1.5 tabular-nums">{value}</p>
      <p className="text-[10px] text-gray-500 mt-1 leading-snug">{sub}</p>
    </div>
  );
}

function TargetCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="rounded border border-slate-700 overflow-hidden">
      <div className="bg-slate-700/70 px-4 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-300">{label}</p>
      </div>
      <div className="bg-slate-800/60 px-4 py-3">
        <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
        <p className="text-[10px] text-gray-500 mt-1 leading-snug">{sub}</p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span
        className={`tabular-nums ${
          danger ? "text-red-400" : strong ? "text-white font-bold" : "text-gray-200"
        }`}
      >
        {value}
      </span>
    </div>
  );
}