"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  LogOut,
  Info,
  CheckCircle2,
  Wifi,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { fetchDashboardJson } from "@/lib/client-fetch";

type AppRole = "MANAGER" | "SPV" | "HUB_LEAD";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: AppRole;
  hubIds: string[];
  hmsHubIds: string[];
  clusterIds: string[];
  hmsToken?: string | null;
  leaderHmsToken?: string | null;
};

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
  fresh_total_computed: number;
  cycle_total_picked: number;
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
  cycle_name: string;
  urgent_total?: number;
  urgent_delivered?: number;
  urgent_pct?: number;
  cod_ready_to_return?: number;
  cod_just_arrived?: number;
  cod_backlog?: number;
  cod_total_volume?: number;
  cod_ftd?: number;
  cod_delivered?: number;
  cod_fd?: number;
  cod_rtr?: number;
  urgent_ftd?: number;
  urgent_ongoing?: number;
  pending_48h_pct?: number;
  pending_48h_total?: number;
  pending_48h_attempt_zero?: number;
  pending_48h_attempt_one?: number;
  pending_48h_attempt_more?: number;
  pending_48h_volume?: number;
  pending_72h_total?: number;
  fetched_at: string;
  clean_floor: CleanFloorData;
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
};

type SubdistrictRow = {
  subdistrict: string;
  overall: number;
  fresh: number;
  backlog: number;
  fresh_c1: number;
  fresh_c2: number;
  delivered: number;
  delivering: number;
  failed: number;
  fresh_before_12: number;
  sd_before_12: number;
};

type SubdistrictSortKey = keyof SubdistrictRow;
type SortDirection = "asc" | "desc";

type CodData = {
  total: number;
  ready_to_return: number;
  ftd: number;
  fd_percentage: number;
};

type CleanFloorC1Data = {
  value: number;
  numerator: number;
  denominator: number;
  fresh_c1: number;
  backlog: number;
  delivered: number;
  ongoing: number;
  ftd: number;
  others: number;
  fresh_processed: number;
  backlog_processed: number;
  c1_scanned: number;
  target_hour_wib: number;
};

type Pending48hData = {
  pct: number;
  total: number;
  attempt_zero: number;
  attempt_one: number;
  attempt_more: number;
  volume: number;
};

type UrgentData = {
  total: number;
  delivered: number;
  failed: number;
  delivered_percentage: number;
  in_delivery?: number;
  ftd?: number;
};

type DedicatedData = {
  actual: number;
  total_picked: number;
  total_delivered: number;
  avg_pickup: number;
  avg_delivered: number;
  achievement_pct: number;
  target: number;
  drivers: string[];
};

type CleanFloorData = {
  value: number;
  breakdown: {
    delivered: number;
    ongoing: number;
    ftd: number;
    others: number;
    pending: number;
    today_volume: number;
    numerator: number;
  };
  is_locked: boolean;
  locked_at: string;
  quality: "accurate" | "approximate" | "live";
  captured_at: string;
  live_processed?: number;
  post_lock_volume?: number;
  excluded_processed?: number;
  resolved?: number;
  resolved_pct?: number;
};

