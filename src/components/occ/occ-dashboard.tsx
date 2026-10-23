"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut, Wifi } from "lucide-react";
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

// Jatinegara is the only hub for OCC. Hardcoded fallback so data always loads
// even when the hub-list endpoint is unavailable.
const JATINEGARA_HUB_ID = "460450593288";
const JATINEGARA_HUB_NAME = "GTL Jatinegara Hub";

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
  const [hubId, setHubId] = useState<string>(JATINEGARA_HUB_ID);
  const [hubName, setHubName] = useState<string>(JATINEGARA_HUB_NAME);

  useEffect(() => {
    let cancelled = false;

    const resolveHub = async () => {
      try {
        const res = await fetch("/api/hms/hubs");
        if (!res.ok) return;
        const data = await res.json();
        const list: any[] = Array.isArray(data) ? data : data?.hubs;
        if (!Array.isArray(list) || list.length === 0) return;

        const jtg = list.find((h: any) =>
          String(h.name || "").toLowerCase().includes("jatinegara")
        );
        const picked = jtg || list[0];
        if (!cancelled && picked) {
          setHubId(String(picked.hmsHubId || picked.hms_hub_id || picked.id || JATINEGARA_HUB_ID));
          setHubName(picked.name || JATINEGARA_HUB_NAME);
        }
      } catch {
        // keep hardcoded Jatinegara fallback
      }
    };

    resolveHub();
    return () => { cancelled = true; };
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
              OCC DASHBOARD - JATINEGARA
            </h1>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {hubName} | Operational date {opDate} | {opTime} WIB
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

      <main className="max-w-[1600px] mx-auto">
        {activeTab === "hourly" && <HourlyTab hubId={hubId} hubName={hubName} />}
        {activeTab === "ongoing" && <OngoingCourierTab hubId={hubId} />}
        {activeTab === "urgent" && <UrgentMonitoringTab hubId={hubId} />}
        {activeTab === "aging" && <CekAgingTab hubId={hubId} />}
        {activeTab === "cleanfloor" && <CleanFloorTab hubId={hubId} />}
        {activeTab === "forecast" && <ForecastTab hubId={hubId} />}
      </main>
    </div>
  );
}