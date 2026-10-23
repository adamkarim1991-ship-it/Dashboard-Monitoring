"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp, AlertTriangle, Info } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DayResult = {
  date: string;
  received: number;
  receivedHubWide: number;
  districtMatched: number;
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

export default function ForecastTab({ hubId }: { hubId: string }) {
  const [data, setData] = useState<FmResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(97);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hms/fm?hubId=${hubId}&days=3&district=jatinegara`);
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

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 300000);
    return () => clearInterval(t);
  }, [fetchData]);

  const received = data?.today?.received || 0;
  const hourly = data?.today?.hourly || new Array(24).fill(0);
  const avgHistory = data?.avgHistory ?? null;

  const cumulative = useMemo(() => {
    let acc = 0;
    return hourly.map((v, h) => {
      acc += v;
      return { hour: `${String(h).padStart(2, "0")}:00`, received: v, cumulative: acc };
    });
  }, [hourly]);

  const forecastDelivered = Math.round((received * rate) / 100);
  const potentialGap = received - forecastDelivered;
  const vsAvg = avgHistory && avgHistory > 0 ? ((received - avgHistory) / avgHistory) * 100 : null;
  const nowHour = Number(
    new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(11, 13)
  );
  const remainingHours = Math.max(24 - nowHour, 0);
  const pacePerHour = nowHour > 0 ? received / nowHour : 0;
  const projectedEod = Math.round(received + pacePerHour * remainingHours);

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
        <FilterChip label="Date" value={data?.filters?.date || "today"} />
        <button
          onClick={fetchData}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BigCard label="Volume Received (FM)" value={received.toLocaleString("id-ID")} sub="Hari ini, status Received" accent="border-l-blue-500" />
        <BigCard label="Forecast Delivered" value={forecastDelivered.toLocaleString("id-ID")} sub={`Received x ${rate}%`} accent="border-l-green-500" />
        <BigCard
          label="Delivery Rate"
          value={`${rate}%`}
          sub="Historical assumption"
          accent="border-l-purple-500"
          input={
            <input
              type="range"
              min={80}
              max={100}
              step={0.5}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="w-full mt-2 accent-purple-500"
            />
          }
        />
        <BigCard
          label="vs Rata-rata 3 Hari"
          value={vsAvg === null ? "-" : `${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(1)}%`}
          sub={avgHistory ? `Avg: ${avgHistory.toLocaleString("id-ID")} paket/hari` : "Belum ada histori"}
          accent="border-l-amber-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-lg border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-white">Volume Received per Jam (WIB)</p>
            <p className="text-[10px] text-gray-500">Cumulative today</p>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cumulative}>
                <defs>
                  <linearGradient id="fmGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#64748b" }} interval={2} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={32} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", fontSize: 11 }}
                  formatter={(v: any, n: any) => [Number(v).toLocaleString("id-ID"), n === "cumulative" ? "Kumulatif" : "Per jam"]}
                />
                <Area type="monotone" dataKey="cumulative" stroke="#3b82f6" strokeWidth={2} fill="url(#fmGrad)" name="cumulative" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-3">
          <p className="text-xs font-bold text-white">Proyeksi</p>
          <Row label="Received sampai jam ini" value={received.toLocaleString("id-ID")} />
          <Row label="Pace per jam" value={pacePerHour ? pacePerHour.toFixed(1) : "0"} />
          <Row label="Sisa jam operasional" value={`${remainingHours} jam`} />
          <Row label="Proyeksi EOD (pace)" value={projectedEod.toLocaleString("id-ID")} strong />
          <Row label={`Potensi gagal (${100 - rate}%)`} value={potentialGap.toLocaleString("id-ID")} danger />
          <div className="pt-2 border-t border-slate-800">
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Forecast = Volume Received (FM) x historical delivery rate. Rate bisa disesuaikan
              sesuai performa aktual hub.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <p className="text-xs font-bold text-white">Volume Received Harian</p>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-[#0f1e3d] text-white">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold">Tanggal</th>
              <th className="px-4 py-2.5 text-right font-semibold">Received (Jatinegara)</th>
              <th className="px-4 py-2.5 text-right font-semibold">Hub-wide</th>
              <th className="px-4 py-2.5 text-right font-semibold">Forecast Delivered</th>
            </tr>
          </thead>
          <tbody>
            {[...(data?.history || []), ...(data?.today ? [data.today] : [])].length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-500">
                  {loading ? "Loading..." : "Belum ada data FM"}
                </td>
              </tr>
            ) : (
              [...(data?.history || []), ...(data?.today ? [data.today] : [])].map((d, i, arr) => (
                <tr key={d.date} className={`border-b border-slate-800 ${i === arr.length - 1 ? "bg-blue-950/20 font-semibold" : ""}`}>
                  <td className="px-4 py-2 text-white">
                    {d.date}
                    {i === arr.length - 1 && <span className="ml-2 text-[10px] text-blue-400">TODAY</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.received.toLocaleString("id-ID")}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-400">{(d.receivedHubWide ?? d.received).toLocaleString("id-ID")}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-green-400">{Math.round((d.received * rate) / 100).toLocaleString("id-ID")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 rounded border border-slate-700 bg-slate-800/40 px-4 py-3 text-[10px] text-gray-400">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-blue-400" />
        <p>
          Sumber: HMS FM Volume - Leg type <span className="text-gray-200">Last Mile</span>, Status{" "}
          <span className="text-gray-200">Received</span>, District{" "}
          <span className="text-gray-200">Jatinegara</span>, tanggal hari ini (WIB). Metodologi forecast
          mengacu pada Wiki Forecast; bila data histori belum tersedia dipakai standar{" "}
          <span className="text-gray-200">Received x historical delivery rate</span>.
          {lastUpdate && ` Terakhir update: ${lastUpdate.toLocaleTimeString("id-ID")}.`}
        </p>
      </div>
    </div>
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

function BigCard({
  label,
  value,
  sub,
  accent,
  input,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
  input?: React.ReactNode;
}) {
  return (
    <div className={`bg-slate-800/60 rounded border border-slate-700 border-l-4 ${accent} px-4 py-3`}>
      <p className="text-[10px] font-bold text-gray-400 tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1.5">{value}</p>
      <p className="text-[10px] text-gray-500 mt-1">{sub}</p>
      {input}
    </div>
  );
}

function Row({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={`tabular-nums ${danger ? "text-red-400" : strong ? "text-white font-bold" : "text-gray-200"}`}>{value}</span>
    </div>
  );
}