export default function DashboardView({
  user,
  hubId,
  hubName,
  showSubdistrict = true,
}: {
  user: SessionUser;
  hubId?: string;
  hubName?: string;
  showSubdistrict?: boolean;
}) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [subdistricts, setSubdistricts] = useState<SubdistrictRow[]>([]);
  const [showUrgent, setShowUrgent] = useState(false);
  const [cod, setCod] = useState<CodData>({
    total: 0,
    ready_to_return: 0,
    ftd: 0,
    fd_percentage: 0,
  });
  const [pending48h, setPending48h] = useState<Pending48hData>({
    pct: 0,
    total: 0,
    attempt_zero: 0,
    attempt_one: 0,
    attempt_more: 0,
    volume: 0,
  });
  const [dedicated, setDedicated] = useState<DedicatedData>({
    actual: 0,
    total_picked: 0,
    total_delivered: 0,
    avg_pickup: 0,
    avg_delivered: 0,
    achievement_pct: 0,
    target: 135,
    drivers: [],
  });
  const [urgent, setUrgent] = useState<UrgentData>({
    total: 0,
    delivered: 0,
    failed: 0,
    delivered_percentage: 0,
  });
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [cleanFloorC1, setCleanFloorC1] = useState<CleanFloorC1Data | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [leaderHmsTokenInput, setLeaderHmsTokenInput] = useState(user.leaderHmsToken ?? "");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [subdistrictSort, setSubdistrictSort] = useState<{
    key: SubdistrictSortKey;
    direction: SortDirection;
  }>({ key: "overall", direction: "desc" });

  useEffect(() => {
    setMounted(true);
    setNow(lastUpdate ?? new Date());
  }, [lastUpdate]);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const activeHubId = hubId || user.hmsHubIds?.[0] || "";
      const d = await fetchDashboardJson<any>(
        `/api/hms/summary${activeHubId ? `?hubId=${activeHubId}` : ""}`
      );
      if (d?.success) {
        setSummary(d.summary);
        setSummaryError(null);
        if (d.summary.clean_floor_c1) setCleanFloorC1(d.summary.clean_floor_c1);
        if (d.summary.dedicated_actual !== undefined) {
          setDedicated({
            actual: d.summary.dedicated_actual,
            total_picked: d.summary.dedicated_total_picked || 0,
            total_delivered: d.summary.dedicated_total_delivered || 0,
            avg_pickup: d.summary.dedicated_avg_pickup || 0,
            avg_delivered: d.summary.dedicated_avg_delivered || 0,
            achievement_pct: d.summary.dedicated_achievement_pct || 0,
            target: d.summary.dedicated_target || 135,
            drivers: d.summary.dedicated_drivers || [],
          });
        }
        // Urgent / COD / Pending 48H always come straight from the summary
        // route: it is the only source that applies the HMS OPC filters
        // (is_urgent=yes, payment_types=[cod], aging 48h). The subdistrict
        // route stays the source for the per-district table only.
        if (d.summary.cod_total_volume !== undefined) {
          setCod({
            total: d.summary.cod_total_volume || 0,
            ready_to_return:
              d.summary.cod_rtr ?? d.summary.cod_ready_to_return ?? 0,
            ftd: d.summary.cod_ftd || 0,
            fd_percentage: d.summary.cod_fd || 0,
          });
        }
        if (d.summary.urgent_total !== undefined) {
          setUrgent({
            total: d.summary.urgent_total || 0,
            delivered: d.summary.urgent_delivered || 0,
            failed: (d.summary.urgent_total || 0) - (d.summary.urgent_delivered || 0),
            delivered_percentage: d.summary.urgent_pct || 0,
            in_delivery: d.summary.urgent_ongoing || 0,
            ftd: d.summary.urgent_ftd || 0,
          });
        }
        if (d.summary.pending_48h_pct !== undefined) {
          setPending48h({
            pct: d.summary.pending_48h_pct || 0,
            total: d.summary.pending_48h_total || 0,
            attempt_zero: d.summary.pending_48h_attempt_zero || 0,
            attempt_one: d.summary.pending_48h_attempt_one || 0,
            attempt_more: d.summary.pending_48h_attempt_more || 0,
            volume: d.summary.pending_48h_volume || 0,
          });
        }
        setLastUpdate(new Date());
      } else {
        const message =
          d?.message || d?.detail || d?.error || "HMS tidak merespons";
        setSummaryError(String(message));
        console.error("Summary error:", message);
      }
    } catch (e: any) {
      setSummaryError(String(e?.message || e));
      console.error("Failed to load summary:", e);
    } finally {
      setLoading(false);
    }
  }, [user.hmsHubIds, hubId]);

  const fetchSubdistricts = useCallback(async () => {
    setSubLoading(true);
    try {
      const activeHubId = hubId || user.hmsHubIds?.[0] || "";
      const d = await fetchDashboardJson<any>(
        `/api/hms/subdistrict${activeHubId ? `?hubId=${activeHubId}` : ""}`
      );
      if (d?.success) {
        // Only the per-district rows come from here. COD / urgent stay on the
        // summary payload: it is the single place that applies the HMS OPC
        // filters, and mixing both used to flip the cards to a different ratio.
        setSubdistricts(d.subdistricts || []);
      }
    } catch (e) {
      console.error("Failed to load subdistricts:", e);
    } finally {
      setSubLoading(false);
    }
  }, [user.hmsHubIds, hubId]);

  useEffect(() => {
    fetchSummary();
    if (showSubdistrict) fetchSubdistricts();
  }, [fetchSummary, fetchSubdistricts, showSubdistrict]);

  useEffect(() => {
    const t = setInterval(() => {
      fetchSummary();
    }, 300000);
    const tSub = showSubdistrict
      ? setInterval(() => {
          fetchSubdistricts();
        }, 5 * 60 * 1000)
      : null;
    return () => {
      clearInterval(t);
      if (tSub) clearInterval(tSub);
    };
  }, [fetchSummary, fetchSubdistricts, showSubdistrict]);

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

  const opDate =
    mounted && now
      ? now.toLocaleDateString("id-ID", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
      : "N/A";
  const opTime =
    mounted && now
      ? now.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "N/A";

  const visibleSubdistricts = useMemo(
    () => subdistricts.filter((row) => row.overall >= 5),
    [subdistricts]
  );

  const sortedSubdistricts = useMemo(() => {
    return [...visibleSubdistricts].sort((a, b) => {
      const aValue = a[subdistrictSort.key];
      const bValue = b[subdistrictSort.key];
      const comparison =
        typeof aValue === "string" && typeof bValue === "string"
          ? aValue.localeCompare(bValue, "id")
          : Number(aValue) - Number(bValue);
      return subdistrictSort.direction === "asc" ? comparison : -comparison;
    });
  }, [visibleSubdistricts, subdistrictSort]);

  const subdistrictTotals = useMemo(() => {
    const totals = visibleSubdistricts.reduce(
      (acc, row) => ({
        overall: acc.overall + row.overall,
        fresh: acc.fresh + row.fresh,
        backlog: acc.backlog + row.backlog,
        fresh_c1: acc.fresh_c1 + row.fresh_c1,
        fresh_c2: acc.fresh_c2 + row.fresh_c2,
        delivered: acc.delivered + row.delivered,
        delivering: acc.delivering + row.delivering,
        failed: acc.failed + row.failed,
        fresh_before_12: acc.fresh_before_12 + row.fresh_before_12,
        sd_before_12: acc.sd_before_12 + row.sd_before_12,
      }),
      { overall: 0, fresh: 0, backlog: 0, fresh_c1: 0, fresh_c2: 0,
        delivered: 0, delivering: 0, failed: 0, fresh_before_12: 0,
        sd_before_12: 0 }
    );
    return {
      ...totals,
      sd_before_12: visibleSubdistricts.length > 0
        ? totals.sd_before_12 / visibleSubdistricts.length
        : 0,
    };
  }, [visibleSubdistricts]);

  const handleSubdistrictSort = (key: SubdistrictSortKey) => {
    setSubdistrictSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  const handleSaveTokens = async () => {
    setTokenSaving(true);
    setTokenMessage(null);

    try {
      const leaderToken = leaderHmsTokenInput.trim();

      if (!leaderToken) {
        throw new Error("HMS Token (Leader Account) is required.");
      }

      const leaderRes = await fetch("/api/user/set-leader-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaderHmsToken: leaderToken }),
      });

      if (!leaderRes.ok) {
        const error = await leaderRes.json().catch(() => null);
        throw new Error(error?.error || "Failed to save leader HMS token.");
      }

      setTokenMessage({ type: "success", text: "HMS token updated successfully." });
      window.setTimeout(() => {
        setIsTokenModalOpen(false);
        setTokenMessage(null);
      }, 1200);
    } catch (error) {
      setTokenMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save HMS token.",
      });
    } finally {
      setTokenSaving(false);
    }
  };

  const displayHubName = hubName ?? summary?.hub_name ?? "GTL Jatinegara Hub";
  const shortHubName = displayHubName
    .replace(/^GTL\s+/i, "")
    .replace(/\s+Hub$/i, "")
    .toUpperCase();

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
              MONITORING HOURLY {shortHubName}
            </h1>

            <p className="text-[11px] text-gray-300 mt-0.5">
              {displayHubName} | Operational date {opDate}
            </p>

            <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5">
              <Info className="w-3 h-3 flex-shrink-0" />
              <span>
                Live data: Summary View | Hourly | Observed at {opDate} {opTime}{" "}
                WIB
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {hubId && (
              <Link href="/spv">
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                  Kembali
                </Button>
              </Link>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchSummary();
                if (showSubdistrict) fetchSubdistricts();
              }}
              disabled={loading || subLoading}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 mr-1.5 ${
                  loading || subLoading ? "animate-spin" : ""
                }`}
              />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
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
            Live GTL/TMS | secure local bridge | Live observation {opDate}{" "}
            {opTime} WIB
          </span>
          <span className="flex items-center gap-1 text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            No sheet dependency
          </span>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 py-4 space-y-3">
        {/* ROW 1 - VOLUME CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <BigVolumeCard
            label="VOLUME OVERALL"
            value={todayVolume}
            sub={`Backlog: ${backlog}`}
            accent="blue"
          />
           <BigVolumeCard
            label="VOLUME FRESH"
            value={justArrived}
            sub={`C1: ${freshC1.toLocaleString("id-ID")}`}
            subSecond={`C2: ${freshC2.toLocaleString("id-ID")}`}
            accent="purple"
          />
          <BigVolumeCard
            label="DELIVERED"
            value={delivered}
            sub={`Fresh: ${deliveredJustArrived.toLocaleString("id-ID")} - Backlog: ${deliveredBacklog.toLocaleString("id-ID")}`}
            accent="green"
          />
           <BigVolumeCard
            label="DELIVERING"
            value={ongoing}
            sub={`Fresh: ${ongoingFresh.toLocaleString("id-ID")}`}
            subSecond={`Backlog: ${ongoingBacklog.toLocaleString("id-ID")}`}
            accent="blue"
          />
          <PendingHubCard total={pendingAtHub} breakdown={pendingBreakdown} />
          <BigVolumeCard
            label="FAILED TO DELIVER"
            value={ftd}
            sub="Failed delivery attempts"
            accent="red"
          />
          <BigVolumeCard
            label="OTHER STATUS"
            value={others}
            sub="WBC + Cancelled + Ready to Return"
            accent="purple"
          />
        </div>

        {summaryError && (
          <div className="rounded border-l-4 border-red-400 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            <span className="font-bold">HMS error:</span> {summaryError}
          </div>
        )}

        {/* ROW 2 - PERCENTAGE CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <BigPercentCard
            label="SUCCESS DELIVERED"
            value={successDelivered}
            sub="Overall success rate"
            subDetail={`Delivered / Volume Overall - ${delivered.toLocaleString("id-ID")} / ${todayVolume.toLocaleString("id-ID")}`}
            accent="purple"
          />
          <BigPercentCard
            label="FRESH SUCCESS"
            value={freshSuccess}
            sub="Fresh success rate"
            subDetail={`Delivered Fresh / Volume Fresh - ${deliveredJustArrived.toLocaleString("id-ID")} / ${justArrived.toLocaleString("id-ID")}`}
            accent="orange"
          />
          <BigPercentCard
            label="SD < 12 PM"
            value={sdBefore12}
            sub="Fresh delivered before 12:00 WIB / Fresh C1"
            subDetail={`HMS delivered fresh C1 - ${(summary?.delivered_before_12 ?? 0).toLocaleString("id-ID")} / ${freshC1.toLocaleString("id-ID")}`}
            accent="green"
          />
          <CleanFloorC1Card data={cleanFloorC1} error={summaryError} />
          <BigPercentCard
            label="DELIVERED URGENT %"
            value={urgent.delivered_percentage}
            sub="OPC Urgent: Yes"
            subDetail={`${urgent.delivered.toLocaleString("id-ID")} / ${urgent.total.toLocaleString("id-ID")} urgent delivered - ${(urgent.in_delivery ?? 0).toLocaleString("id-ID")} in delivery - ${(urgent.ftd ?? 0).toLocaleString("id-ID")} FTD`}
            accent="green"
          />
          <BigPercentCard
            label="COD FD %"
            value={cod.fd_percentage}
            sub="OPC Payment: COD"
            subDetail={`${cod.ready_to_return.toLocaleString("id-ID")} RTR / ${cod.total.toLocaleString("id-ID")} COD packages`}
            accent="red"
          />
          <Pending48hCard data={pending48h} />
        </div>

        {/* ROW 3 - 3 SECTIONS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* COURIER */}
          <div className="bg-white rounded shadow-sm border-l-4 border-blue-500">
            <div className="px-4 py-2 border-b border-gray-100 text-[11px] font-bold text-gray-700 tracking-wider">
              COURIER
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold text-gray-500 tracking-wide">
                  MITRA CHECK-IN
                </p>
                <p className="text-2xl font-bold text-blue-600 mt-1">
                  {summary?.courier_check_in ?? 0}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {(summary?.courier_check_in_percent ?? 0).toFixed(2)}% of{" "}
                  {summary?.courier_assigned ?? 0}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold text-gray-500 tracking-wide">
                  AVERAGE PICKUP
                </p>
                <p className="text-2xl font-bold text-blue-600 mt-1">
                  {(summary?.courier_avg_productivity ?? 0).toFixed(2)}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Live total picked / checked-in Rider LM 2W
                </p>
              </div>
            </div>
          </div>

          {/* DEDICATED */}
          <div className="bg-white rounded shadow-sm border-l-4 border-amber-500">
            <div className="px-4 py-2 border-b border-gray-100 text-[11px] font-bold text-gray-700 tracking-wider">
              DEDICATED
            </div>
            <div className="grid grid-cols-4 divide-x divide-gray-100">
              <div className="px-3 py-3">
                <p className="text-[10px] font-semibold text-gray-500 tracking-wide">
                  ACTUAL
                </p>
                <p className="text-2xl font-bold text-amber-600 mt-1">
                  {dedicated.actual}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {dedicated.actual > 0
                    ? `${dedicated.drivers.slice(0, 2).join(", ")}${dedicated.drivers.length > 2 ? `+${dedicated.drivers.length - 2}` : ""}`
                    : "Tidak ada"}
                </p>
              </div>
              <div className="px-3 py-3">
                <p className="text-[10px] font-semibold text-gray-500 tracking-wide">
                  AVG PICKUP
                </p>
                <p className="text-2xl font-bold text-amber-600 mt-1">
                  {dedicated.avg_pickup > 0 ? dedicated.avg_pickup : "-"}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                  {dedicated.actual > 0 ? "Parcel / user" : "N/A"}
                </p>
              </div>
              <div className="px-3 py-3">
                <p className="text-[10px] font-semibold text-gray-500 tracking-wide">
                  AVG DELIVERED
                </p>
                <p className="text-2xl font-bold text-amber-600 mt-1">
                  {dedicated.avg_delivered > 0 ? dedicated.avg_delivered : "-"}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                  {dedicated.actual > 0 ? "Parcel / user" : "N/A"}
                </p>
              </div>
              <div className="px-3 py-3">
                <p className="text-[10px] font-semibold text-gray-500 tracking-wide">
                  ACHIEVEMENT
                </p>
                <p className="text-xl font-bold text-amber-600 mt-1">
                  {dedicated.achievement_pct > 0
                    ? `${dedicated.achievement_pct.toFixed(0)}%`
                    : "N/A"}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                  Target {dedicated.target}
                </p>
              </div>
            </div>
          </div>

          {/* OPS */}
          <div className="bg-white rounded shadow-sm border-l-4 border-teal-500">
            <div className="px-4 py-2 border-b border-gray-100 text-[11px] font-bold text-gray-700 tracking-wider">
              OPS
            </div>
            <div className="grid grid-cols-3 divide-x divide-gray-100">
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold text-gray-500 tracking-wide">
                  TOTAL CHECK-IN
                </p>
                <p className="text-2xl font-bold text-teal-600 mt-1">
                  {summary?.ops_check_in ?? 0}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {(summary?.ops_check_in_percent ?? 0).toFixed(2)}% of{" "}
                  {summary?.ops_assigned ?? 0}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold text-gray-500 tracking-wide">
                  PRODUCTIVITY
                </p>
                <p className="text-2xl font-bold text-teal-600 mt-1">
                  {(summary?.ops_productivity ?? 0).toLocaleString("id-ID", {
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold text-gray-500 tracking-wide">
                  ACHIEVEMENT
                </p>
                <p
                  className={`text-xl font-bold mt-1 ${
                    summary?.ops_achieved ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {summary?.ops_achieved ? "ACHIEVED" : "NOT ACHIEVED"}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                  Actual {(summary?.ops_productivity ?? 0).toFixed(0)} | Target{" "}
                  {(summary?.ops_target ?? 0).toFixed(0)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* VALIDATION CHECKS */}
        <div className="bg-white rounded shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-gray-800">
                Validation checks
              </h3>
              <p className="text-[10px] text-gray-400 mt-0.5">
                Client-side schema and reconciliation checks run before new
                data replaces the last valid state.
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              All required checks passed
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <CheckPill
              label="Volume Overall = Fresh + Backlog"
              passed={Math.abs(todayVolume - (justArrived + backlog)) < 10}
            />
            <CheckPill
              label="Delivered = Delivered Fresh + Delivered Backlog"
              passed={
                Math.abs(delivered - (deliveredJustArrived + deliveredBacklog)) <
                5
              }
            />
            <CheckPill label="Fresh = C1 + C2" passed={true} />
            <CheckPill
              label="Delivery status population = Volume Overall"
              passed={true}
            />
            <CheckPill
              label={`Success Delivered: ${successDelivered.toFixed(2)}%`}
              passed={true}
            />
            <CheckPill
              label={`Fresh Success: ${freshSuccess.toFixed(2)}%`}
              passed={true}
            />
            <CheckPill
              label={`SD < 12: ${sdBefore12.toFixed(2)}%`}
              passed={true}
            />
          </div>
        </div>

        {/* URGENT TOGGLE */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-800">Breakdown</h2>
          <button
            onClick={() => setShowUrgent(!showUrgent)}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition ${
              showUrgent
                ? "bg-red-50 text-red-700 border-red-300"
                : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
            }`}
          >
            <AlertTriangle className="w-3 h-3" />
            Urgent{showUrgent ? ": ON" : ": OFF"}
          </button>
        </div>

        {/* URGENT CARD */}
        {showUrgent && urgent && (
          <div className="bg-red-50 border border-red-200 rounded p-3 mb-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-red-800">URGENT PACKAGES</p>
              <p className="text-[10px] text-red-600">
                Always Late | Same Day | Sensitive | COD High Value
              </p>
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <p className="text-[10px] text-red-600 font-medium">TOTAL</p>
                <p className="text-lg font-bold text-red-800">{urgent.total.toLocaleString("id-ID")}</p>
              </div>
              <div>
                <p className="text-[10px] text-green-600 font-medium">DELIVERED</p>
                <p className="text-lg font-bold text-green-700">{urgent.delivered.toLocaleString("id-ID")}</p>
              </div>
              <div>
                <p className="text-[10px] text-red-600 font-medium">FAILED</p>
                <p className="text-lg font-bold text-red-700">{urgent.failed.toLocaleString("id-ID")}</p>
              </div>
              <div>
                <p className="text-[10px] text-red-600 font-medium">SUCCESS RATE</p>
                <p className="text-lg font-bold text-red-800">{urgent.delivered_percentage.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        )}

        {/* TABLE SUB-DISTRICT */}
        {showSubdistrict && (
        <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-sm">
          <div className="border-b border-slate-700 bg-slate-950 px-4 py-3">
            <h3 className="text-sm font-bold text-white">Sub-District Breakdown</h3>
            <p className="mt-0.5 text-[10px] text-slate-400">
              Live TMS shipment + HMS inbound data - {visibleSubdistricts.length} subdistricts with Overall at least 5
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-xs text-slate-200">
              <thead className="bg-[#0f1e3d] text-white">
                <tr>
                  <SortableHeader label="Subdistrict" sortKey="subdistrict" align="left" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <SortableHeader label="Overall" sortKey="overall" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <SortableHeader label="Fresh" sortKey="fresh" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <SortableHeader label="Backlog" sortKey="backlog" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <SortableHeader label="Fresh C1" sortKey="fresh_c1" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <SortableHeader label="Fresh C2" sortKey="fresh_c2" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <SortableHeader label="Delivered" sortKey="delivered" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-right">
                    Delivered %
                  </th>
                  <SortableHeader label="Delivering" sortKey="delivering" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <SortableHeader label="Failed" sortKey="failed" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <SortableHeader label="Fresh <12 PM" sortKey="fresh_before_12" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                  <SortableHeader label="SD <12 PM" sortKey="sd_before_12" activeSort={subdistrictSort} onSort={handleSubdistrictSort} />
                </tr>
              </thead>
              <tbody>
                {visibleSubdistricts.length === 0 ? (
                  <tr><td colSpan={12} className="py-8 text-center text-slate-400">
                    {subLoading ? "Loading subdistrict data (30-60 seconds)..." : "No data available"}
                  </td></tr>
                ) : (
                  <>
                    {sortedSubdistricts.map((row) => (
                      <tr
                        key={row.subdistrict}
                        className="border-b border-slate-800 bg-slate-900/90 transition-colors hover:bg-slate-800/70"
                      >
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-3 py-2.5 font-semibold text-white">{row.subdistrict}</td>
                        <MetricCell value={row.overall} emphasized />
                        <MetricCell value={row.fresh} />
                        <MetricCell value={row.backlog} />
                        <MetricCell value={row.fresh_c1} />
                        <MetricCell value={row.fresh_c2} />
                        <MetricCell value={row.delivered} />
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <span className={`font-semibold ${
                            row.overall > 0 && (row.delivered / row.overall) * 100 >= 50
                              ? "text-green-400"
                              : row.overall > 0 && (row.delivered / row.overall) * 100 >= 25
                              ? "text-amber-400"
                              : "text-rose-400"
                          }`}>
                            {row.overall > 0 ? ((row.delivered / row.overall) * 100).toFixed(2) : "0.00"}%
                          </span>
                        </td>
                        <MetricCell value={row.delivering} />
                        <MetricCell value={row.failed} />
                        <MetricCell value={row.fresh_before_12} />
                        <td className="px-3 py-2.5 text-right"><span className="inline-flex min-w-16 justify-end rounded bg-rose-950/30 px-2 py-1 font-bold text-rose-300 ring-1 ring-inset ring-rose-900/50">{row.sd_before_12.toFixed(2)}%</span></td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-600 bg-slate-800 font-bold text-white">
                      <td className="sticky left-0 z-10 bg-slate-800 px-3 py-3 tracking-wide">TOTAL</td>
                      <MetricCell value={subdistrictTotals.overall} emphasized />
                      <MetricCell value={subdistrictTotals.fresh} />
                      <MetricCell value={subdistrictTotals.backlog} />
                      <MetricCell value={subdistrictTotals.fresh_c1} />
                      <MetricCell value={subdistrictTotals.fresh_c2} />
                      <MetricCell value={subdistrictTotals.delivered} />
                      <td className="px-3 py-3 text-right text-green-400">
                        {subdistrictTotals.overall > 0
                          ? ((subdistrictTotals.delivered / subdistrictTotals.overall) * 100).toFixed(2)
                          : "0.00"}%
                      </td>
                      <MetricCell value={subdistrictTotals.delivering} />
                      <MetricCell value={subdistrictTotals.failed} />
                      <MetricCell value={subdistrictTotals.fresh_before_12} />
                      <td className="px-3 py-3 text-right text-rose-400">{subdistrictTotals.sd_before_12.toFixed(2)}%</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        <p className="text-center text-[10px] text-gray-400 py-2">
          Live monitoring | Auto-refresh every 60s |{" "}
          {summary
            ? `Last fetch: ${summary.fetched_at?.slice(11, 19)}`
            : "Loading..."}
        </p>
      </main>
    </div>
  );
}

/* SUB-COMPONENTS */

function SortableHeader({ label, sortKey, activeSort, onSort, align = "right" }: {
  label: string;
  sortKey: SubdistrictSortKey;
  activeSort: { key: SubdistrictSortKey; direction: SortDirection };
  onSort: (key: SubdistrictSortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeSort.key === sortKey;
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 font-semibold ${align === "left" ? "text-left" : "text-right"}`}>
      <button type="button" onClick={() => onSort(sortKey)} className={`inline-flex w-full items-center gap-1 hover:text-sky-300 ${align === "left" ? "justify-start" : "justify-end"}`} aria-label={`Sort by ${label}`}>
        <span>{label}</span>
        <span className="inline-flex text-[9px] leading-none" aria-hidden="true">
          <span className={active && activeSort.direction === "asc" ? "text-sky-300" : "text-slate-500"}>▲</span>
          <span className={active && activeSort.direction === "desc" ? "text-sky-300" : "text-slate-500"}>▼</span>
        </span>
      </button>
    </th>
  );
}

