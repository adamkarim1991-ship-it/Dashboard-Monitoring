"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

type UrgentShipment = {
  awb: string;
  status: string;
  driverName: string;
};

type UrgentMetrics = {
  total: number;
  delivered: number;
  not_delivered: number;
  ongoing: number;
  ftd: number;
  success_pct: number;
  open_awbs: number;
};

const STATUS_LABEL: Record<string, string> = {
  out_for_delivery: "On Delivery",
  in_driver: "In Driver",
  failed_to_deliver: "FTD",
  received: "At Hub",
  arrived_at_hub: "At Hub",
  still_in_hub: "At Hub",
  delivered: "Delivered",
};

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "delivered") return "bg-green-950/50 text-green-400";
  if (s.includes("fail")) return "bg-red-950/50 text-red-400";
  return "bg-amber-950/50 text-amber-400";
}

export default function UrgentMonitoringTab({ hubId }: { hubId: string }) {
  const [shipments, setShipments] = useState<UrgentShipment[]>([]);
  const [metrics, setMetrics] = useState<UrgentMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hms/urgent?hubId=${hubId}`);
      const d = await res.json();
      if (d.success) {
        setShipments(Array.isArray(d.packages) ? d.packages : []);
        setMetrics(d.metrics || null);
        setLastUpdate(new Date());
        setError(d.meta?.list_error ? `List AWB: ${d.meta.list_error}` : null);
      } else {
        setError(d.message || d.error || d.detail || `HMS error (HTTP ${res.status})`);
      }
    } catch (e) {
      console.error("Urgent fetch error:", e);
      setError("Tidak dapat menghubungi server HMS.");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  const total = metrics?.total ?? 0;
  const delivered = metrics?.delivered ?? 0;
  const notDelivered = metrics?.not_delivered ?? 0;

  return (
    <div className="px-6 py-4 space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Data urgent belum lengkap</p>
            <p className="mt-0.5 text-red-400/80">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-amber-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">URGENT TOTAL</p>
          <p className="text-3xl font-bold text-amber-400 mt-1.5">{total.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-gray-500 mt-1">Packages marked urgent (OPC urgent = yes)</p>
        </div>
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-green-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">DELIVERED</p>
          <p className="text-3xl font-bold text-green-400 mt-1.5">{delivered.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-gray-500 mt-1">{metrics?.success_pct ?? 0}% success</p>
        </div>
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-red-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">NOT DELIVERED</p>
          <p className="text-3xl font-bold text-red-400 mt-1.5">{notDelivered.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-gray-500 mt-1">Ongoing {metrics?.ongoing ?? 0} | FTD {metrics?.ftd ?? 0}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-gray-400">
            {shipments.length} open urgent AWB records
            {delivered > 0 ? ` | ${delivered} sudah delivered (tidak lagi tampil di list AWB)` : ""}
          </span>
        </div>
        <button onClick={fetchData} disabled={loading} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-slate-200">
            <thead className="bg-[#0f1e3d] text-white">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-center w-12">#</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-left">AWB</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-left">Status</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-left">Driver Name</th>
              </tr>
            </thead>
            <tbody>
              {shipments.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-slate-500">{loading ? "Loading urgent data..." : "No urgent packages"}</td></tr>
              ) : (
                shipments.map((s, i) => (
                  <tr key={`${s.awb}-${i}`} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-2.5 text-center text-slate-500">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{s.awb}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusClass(s.status)}`}>
                        {STATUS_LABEL[s.status.toLowerCase()] || s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300">{s.driverName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[10px] text-gray-500 py-2">
        Auto-refresh 60s | HMS OPC urgent=yes | {lastUpdate ? `Last: ${lastUpdate.toLocaleTimeString("id-ID")}` : ""}
      </p>
    </div>
  );
}
