"use client";

import { useState, useEffect, useCallback } from "react";
import { Lock, RefreshCw } from "lucide-react";
import { fetchDashboardJson } from "@/lib/client-fetch";

type CleanFloorData = {
  value: number;
  breakdown: {
    delivered: number; ongoing: number; ftd: number;
    others: number; pending: number;
    today_volume: number; numerator: number;
  };
  is_locked: boolean;
  locked_at: string;
  quality: string;
  captured_at: string;
};

type SnapshotData = {
  cleanFloor: CleanFloorData | null;
  pendingAtHub: number;
  todayVolume: number;
  ongoing: number;
  delivered: number;
  ftd: number;
  others: number;
  capturedAt: string;
};

export default function CleanFloorTab({ hubId }: { hubId: string }) {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const d = await fetchDashboardJson<any>(`/api/hms/summary?hubId=${hubId}`);
      if (d?.success && d.summary) {
        const s = d.summary;
        setSnapshot({
          cleanFloor: s.clean_floor || null,
          pendingAtHub: s.pending_at_hub || 0,
          todayVolume: s.today_volume || 0,
          ongoing: s.ongoing_delivery || 0,
          delivered: s.delivered || 0,
          ftd: s.ftd || 0,
          others: s.others || 0,
          capturedAt: s.clean_floor?.captured_at || s.fetched_at || new Date().toISOString(),
        });
      }
    } catch (e) { console.error("Clean Floor fetch error:", e); }
    finally { setLoading(false); }
  }, [hubId]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 300000);
    return () => clearInterval(t);
  }, [fetchData]);

  const cf = snapshot?.cleanFloor;
  const isLocked = cf?.is_locked ?? false;
  const cfValue = cf?.value ?? 0;
  const lockTime = cf?.locked_at ? new Date(cf.locked_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "08:00";

  return (
    <div className="px-6 py-4 space-y-6">
      {/* Top Section: 2 Large Boxes Side by Side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Clean Floor % */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-8 flex flex-col items-center justify-center text-center min-h-[200px] relative overflow-hidden">
          <div className={`absolute top-0 left-0 right-0 h-1 ${isLocked ? "bg-green-500" : "bg-blue-500 animate-pulse"}`} />
          <div className="flex items-center gap-2 mb-3">
            {isLocked ? <Lock className="w-5 h-5 text-green-400" /> : <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />}
            <span className={`text-xs font-bold tracking-wider ${isLocked ? "text-green-400" : "text-blue-400"}`}>
              {isLocked ? "LOCKED" : "LIVE"}
            </span>
          </div>
          <p className="text-6xl font-bold text-white mb-2">{cfValue.toFixed(2)}%</p>
          <p className="text-sm font-semibold text-gray-300">Clean Floor</p>
          <p className="text-xs text-gray-500 mt-1">
            {isLocked ? `Snapshot locked at ${lockTime} WIB` : "Locking at 08:00 WIB"}
          </p>
          <p className="text-[11px] text-gray-600 mt-1">
            Formula: (Volume - Pending) / Volume × 100
          </p>
        </div>

        {/* Pending at Hub */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-8 flex flex-col items-center justify-center text-center min-h-[200px] relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-red-500" />
          <p className="text-6xl font-bold text-red-400 mb-2">{(snapshot?.pendingAtHub ?? 0).toLocaleString("id-ID")}</p>
          <p className="text-sm font-semibold text-gray-300">Pending at Hub</p>
          <p className="text-xs text-gray-500 mt-1">
            Packages still at hub at {lockTime} WIB snapshot
          </p>
          <p className="text-[11px] text-gray-600 mt-1">
            From Clean Floor 08:00 WIB snapshot
          </p>
        </div>
      </div>

      {/* Bottom Section: 5 Medium Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <SnapshotCard label="Today's Volume" value={snapshot?.todayVolume ?? 0} accent="blue" />
        <SnapshotCard label="On-Going Delivery" value={snapshot?.ongoing ?? 0} accent="amber" />
        <SnapshotCard label="Delivered" value={snapshot?.delivered ?? 0} accent="green" />
        <SnapshotCard label="FTD" value={snapshot?.ftd ?? 0} accent="red" />
        <SnapshotCard label="Other Status" value={snapshot?.others ?? 0} accent="purple" />
      </div>

      {/* Timestamp */}
      <div className="flex items-center justify-between bg-slate-800/30 rounded-lg px-4 py-3 border border-slate-700">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-green-400" />
          <span className="text-xs text-gray-400">
            Clean Floor snapshot: {isLocked ? "LOCKED" : "PENDING"}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          Captured: {snapshot?.capturedAt ? new Date(snapshot.capturedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "N/A"} WIB
        </span>
        <button onClick={fetchData} disabled={loading} className="text-xs text-blue-400 hover:text-blue-300">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}

function SnapshotCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  const colors: Record<string, string> = {
    blue: "border-t-blue-500 text-blue-400", amber: "border-t-amber-500 text-amber-400",
    green: "border-t-green-500 text-green-400", red: "border-t-red-500 text-red-400",
    purple: "border-t-purple-500 text-purple-400",
  };
  return (
    <div className={`bg-slate-800/60 rounded-lg border border-slate-700 border-t-4 ${colors[accent] || ""} px-4 py-4 text-center`}>
      <p className="text-[10px] font-bold text-gray-400 tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-bold">{value.toLocaleString("id-ID")}</p>
      <p className="text-[10px] text-gray-500 mt-1">08:00 snapshot</p>
    </div>
  );
}