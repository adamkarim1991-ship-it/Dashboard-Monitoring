"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Download, AlertTriangle } from "lucide-react";

type CourierRow = {
  name: string;
  freshC1: number;
  sd12Pct: number;
  totalCarried: number;
  totalFtd: number;
  deliveredPct: number;
  delivered: number;
};

type FilterMode = "all" | "below97" | "above97";
type TabMode = "ongoing" | "top10";
type SubTabMode = "c1" | "overall";

// Parse HMS timestamps: unix seconds, unix ms, or ISO string
function parseTs(x: any): number {
  if (x === null || x === undefined || x === "") return 0;
  if (typeof x === "number") {
    if (!x) return 0;
    return x > 1e12 ? Math.floor(x / 1000) : Math.floor(x);
  }
  const str = String(x).trim();
  if (!str) return 0;
  if (/^\d+$/.test(str)) {
    const n = Number(str);
    return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  const t = Date.parse(str);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function isFtdStatus(status: string): boolean {
  const s = String(status || "").toLowerCase();
  return s === "failed_to_deliver" || s === "ftd" || s.indexOf("failed") >= 0;
}

function pickDriverName(s: any): string {
  let drv =
    (s && s.route && s.route.driver_name) ||
    s.driver_name ||
    s.courier_name ||
    s.assigned_drivers ||
    "";
  if (Array.isArray(drv)) drv = drv[0] || "";
  return String(drv).split(",")[0].trim();
}

function pickOfdTime(s: any): number {
  return (
    parseTs(s?.destination_details?.out_for_delivery_time) ||
    parseTs(s?.out_for_delivery_time) ||
    parseTs(s?.pickup_details?.pickup_time) ||
    parseTs(s?.pickup_time) ||
    parseTs(s?.picked_at)
  );
}

function pickDeliveredTime(s: any): number {
  return (
    parseTs(s?.delivered_time) ||
    parseTs(s?.destination_details?.delivery_time)
  );
}

export default function OngoingCourierTab({ hubId }: { hubId: string }) {
  const [couriers, setCouriers] = useState<CourierRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unassigned, setUnassigned] = useState(0);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [tabMode, setTabMode] = useState<TabMode>("ongoing");
  const [subTab, setSubTab] = useState<SubTabMode>("c1");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [ftdMap, setFtdMap] = useState<Map<string, number>>(new Map());
  const [ftdFrozen, setFtdFrozen] = useState(false);
  const currentDayRef = useRef<string>("");
  const tableRef = useRef<HTMLDivElement>(null);

  const getWIBDateKey = (): string => {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}-${String(wib.getUTCDate()).padStart(2, "0")}`;
  };

  const getWIBHourMinute = (): { hour: number; minute: number } => {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return { hour: wib.getUTCHours(), minute: wib.getUTCMinutes() };
  };

  const getOpWindow = () => {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const startUTC = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 0, 0, 0);
    const start = Math.floor((startUTC - 7 * 60 * 60 * 1000) / 1000);
    return { start, end: start + 86399, eight: start + 8 * 3600, noon: start + 12 * 3600 };
  };

  const fetchData = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hms/performance?hubId=${hubId}&days=2`);
      const d = await res.json();
      if (d.success && Array.isArray(d.shipments)) {
        processShipments(d.shipments);
        setLastUpdate(new Date());
        setError(null);
      } else {
        setError(d.message || d.error || `HMS error (HTTP ${res.status})`);
      }
    } catch (e) {
      console.error("Courier fetch error:", e);
      setError("Tidak dapat menghubungi server HMS.");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  const processShipments = (shipments: any[]) => {
    const wibDayKey = getWIBDateKey();
    const { hour, minute } = getWIBHourMinute();
    const { start, end, eight, noon } = getOpWindow();

    if (currentDayRef.current && currentDayRef.current !== wibDayKey) {
      setFtdMap(new Map());
      setFtdFrozen(false);
    }
    currentDayRef.current = wibDayKey;

    const isPast2330 = hour > 23 || (hour === 23 && minute >= 30);
    const isMidnightReset = hour === 0 && minute < 1;
    if (isMidnightReset) {
      setFtdMap(new Map());
      setFtdFrozen(false);
    }
    if (isPast2330 && !isMidnightReset) setFtdFrozen(true);

    type Stat = { freshC1: number; sd12: number; carried: number; delivered: number; ftd: number };
    const map = new Map<string, Stat>();
    let noCourier = 0;

    for (const s of shipments) {
      const ofd = pickOfdTime(s);
      if (!(ofd >= start && ofd <= end)) continue;

      const name = pickDriverName(s);
      if (!name) {
        noCourier++;
        continue;
      }

      let st = map.get(name);
      if (!st) {
        st = { freshC1: 0, sd12: 0, carried: 0, delivered: 0, ftd: 0 };
        map.set(name, st);
      }

      const status = String(s?.status || "").toLowerCase().trim();
      const deliveredAt = pickDeliveredTime(s);
      const isDelivered =
        (deliveredAt >= start && deliveredAt <= end) || status === "delivered";
      const isC1 = ofd < eight;

      st.carried++;
      if (isC1) st.freshC1++;
      if (isDelivered) {
        st.delivered++;
        if (isC1 && deliveredAt > 0 && deliveredAt < noon) st.sd12++;
      }
      if (isFtdStatus(status)) st.ftd++;
    }

    const rows: CourierRow[] = [];
    for (const [name, st] of map.entries()) {
      const storedFtd = ftdMap.get(name) || 0;
      const effectiveFtd = isPast2330 ? storedFtd : Math.max(st.ftd, storedFtd);
      if (!isPast2330) {
        setFtdMap((prev) => {
          const next = new Map(prev);
          next.set(name, effectiveFtd);
          return next;
        });
      }
      rows.push({
        name,
        freshC1: st.freshC1,
        sd12Pct: st.freshC1 > 0 ? (st.sd12 / st.freshC1) * 100 : 0,
        totalCarried: st.carried,
        totalFtd: effectiveFtd,
        deliveredPct: st.carried > 0 ? (st.delivered / st.carried) * 100 : 0,
        delivered: st.delivered,
      });
    }

    setUnassigned(noCourier);
    setCouriers(rows.sort((a, b) => b.totalCarried - a.totalCarried));
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  const filtered = couriers.filter((c) => {
    if (filter === "all") return true;
    if (filter === "below97") return c.deliveredPct < 97;
    if (filter === "above97") return c.deliveredPct >= 97;
    return true;
  });

  const displayed = subTab === "c1" ? filtered.filter((c) => c.freshC1 > 0) : filtered;
  const displayList =
    tabMode === "top10"
      ? [...displayed].sort((a, b) => b.totalCarried - a.totalCarried).slice(0, 10)
      : displayed;

  const totalCarried = couriers.reduce((a, c) => a + c.totalCarried, 0);
  const totalFreshC1 = couriers.reduce((a, c) => a + c.freshC1, 0);
  const totalFreshC2 = totalCarried - totalFreshC1;
  const totalDelivered = couriers.reduce((a, c) => a + c.delivered, 0);
  const sd12Numerator = couriers.reduce((a, c) => a + (c.freshC1 * c.sd12Pct) / 100, 0);
  const hubSd12 = totalFreshC1 > 0 ? (sd12Numerator / totalFreshC1) * 100 : 0;
  const overallDeliveredPct = totalCarried > 0 ? (totalDelivered / totalCarried) * 100 : 0;

  const downloadPNG = async () => {
    if (!tableRef.current) return;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(tableRef.current, { backgroundColor: "#0f172a" });
      const link = document.createElement("a");
      link.download = "ongoing-courier.png";
      link.href = canvas.toDataURL();
      link.click();
    } catch {
      alert("html2canvas not available for PNG export.");
    }
  };

  return (
    <div className="px-6 py-4 space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Data kurir belum tersedia</p>
            <p className="mt-0.5 text-red-400/80">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Carried" value={totalCarried.toLocaleString("id-ID")} sub={`C1: ${totalFreshC1} | C2: ${totalFreshC2}`} accent="blue" />
        <SummaryCard label="SD < 12PM %" value={`${hubSd12.toFixed(1)}%`} sub="Hub aggregate (C1)" accent="green" />
        <SummaryCard label="C1 / C2 Split" value={`${totalFreshC1} / ${totalFreshC2}`} sub={totalCarried > 0 ? `C1: ${((totalFreshC1 / totalCarried) * 100).toFixed(0)}% · C2: ${((totalFreshC2 / totalCarried) * 100).toFixed(0)}%` : ""} accent="purple" />
        <SummaryCard label="Overall Delivered %" value={`${overallDeliveredPct.toFixed(1)}%`} sub={`${totalDelivered} / ${totalCarried}`} accent="green" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center">
          <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>All</FilterBtn>
          <FilterBtn active={filter === "below97"} onClick={() => setFilter("below97")}>Below 97%</FilterBtn>
          <FilterBtn active={filter === "above97"} onClick={() => setFilter("above97")}>Above 97%</FilterBtn>
          {unassigned > 0 && (
            <span className="text-[10px] text-gray-500">+{unassigned} paket tanpa kurir</span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex rounded overflow-hidden border border-slate-600">
            <SubTabBtn active={tabMode === "ongoing"} onClick={() => setTabMode("ongoing")}>Ongoing</SubTabBtn>
            <SubTabBtn active={tabMode === "top10"} onClick={() => setTabMode("top10")}>Top 10</SubTabBtn>
          </div>
          <div className="flex rounded overflow-hidden border border-slate-600">
            <SubTabBtn active={subTab === "c1"} onClick={() => setSubTab("c1")}>On-Going C1</SubTabBtn>
            <SubTabBtn active={subTab === "overall"} onClick={() => setSubTab("overall")}>Overall</SubTabBtn>
          </div>
          <button onClick={downloadPNG} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-slate-700 text-gray-300 hover:bg-slate-600 border border-slate-600">
            <Download className="w-3.5 h-3.5" /> PNG
          </button>
          <button onClick={fetchData} disabled={loading} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div ref={tableRef} className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-slate-200">
            <thead className="bg-[#0f1e3d] text-white">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-left">Nama Kurir</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">Pembawaan Fresh C1</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">SD &lt;12PM %</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">Total Pembawaan</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">Total FTD</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">% Delivered</th>
              </tr>
            </thead>
            <tbody>
              {displayList.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-500">{loading ? "Loading..." : "Tidak ada data kurir untuk periode ini"}</td></tr>
              ) : (
                displayList.map((c) => (
                  <tr key={c.name} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-2.5 font-semibold text-white">{c.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.freshC1.toLocaleString("id-ID")}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-bold ${c.sd12Pct >= 80 ? "text-green-400" : c.sd12Pct >= 50 ? "text-amber-400" : "text-red-400"}`}>{c.sd12Pct.toFixed(1)}%</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">{c.totalCarried.toLocaleString("id-ID")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className="inline-flex min-w-12 justify-end rounded bg-red-950/30 px-2 py-1 font-bold text-red-400 ring-1 ring-inset ring-red-900/50">{c.totalFtd}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-bold ${c.deliveredPct >= 97 ? "text-green-400" : c.deliveredPct >= 90 ? "text-amber-400" : "text-red-400"}`}>{c.deliveredPct.toFixed(1)}%</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[10px] text-gray-500 py-2">
        Live courier tracking | Auto-refresh 60s | FTD cumulative (never decreases){ftdFrozen ? " | FTD FROZEN at 23:30 WIB" : ""} | {lastUpdate ? `Last: ${lastUpdate.toLocaleTimeString("id-ID")}` : ""}
      </p>
    </div>
  );
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  const colors: Record<string, string> = { blue: "border-l-blue-500", green: "border-l-green-500", purple: "border-l-purple-500" };
  return (
    <div className={`bg-slate-800/60 rounded border border-slate-700 border-l-4 ${colors[accent] || ""} px-4 py-3`}>
      <p className="text-[10px] font-bold text-gray-400 tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1.5">{value}</p>
      <p className="text-[10px] text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-xs px-3 py-1.5 rounded border transition ${active ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-800 border-slate-600 text-gray-400 hover:bg-slate-700"}`}>
      {children}
    </button>
  );
}

function SubTabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-xs px-3 py-1.5 transition ${active ? "bg-blue-600 text-white" : "bg-slate-800 text-gray-400 hover:bg-slate-700"}`}>
      {children}
    </button>
  );
}
