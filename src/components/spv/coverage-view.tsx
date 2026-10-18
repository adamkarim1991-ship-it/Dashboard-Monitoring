"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  LogOut,
  Wifi,
  CheckCircle2,
  Info,
  TrendingUp,
  TrendingDown,
  MapPin,
  Lock,
} from "lucide-react";

type AppRole = "MANAGER" | "SPV" | "HUB_LEAD";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: AppRole;
  hubIds: string[];
  hmsHubIds: string[];
  clusterIds: string[];
};

type HubSummary = {
  hubId: string;
  hubName: string;
  success: boolean;
  error?: string;
  today_volume?: number;
  pending_at_hub?: number;
  delivered?: number;
  ongoing_delivery?: number;
  ftd?: number;
  ftd_total?: number;
  delivered_percentage?: number;
  fresh_success?: number;
  sd_before_12?: number;
  cod_fd?: number;
  cod_total?: number;
  urgent_pct?: number;
  urgent_total?: number;
  urgent_delivered?: number;
  dedicated_avg_pickup?: number;
  dedicated_avg_delivered?: number;
  dedicated_total_delivered?: number;
  dedicated_achievement_pct?: number;
  dedicated_actual?: number;
  dedicated_drivers?: string[];
  oncall_avg_productivity?: number;
  oncall_check_in?: number;
  oncall_assigned?: number;
  oncall_out_drivers?: number;
  clean_floor?: number | null;
  clean_floor_locked?: boolean;
};

type CoverageResponse = {
  success: boolean;
  meta: {
    hubs_count: number;
    success_count: number;
    fail_count: number;
    fetched_at: string;
    current_wib_hour?: number;
  };
  aggregated: {
    total_volume: number;
    total_delivered: number;
    total_ongoing: number;
    total_ftd: number;
    total_pending: number;
    avg_success: number;
  };
  hubs: HubSummary[];
};

