"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut, Wifi } from "lucide-react";
import { OCC_HUBS, type OccHubConfig } from "@/lib/occ-hubs";
import HourlyTab from "./hourly-tab";
import OngoingCourierTab from "./ongoing-courier-tab";
import UrgentMonitoringTab from "./urgent-monitoring-tab";
import CekAgingTab from "./cek-aging-tab";
import CleanFloorTab from "./clean-floor-tab";
import ForecastTab from "./forecast-tab";
import DatbuyTab from "./datbuy-tab";
import AgingMonitoringTab from "./aging-monitoring-tab";

type TabId = "hourly" | "ongoing" | "urgent" | "aging" | "cleanfloor" | "forecast" | "datbuy" | "aging-monitoring" | "aging-return";

const TABS: { id: TabId; label: string }[] = [
  { id: "hourly", label: "Hourly" },
  { id: "ongoing", label: "Delivery Nerve" },
  { id: "urgent", label: "Urgent Monitoring" },
  { id: "aging", label: "Cek Aging" },
  { id: "aging-monitoring", label: "Aging Monitoring" },
  { id: "aging-return", label: "Aging Return" },
  { id: "cleanfloor", label: "Clean Floor" },
  { id: "forecast", label: "Forecast" },
  { id: "datbuy", label: "Datbuy" },
];

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: string;
  hubIds: string[];
  hmsHubIds: string[];
  clusterIds: string[];
};

export default function OccDashboard({
  user,
  initialHub,
}: {
  user: SessionUser;
  initialHub: OccHubConfig;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("hourly");
  const [now, setNow] = useState<Date>(new Date());
  const hubId = initialHub.hmsHubId;
  const hubName = initialHub.name;
  const hubShortName = initialHub.shortName;
  const visibleTabs = TABS.filter((tab) => initialHub.fmDistrict ? true : tab.id !== "forecast" && tab.id !== "datbuy" && tab.id !== "aging-monitoring" && tab.id !== "aging-return");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const opDate = now.toLocaleDateString("id-ID", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const opTime = now.toLocaleTimeString("id-ID", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="bg-[#0a1628] border-b border-blue-900/30">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold tracking-widest text-gray-400">
                OPERATIONS CONTROL CENTER
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/40">
                <Wifi className="w-3 h-3" />
                LIVE HMS {hubShortName}
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight mt-1 text-white">
              OCC DASHBOARD - {hubShortName}
            </h1>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {hubName} | Operational date {opDate} | {opTime} WIB
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              {Object.values(OCC_HUBS).map((hub) => (
                <Link
                  key={hub.slug}
                  href={hub.slug === "jatinegara" ? "/occ" : `/occ/${hub.slug}`}
                  className={`px-2 py-1 rounded border transition-colors ${
                    hub.hmsHubId === hubId
                      ? "border-blue-400/60 bg-blue-400/10 text-blue-300"
                      : "border-white/10 bg-white/5 text-gray-400 hover:text-white"
                  }`}
                >
                  {hub.shortName}
                </Link>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="bg-[#0f1e3d] border-b border-blue-900/30 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6">
          <nav className="flex gap-1 overflow-x-auto">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-400 text-blue-400 bg-blue-400/5"
                    : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto">
        {activeTab === "hourly" && <HourlyTab hubId={hubId} hubName={hubName} />}
        {activeTab === "ongoing" && <OngoingCourierTab hubId={hubId} />}
        {activeTab === "urgent" && <UrgentMonitoringTab hubId={hubId} />}
        {activeTab === "aging" && <CekAgingTab hubId={hubId} />}
        {activeTab === "cleanfloor" && <CleanFloorTab hubId={hubId} />}
        {activeTab === "forecast" && <ForecastTab hubId={hubId} />}
        {activeTab === "datbuy" && <DatbuyTab hubId={hubId} />}
        {activeTab === "aging-monitoring" && <AgingMonitoringTab mode="forward" hubId={hubId} />}
        {activeTab === "aging-return" && <AgingMonitoringTab mode="return" hubId={hubId} />}
      </main>
    </div>
  );
}