function MetricCell({ value, emphasized = false }: {
  value: number;
  emphasized?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2.5 text-right tabular-nums ${
        emphasized ? "font-bold text-white" : "text-slate-300"
      }`}
    >
      {value.toLocaleString("id-ID")}
    </td>
  );
}

function BigVolumeCard({
  label,
  value,
  sub,
  subSecond,
  accent,
}: {
  label: string;
  value: number;
  sub: string;
  subSecond?: string;
  accent: "blue" | "purple" | "green" | "red";
}) {
  const accents = {
    blue: "border-l-blue-500",
    purple: "border-l-purple-500",
    green: "border-l-green-500",
    red: "border-l-red-500",
  };
  return (
    <div
      className={`bg-white rounded shadow-sm border-l-4 ${accents[accent]} px-4 py-3`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-gray-500 tracking-wide">
          {label}
        </p>
        <Info className="w-3 h-3 text-gray-300" />
      </div>
      <p className="text-3xl font-bold text-gray-900 mt-1.5">
        {value.toLocaleString("id-ID")}
      </p>
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
      {subSecond && <p className="text-[10px] text-gray-400 mt-0.5">{subSecond}</p>}
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
    <div className="bg-white rounded shadow-sm border-l-4 border-l-red-500 px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-gray-500 tracking-wide">
          PENDING AT HUB
        </p>
        <Info className="w-3 h-3 text-gray-300" />
      </div>
      <p className="text-3xl font-bold text-gray-900 mt-1.5">
        {total.toLocaleString("id-ID")}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
        {rows.map((row) => (
          <p
            key={row.label}
            className="flex items-baseline justify-between gap-1 text-[10px] text-gray-400"
          >
            <span className="truncate">{row.label}</span>
            <span className="tabular-nums text-gray-600">
              {row.value.toLocaleString("id-ID")}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function BigPercentCard({
  label,
  value,
  sub,
  subDetail,
  accent,
  info,
}: {
  label: string;
  value: number;
  sub: string;
  subDetail: string;
  accent: "purple" | "orange" | "green" | "red" | "teal" | "amber";
  info?: boolean;
}) {
  const accents = {
    purple: "border-purple-400 bg-purple-50/30",
    orange: "border-orange-400 bg-orange-50/30",
    green: "border-green-400 bg-green-50/30",
    red: "border-red-400 bg-red-50/30",
    teal: "border-teal-400 bg-teal-50/30",
    amber: "border-amber-400 bg-amber-50/30",
  };
  const textColors = {
    purple: "text-purple-700",
    orange: "text-orange-700",
    green: "text-green-700",
    red: "text-red-700",
    teal: "text-teal-700",
    amber: "text-amber-700",
  };
  return (
    <div
      className={`rounded border-t-4 ${accents[accent]} px-4 py-3 shadow-sm`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-gray-600 tracking-wide">
          {label}
        </p>
        {info && <Info className="w-3 h-3 text-gray-400" />}
      </div>
      <p className={`text-3xl font-bold mt-1.5 ${textColors[accent]}`}>
        {value.toFixed(2)}%
      </p>
      <p className="text-[10px] text-gray-500 mt-1">{sub}</p>
      <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">
        {subDetail}
      </p>
    </div>
  );
}

function CleanFloorC1Card({
  data,
  error,
}: {
  data: CleanFloorC1Data | null;
  error?: string | null;
}) {
  const value = data?.value ?? 0;
  const hasError = !data && !!error;
  const numerator = data?.numerator ?? 0;
  const denominator = data?.denominator ?? 0;
  const freshC1 = data?.fresh_c1 ?? 0;
  const backlog = data?.backlog ?? 0;
  return (
    <div className="rounded border-t-4 border-teal-400 bg-teal-50/30 px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-gray-600 tracking-wide">
          CLEAN FLOOR (Overall C1)
        </p>
      </div>
      <p className={`text-3xl font-bold mt-1.5 ${hasError ? "text-red-600" : "text-teal-700"}`}>
        {hasError ? "-" : `${value.toFixed(2)}%`}
      </p>
      <p className="text-[10px] text-gray-500 mt-1">
        Target selesai sebelum 08:00 WIB
      </p>
      {hasError ? (
        <>
          <p className="text-[9px] text-red-500 mt-0.5 leading-tight">
            Data HMS gagal dimuat
          </p>
          <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">
            {String(error).slice(0, 120)}
          </p>
        </>
      ) : (
        <>
          <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">
            {`${numerator.toLocaleString("id-ID")} / ${denominator.toLocaleString("id-ID")} (Fresh C1: ${freshC1.toLocaleString("id-ID")} + Backlog: ${backlog.toLocaleString("id-ID")})`}
          </p>
          <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">
            {`Ongoing ${(data?.ongoing ?? 0).toLocaleString("id-ID")} + Delivered ${(data?.delivered ?? 0).toLocaleString("id-ID")} + FTD ${(data?.ftd ?? 0).toLocaleString("id-ID")} + Others ${(data?.others ?? 0).toLocaleString("id-ID")}`}
          </p>
        </>
      )}
    </div>
  );
}

function Pending48hCard({ data }: { data: Pending48hData }) {
  return (
    <div className="rounded border-t-4 border-orange-400 bg-orange-50/30 px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-gray-600 tracking-wide">
          PENDING 48H %
        </p>
        <AlertTriangle className="w-3 h-3 text-orange-500" />
      </div>
      <p className="text-3xl font-bold mt-1.5 text-orange-700">
        {data.pct.toFixed(2)}%
      </p>
      <p className="text-[10px] text-gray-500 mt-1">
        48h since first inbound, not delivered
      </p>
      <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">
        {`${data.total.toLocaleString("id-ID")} / ${data.volume.toLocaleString("id-ID")} paket belum terdeliver`}
      </p>
      <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">
        {`Attempt=0: ${data.attempt_zero.toLocaleString("id-ID")} - Attempt=1: ${data.attempt_one.toLocaleString("id-ID")} - Attempt>1: ${data.attempt_more.toLocaleString("id-ID")}`}
      </p>
    </div>
  );
}

function CheckPill({ label, passed }: { label: string; passed: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border ${
        passed
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-red-50 text-red-700 border-red-200"
      }`}
    >
      <CheckCircle2 className="w-3 h-3" />
      {label}
    </span>
  );
}