export default function CoverageView({ user }: { user: SessionUser }) {
  const [data, setData] = useState<CoverageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [sortBy, setSortBy] = useState<"volume" | "success" | "name">("success");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setMounted(true);
    setNow(lastUpdate ?? new Date());
  }, [lastUpdate]);

  const fetchCoverage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hms/coverage");
      const d = await res.json();
      if (d.success) {
        setData(d);
        setLastUpdate(new Date());
      }
    } catch (e) {
      console.error("Failed to load coverage:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoverage();
  }, [fetchCoverage]);

  useEffect(() => {
    const t = setInterval(() => fetchCoverage(), 120000);
    return () => clearInterval(t);
  }, [fetchCoverage]);

  const opDate = mounted && now
    ? now.toLocaleDateString("id-ID", { year: "numeric", month: "2-digit", day: "2-digit" })
    : "N/A";
  const opTime = mounted && now
    ? now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "N/A";

  const sortedHubs = data?.hubs
    ? [...data.hubs].sort((a, b) => {
        if (!a.success) return 1;
        if (!b.success) return -1;
        let cmp = 0;
        if (sortBy === "volume") {
          cmp = (a.today_volume || 0) - (b.today_volume || 0);
        } else if (sortBy === "success") {
          cmp = (a.delivered_percentage || 0) - (b.delivered_percentage || 0);
        } else {
          cmp = a.hubName.localeCompare(b.hubName);
        }
        return sortDir === "desc" ? -cmp : cmp;
      })
    : [];

  const toggleSort = (key: "volume" | "success" | "name") => {
    if (sortBy === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* HEADER */}
      <header className="bg-[#0f1e3d] text-white">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold tracking-widest text-gray-400">
                OPERATIONS CONTROL
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/40">
                <Wifi className="w-3 h-3" />
                LIVE GTL/TMS
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight mt-1 text-white">
              COVERAGE - JABODETABEK EAST
            </h1>
            <p className="text-[11px] text-gray-300 mt-0.5 flex items-center gap-2">
              <MapPin className="w-3 h-3" />
              SPV: {user.name ?? user.email} | {data?.meta.hubs_count ?? 0} hub coverage
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5">
              <Info className="w-3 h-3" />
              <span>Live observation at {opDate} {opTime} WIB</span>
            </p>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCoverage}
              disabled={loading}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* STATUS BAR */}
      <div className="bg-green-50 border-b border-green-200">
        <div className="max-w-[1600px] mx-auto px-6 py-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 text-green-700">
            <Wifi className="w-3.5 h-3.5" />
            Live GTL/TMS | Coverage monitoring | {data?.meta.success_count ?? 0}/{data?.meta.hubs_count ?? 0} hubs online
          </span>
          <span className="flex items-center gap-1 text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Auto-refresh 2m
          </span>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <SummaryCard label="TOTAL VOLUME" value={data.aggregated.total_volume} accent="blue" />
            <SummaryCard label="TOTAL DELIVERED" value={data.aggregated.total_delivered} accent="green" />
            <SummaryCard label="ONGOING" value={data.aggregated.total_ongoing} accent="purple" />
            <SummaryCard label="PENDING AT HUB" value={data.aggregated.total_pending} accent="amber" />
            <SummaryCard label="FTD" value={data.aggregated.total_ftd} accent="red" />
            <SummaryCard label="AVG SUCCESS" value={data.aggregated.avg_success} suffix="%" accent="teal" />
          </div>
        )}

        <div>
          <h2 className="text-sm font-bold text-gray-700 mb-2">
            Hub Scorecard ({sortedHubs.length} hubs) - klik untuk detail
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedHubs.map((hub) => (
              <HubCard key={hub.hubId} hub={hub} />
            ))}
          </div>
        </div>

        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-800">Ranking Hub</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">
                Sorted by {sortBy === "success" ? "success rate" : sortBy === "volume" ? "volume" : "name"}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">#</th>
                  <th
                    className="px-4 py-2 text-left font-semibold cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort("name")}
                  >
                    Hub
                  </th>
                  <th
                    className="px-4 py-2 text-right font-semibold cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort("volume")}
                  >
                    Volume {sortBy === "volume" && (sortDir === "desc" ? " v" : " ^")}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">Delivered</th>
                  <th className="px-4 py-2 text-right font-semibold">Ongoing</th>
                  <th className="px-4 py-2 text-right font-semibold">Pending</th>
                  <th className="px-4 py-2 text-right font-semibold">FTD</th>
                  <th
                    className="px-4 py-2 text-right font-semibold cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort("success")}
                  >
                    Success {sortBy === "success" && (sortDir === "desc" ? " v" : " ^")}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {sortedHubs.map((hub, i) => {
                  const isTop = i < 3 && sortBy === "success" && sortDir === "desc";
                  const isBottom = i >= sortedHubs.length - 3 && sortBy === "success" && sortDir === "desc";
                  return (
                    <tr
                      key={hub.hubId}
                      className={`border-t border-gray-100 ${
                        isTop ? "bg-green-50/40" : isBottom ? "bg-red-50/30" : ""
                      }`}
                    >
                      <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                      <td className="px-4 py-2 font-semibold text-gray-800">{hub.hubName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{(hub.today_volume || 0).toLocaleString("id-ID")}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{(hub.delivered || 0).toLocaleString("id-ID")}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{(hub.ongoing_delivery || 0).toLocaleString("id-ID")}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-amber-600">{(hub.pending_at_hub || 0).toLocaleString("id-ID")}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-600">{(hub.ftd || 0).toLocaleString("id-ID")}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">
                        <span className={hub.delivered_percentage && hub.delivered_percentage >= 10 ? "text-green-600" : hub.delivered_percentage && hub.delivered_percentage >= 5 ? "text-amber-600" : "text-red-600"}>
                          {(hub.delivered_percentage || 0).toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href={`/spv/hub/${hub.hubId}`}
                          className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 font-semibold"
                        >
                          Detail {">"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

/* SUB-COMPONENTS */

function SummaryCard({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: number;
  suffix?: string;
  accent: "blue" | "green" | "purple" | "red" | "teal" | "amber";
}) {
  const accents: Record<string, string> = {
    blue: "border-l-blue-500",
    green: "border-l-green-500",
    purple: "border-l-purple-500",
    red: "border-l-red-500",
    teal: "border-l-teal-500",
    amber: "border-l-amber-500",
  };
  const textColors: Record<string, string> = {
    blue: "text-blue-600",
    green: "text-green-600",
    purple: "text-purple-600",
    red: "text-red-600",
    teal: "text-teal-600",
    amber: "text-amber-600",
  };
  return (
    <div className={`bg-white rounded shadow-sm border-l-4 ${accents[accent]} px-4 py-3`}>
      <p className="text-[10px] font-bold text-gray-500 tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1.5 ${textColors[accent]}`}>
        {value.toLocaleString("id-ID")}{suffix}
      </p>
    </div>
  );
}

function HubCard({ hub }: { hub: HubSummary }) {
  if (!hub.success) {
    return (
      <div className="bg-white rounded shadow-sm border-l-4 border-gray-300 p-4">
        <p className="text-sm font-bold text-gray-800">{hub.hubName}</p>
        <p className="text-xs text-red-600 mt-2"> {hub.error || "Error"}</p>
      </div>
    );
  }

  const successPct = hub.delivered_percentage || 0;
  const isGood = successPct >= 10;
  const isMid = successPct >= 5 && successPct < 10;
  const statusColor = isGood
    ? "border-l-green-500"
    : isMid
    ? "border-l-amber-500"
    : "border-l-red-500";
  const statusText = isGood ? "text-green-600" : isMid ? "text-amber-600" : "text-red-600";

  const hasCleanFloor = hub.clean_floor !== null && hub.clean_floor !== undefined;
  const cf = hub.clean_floor ?? 0;
  let cfColor = "text-gray-400";
  if (hasCleanFloor) {
    if (cf >= 99) cfColor = "text-green-600";
    else if (cf >= 97) cfColor = "text-amber-600";
    else cfColor = "text-red-600";
  }

  return (
    <Link
      href={`/spv/hub/${hub.hubId}`}
      className={`block bg-white rounded shadow-sm border-l-4 ${statusColor} p-4 transition hover:shadow-md hover:border-l-8 cursor-pointer`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-gray-900 truncate">{hub.hubName}</p>
          <p className="text-xs font-medium text-gray-600 mt-0.5">Hub ID: {hub.hubId}</p>
        </div>
        {isGood ? (
          <TrendingUp className="w-4 h-4 text-green-500" />
        ) : (
          <TrendingDown className="w-4 h-4 text-red-500" />
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-500 text-xs font-semibold">Volume</p>
          <p className="font-bold text-gray-800">{(hub.today_volume || 0).toLocaleString("id-ID")}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs font-semibold">Delivered</p>
          <p className="font-bold text-gray-800">{(hub.delivered || 0).toLocaleString("id-ID")}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs font-semibold">Ongoing</p>
          <p className="font-bold text-gray-800">{(hub.ongoing_delivery || 0).toLocaleString("id-ID")}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs font-semibold">Pending at Hub</p>
          <p className="font-bold text-amber-600">{(hub.pending_at_hub || 0).toLocaleString("id-ID")}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs font-semibold">FTD</p>
          <p className="font-bold text-red-600">{(hub.ftd || 0).toLocaleString("id-ID")}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs font-semibold">Fresh Success</p>
          <p className="font-bold text-emerald-600">{(hub.fresh_success || 0).toFixed(2)}%</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs font-semibold">SD &lt; 12 PM</p>
          <p className="font-bold text-blue-600">{(hub.sd_before_12 || 0).toFixed(2)}%</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs font-semibold">COD FD</p>
          <p className="font-bold text-purple-600">{(hub.cod_fd || 0).toFixed(2)}%</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs font-semibold">Urgent Delivered%</p>
          <p className="font-bold text-rose-600">{
(hub.urgent_pct || 0).toFixed(2)}%</p>
          <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
            {(hub.urgent_delivered || 0)} / {(hub.urgent_total || 0)}
          </p>
        </div>
          <div>
            <p className="text-gray-500 text-xs font-semibold">Dedicated Avg Pickup</p>
            <p className="font-bold text-indigo-600">{hub.dedicated_avg_pickup || 0}</p>
          </div>
        <div>
          <p className="text-gray-500 text-xs font-semibold">Dedicated Avg Delivered</p>
          <p className="font-bold text-amber-600">{hub.dedicated_avg_delivered || 0}</p>
        </div>
            <div>
          <p className="text-gray-500 text-xs font-semibold">Oncall Avg Prod</p>
          <p className="font-bold text-teal-600">
            {(hub.oncall_avg_productivity || 0).toFixed(2)}
          </p>
          <p className="text-[11px] text-gray-700 font-semibold leading-tight mt-0.5">
            {hub.oncall_check_in || 0} riders check-in
          </p>
        </div>
        <div className="col-span-2">
          <div className="flex items-center gap-1">
            <p className="text-gray-400 text-[10px]">Clean Floor</p>
            {hasCleanFloor && hub.clean_floor_locked && (
              <Lock className="w-2.5 h-2.5 text-gray-400" />
            )}
            {hasCleanFloor && !hub.clean_floor_locked && (
              <span className="text-[8px] text-blue-500 font-medium">live</span>
            )}
          </div>
          <p className={`font-bold ${cfColor}`}>
            {hasCleanFloor ? `${cf.toFixed(2)}%` : "N/A"}
          </p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-[10px] text-gray-500 font-semibold">SUCCESS RATE</span>
        <span className={`text-lg font-bold ${statusText}`}>
          {successPct.toFixed(2)}%
        </span>
      </div>
    </Link>
  );
}
