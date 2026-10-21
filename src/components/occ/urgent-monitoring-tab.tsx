"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

type UrgentShipment = {
  awb: string;
  status: string;
  driverName: string;
};

export default function UrgentMonitoringTab({ hubId }: { hubId: string }) {
  const [shipments, setShipments] = useState<UrgentShipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [total, setTotal] = useState(0);
  const [delivered, setDelivered] = useState(0);

  const fetchData = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hms/performance?hubId=${hubId}`);
      const d = await res.json();
      if (d.success && d.shipments) {
        const urgentList: UrgentShipment[] = [];
        let del = 0;
        for (const s of d.shipments) {
          const isUrgent = s.is_urgent === "true" || s.is_urgent === true || s.urgent === "true" || s.urgent === true || s.service_type === "SDS";
          if (isUrgent) {
            const status = String(s.status || "Unknown");
            const driverName = s.driver?.name || s.driver_name || s.courier_name || "-";
            urgentList.push({ awb: s.awb_number || "-", status, driverName });
            if (status.toLowerCase() === "delivered") del++;
          }
        }
        setShipments(urgentList);
        setTotal(urgentList.length);
        setDelivered(del);
        setLastUpdate(new Date());
      }
    } catch (e) { console.error("Urgent fetch error:", e); }
    finally { setLoading(false); }
  }, [hubId]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  const notDelivered = total - delivered;

  return (
    <div className="px-6 py-4 space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-amber-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">URGENT TOTAL</p>
          <p className="text-3xl font-bold text-amber-400 mt-1.5">{total.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-gray-500 mt-1">Packages marked urgent</p>
        </div>
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-green-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">DELIVERED</p>
          <p className="text-3xl font-bold text-green-400 mt-1.5">{delivered.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-gray-500 mt-1">{total > 0 ? ((delivered/total)*100).toFixed(1) : 0}% success</p>
        </div>
        <div className="bg-slate-800/60 rounded border border-slate-700 border-l-4 border-l-red-500 px-4 py-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-wide">NOT DELIVERED</p>
          <p className="text-3xl font-bold text-red-400 mt-1.5">{notDelivered.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-gray-500 mt-1">Pending / FTD</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-gray-400">{shipments.length} urgent AWB records</span>
        </div>
        <button onClick={fetchData} disabled={loading} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Table */}
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
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${s.status.toLowerCase() === "delivered" ? "bg-green-950/50 text-green-400" : s.status.toLowerCase().includes("ftd") || s.status.toLowerCase().includes("fail") ? "bg-red-950/50 text-red-400" : "bg-amber-950/50 text-amber-400"}`}>
                        {s.status}
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
        Auto-refresh 60s | HMS Live Data | {lastUpdate ? `Last: ${lastUpdate.toLocaleTimeString("id-ID")}` : ""}
      </p>
    </div>
  );
}