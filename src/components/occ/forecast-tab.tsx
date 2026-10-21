"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, TrendingUp, Minus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

type TrendPoint = {
  time: string;
  delivered?: number;
  projected?: number;
};

export default function ForecastTab({ hubId }: { hubId: string }) {
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [projection, setProjection] = useState<number>(0);
  const [rate, setRate] = useState<number>(0);
  const [currentDelivered, setCurrentDelivered] = useState<number>(0);

  const fetchData = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hms/summary?hubId=${hubId}`);
      const d = await res.json();
      if (d.success && d.summary) {
        const delivered = d.summary.delivered || 0;
        const todayVolume = d.summary.today_volume || 0;
        setCurrentDelivered(delivered);

        // Calculate current hour WIB
        const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const hour = now.getUTCHours();
        const minute = now.getUTCMinutes();

        // Estimate delivery rate per hour since 00:00
        const elapsedHours = hour + minute / 60;
        const deliveryRate = elapsedHours > 0 ? delivered / elapsedHours : 0;
        setRate(deliveryRate);

        // Project end of day (until 17:00 WIB)
        const remainingHours = Math.max(0, 17 - hour);
        const projectedAdditional = deliveryRate * remainingHours;
        const projectedTotal = delivered + projectedAdditional;
        setProjection(Math.round(projectedTotal));

        // Build hourly trend
        const points: TrendPoint[] = [];
        for (let h = 0; h <= Math.min(hour, 23); h++) {
          const expectedDelivered = deliveryRate * h;
          const timeLabel = `${String(h).padStart(2, "0")}:00`;
          if (h <= hour) {
            points.push({ time: timeLabel, delivered: Math.round(expectedDelivered) });
          }
        }
        // Add projection points
        for (let h = hour + 1; h <= 20; h++) {
          const projectedDel = deliveryRate * h;
          const timeLabel = `${String(h).padStart(2, "0")}:00`;
          points.push({ time: timeLabel, delivered: h <= hour ? Math.round(projectedDel) : undefined, projected: Math.round(projectedDel) });
        }
        setTrend(points);
      }
    } catch (e) { console.error("Forecast fetch error:", e); }
    finally { setLoading(false); }
  }, [hubId]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const hour = now.getUTCHours();
  const remainingHours = Math.max(0, 17 - hour);

  return (
    <div className="px-6 py-4 space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-blue-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">CURRENT DELIVERED</p>
          <p className="text-3xl font-bold text-blue-400 mt-1.5">{currentDelivered.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-gray-500 mt-1">As of {String(hour).padStart(2, "0")}:00 WIB</p>
        </div>
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-green-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">DELIVERY RATE</p>
          <p className="text-3xl font-bold text-green-400 mt-1.5">{rate.toFixed(1)}</p>
          <p className="text-[10px] text-gray-500 mt-1">Packages / hour</p>
        </div>
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-amber-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">PROJECTED EOD</p>
          <p className="text-3xl font-bold text-amber-400 mt-1.5">{projection.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-gray-500 mt-1">{remainingHours}h remaining until 17:00</p>
        </div>
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-purple-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">TREND</p>
          <div className="flex items-center gap-2 mt-1.5">
            {rate > 0 ? <TrendingUp className="w-6 h-6 text-green-400" /> : <Minus className="w-6 h-6 text-gray-400" />}
            <p className="text-2xl font-bold text-purple-400">{rate > 0 ? "↑ Active" : "— Waiting"}</p>
          </div>
          <p className="text-[10px] text-gray-500 mt-1">Delivery pace tracking</p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-slate-800/60 rounded-lg border border-slate-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Delivery Rate Forecast</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">Cumulative delivered vs projection based on current pace</p>
          </div>
          <button onClick={fetchData} disabled={loading} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorDelivered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorProjected" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => v.toLocaleString("id-ID")} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", borderRadius: "8px", color: "#e2e8f0", fontSize: "12px" }}
                formatter={(value: any, _name: any) => [Number(value).toLocaleString("id-ID"), _name === "delivered" ? "Delivered" : "Projected"]}
              />
              <Area type="monotone" dataKey="delivered" stroke="#3b82f6" fill="url(#colorDelivered)" strokeWidth={2} name="delivered" />
              <Area type="monotone" dataKey="projected" stroke="#f59e0b" fill="url(#colorProjected)" strokeWidth={2} strokeDasharray="5 5" name="projected" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Details */}
      <div className="bg-slate-800/30 rounded-lg border border-slate-700 p-4">
        <h4 className="text-xs font-bold text-gray-300 mb-2">How it works</h4>
        <ul className="text-[11px] text-gray-500 space-y-1">
          <li>• Delivery rate = Current delivered / elapsed hours since 00:00 WIB</li>
          <li>• Projected EOD = Current delivered + (rate × remaining hours until 17:00 WIB)</li>
          <li>• Data pulls automatically from HMS every 60 seconds</li>
          <li>• Solid line = actual cumulative delivered | Dashed line = projection</li>
        </ul>
      </div>

      <p className="text-center text-[10px] text-gray-500 py-2">
        Auto-refresh 60s | HMS Live Data | Projection based on current delivery pace
      </p>
    </div>
  );
}