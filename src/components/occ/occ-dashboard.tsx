"use client";

import { useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { RefreshCw, LogOut, Wifi } from "lucide-react";
import HourlyTab from "./hourly-tab";
import OngoingCourierTab from "./ongoing-courier-tab";
import UrgentMonitoringTab from "./urgent-monitoring-tab";
import CekAgingTab from "./cek-aging-tab";
import CleanFloorTab from "./clean-floor-tab";
import ForecastTab from "./forecast-tab";

type TabId = "hourly" | "ongoing" | "urgent" | "aging" | "cleanfloor" | "forecast";

const TABS: { id: TabId; label: string }[] = [
  { id: "hourly", label: "Hourly" },
  { id: "ongoing", label: "Ongoing Courier" },
  { id: "urgent", label: "Urgent Monitoring" },
  { id: "aging", label: "Cek Aging" },
  { id: "cleanfloor", label: "Clean Floor" },
  { id: "forecast", label: "Forecast" },
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

export default function OccDashboard({ user }: { user: SessionUser }) {
  const [activeTab, setActiveTab] = useState<TabId>("hourly");
  const [now, setNow] = useState<Date>(new Date());
  const [hubId, setHubId] = useState<string>("");
  const [hubName, setHubName] = useState<string>("");

  useEffect(() => {
    const findJatinegara = async () => {
      try {
        const res = await fetch("/api/hms/hubs");
        const data = await res.json();
        if (data.success && data.hubs) {
          const jtg = data.hubs.find((h: any) =>
            h.name?.toLowerCase().includes("jatinegara")
          );
          if (jtg) {
            setHubId(jtg.hmsHubId || jtg.id);
            setHubName(jtg.name);
          }
        }
      } catch (e) {
        console.error("Failed to find Jatinegara hub:", e);
      }
    };
    findJatinegara();
  }, []);

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
      {/* HEADER */}
      <header className="bg-[#0a1628] border-b border-blue-900/30">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold tracking-widest text-gray-400">
                OPERATIONS CONTROL CENTER
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/40">
                <Wifi className="w-3 h-3" />
                LIVE HMS JATINEGARA
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight mt-1 text-white">
              OCC DASHBOARD — JATINEGARA
            </h1>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {hubName || "Jatinegara Hub"} | Operational date {opDate} | {opTime} WIB
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
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

      {/* TAB NAVIGATION */}
      <div className="bg-[#0f1e3d] border-b border-blue-900/30 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6">
          <nav className="flex gap-1 overflow-x-auto">
            {TABS.map((tab) => (
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

      {/* TAB CONTENT */}
      <main className="max-w-[1600px] mx-auto">
        {activeTab === "hourly" && <HourlyTab hubId={hubId} hubName={hubName} />}
        {activeTab === "ongoing" && <OngoingCourierTab hubId={hubId} />}
        {activeTab === "urgent" && <UrgentMonitoringTab hubId={hubId} />}
        {activeTab === "aging" && <CekAgingTab />}
        {activeTab === "cleanfloor" && <CleanFloorTab hubId={hubId} />}
        {activeTab === "forecast" && <ForecastTab hubId={hubId} />}
      </main>
    </div>
  );
}