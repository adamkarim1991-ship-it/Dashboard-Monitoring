"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Download } from "lucide-react";

type CourierRow = {
  name: string;
  freshC1: number;
  sd12Pct: number;
  totalCarried: number;
  totalFtd: number;
  deliveredPct: number;
};

type FilterMode = "all" | "below97" | "above97";
type TabMode = "ongoing" | "top10";
type SubTabMode = "c1" | "overall";

export default function OngoingCourierTab({ hubId }: { hubId: string }) {
  const [couriers, setCouriers] = useState<CourierRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [tabMode, setTabMode] = useState<TabMode>("ongoing");
  const [subTab, setSubTab] = useState<SubTabMode>("c1");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [ftdMap, setFtdMap] = useState<Map<string, number>>(new Map());
  const tableRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hms/performance?hubId=${hubId}`);
      const d = await res.json();
      if (d.success && d.shipments) {
        processShipments(d.shipments);
        setLastUpdate(new Date());
      }
    } catch (e) { console.error("Courier fetch error:", e); }
    finally { setLoading(false); }
  }, [hubId]);

  const processShipments = (shipments: any[]) => {
    const courierMap = new Map<string, {
      freshC1: number; sd12Delivered: number; totalCarried: number;
      totalDelivered: number; totalFtd: number;
    }>();

    const todayWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const todayStart = new Date(Date.UTC(todayWIB.getUTCFullYear(), todayWIB.getUTCMonth(), todayWIB.getUTCDate(), 0, 0, 0));
    todayStart.setHours(todayStart.getHours() - 7);
    const todayStartUnix = Math.floor(todayStart.getTime() / 1000);
    const c1End = new Date(Date.UTC(todayWIB.getUTCFullYear(), todayWIB.getUTCMonth(), todayWIB.getUTCDate(), 8, 0, 0));
    c1End.setHours(c1End.getHours() - 7);
    const c1EndUnix = Math.floor(c1End.getTime() / 1000);
    const noonEnd = new Date(Date.UTC(todayWIB.getUTCFullYear(), todayWIB.getUTCMonth(), todayWIB.getUTCDate(), 12, 0, 0));
    noonEnd.setHours(noonEnd.getHours() - 7);
    const noonEndUnix = Math.floor(noonEnd.getTime() / 1000);

    for (const s of shipments) {
      const driverName = s.driver?.name || s.driver_name || s.courier_name || "Unknown";
      if (!courierMap.has(driverName)) {
        courierMap.set(driverName, { freshC1: 0, sd12Delivered: 0, totalCarried: 0, totalDelivered: 0, totalFtd: 0 });
      }
      const c = courierMap.get(driverName)!;
      c.totalCarried++;

      const status = String(s.status || "").toLowerCase().trim();
      if (status === "delivered") c.totalDelivered++;
      if (status === "ftd" || status === "failed_to_deliver" || status === "failed") c.totalFtd++;

      const createdAt = typeof s.created_at === "number" ? (s.created_at > 1e12 ? Math.floor(s.created_at / 1000) : s.created_at) : 0;
      if (createdAt >= todayStartUnix && createdAt < c1EndUnix) {
        c.freshC1++;
        if (status === "delivered") {
          const deliveredAt = typeof s.destination_details?.delivery_time === "number"
            ? (s.destination_details.delivery_time > 1e12 ? Math.floor(s.destination_details.delivery_time / 1000) : s.destination_details.delivery_time)
            : 0;
          if (deliveredAt >= todayStartUnix && deliveredAt < noonEndUnix) c.sd12Delivered++;
        }
      }
    }

    const rows: CourierRow[] = [];
    for (const [name, data] of courierMap.entries()) {
      const sd12Pct = data.freshC1 > 0 ? (data.sd12Delivered / data.freshC1) * 100 : 0;
      const deliveredPct = data.totalCarried > 0 ? (data.totalDelivered / data.totalCarried) * 100 : 0;

      // FTD cumulative - merge with stored FTD
      const storedFtd = ftdMap.get(name) || 0;
      const effectiveFtd = Math.max(data.totalFtd, storedFtd);
      setFtdMap(prev => {
        const next = new Map(prev);
        next.set(name, effectiveFtd);
        return next;
      });

      rows.push({ name, freshC1: data.freshC1, sd12Pct, totalCarried: data.totalCarried, totalFtd: effectiveFtd, deliveredPct });
    }

    setCouriers(rows.sort((a, b) => b.totalCarried - a.totalCarried));
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  // Filter + sort
  const filtered = couriers.filter((c) => {
    if (filter === "all") return true;
    if (filter === "below97") return c.deliveredPct < 97;
    if (filter === "above97") return c.deliveredPct >= 97;
    return true;
  });

  const displayed = subTab === "c1" ? filtered.filter(c => c.freshC1 > 0) : filtered;

  const displayList = tabMode === "top10" ? [...displayed].sort((a, b) => b.totalCarried - a.totalCarried).slice(0, 10) : displayed;

  // Aggregates
  const totalCarried = couriers.reduce((s, c) => s + c.totalCarried, 0);
  const totalFreshC1 = couriers.reduce((s, c) => s + c.freshC1, 0);
  const totalFreshC2 = totalCarried - totalFreshC1;
  const avgSd12 = couriers.length > 0 ? couriers.reduce((s, c) => s + c.sd12Pct, 0) / couriers.length : 0;
  const overallDeliveredPct = totalCarried > 0 ? (couriers.reduce((s, c) => s + (c.totalCarried * c.deliveredPct / 100), 0) / totalCarried * 100) : 0;

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
      alert("html2canvas not available for PNG export. Run: npm install html2canvas");
    }
  };

  return (
    <div className="px-6 py-4 space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Carried" value={totalCarried.toLocaleString("id-ID")} sub={`C1: ${totalFreshC1} | C2: ${totalFreshC2}`} accent="blue" />
        <SummaryCard label="SD < 12PM %" value={`${avgSd12.toFixed(1)}%`} sub="Hub aggregate" accent="green" />
        <SummaryCard label="C1 / C2 Split" value={`${totalFreshC1} / ${totalFreshC2}`} sub={totalCarried > 0 ? `C1: ${((totalFreshC1/totalCarried)*100).toFixed(0)}% · C2: ${((totalFreshC2/totalCarried)*100).toFixed(0)}%` : ""} accent="purple" />
        <SummaryCard label="Overall Delivered %" value={`${overallDeliveredPct.toFixed(1)}%`} sub={`${couriers.reduce((s,c)=>s+(c.totalCarried*c.deliveredPct/100),0).toFixed(0)} / ${totalCarried}`} accent="green" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>All</FilterBtn>
          <FilterBtn active={filter === "below97"} onClick={() => setFilter("below97")}>Below 97%</FilterBtn>
          <FilterBtn active={filter === "above97"} onClick={() => setFilter("above97")}>Above 97%</FilterBtn>
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

      {/* Table */}
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
                <tr><td colSpan={6} className="py-8 text-center text-slate-500">{loading ? "Loading..." : "No courier data"}</td></tr>
              ) : (
                displayList.map((c, i) => (
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
        Live courier tracking | Auto-refresh 60s | FTD cumulative (never decreases) | {lastUpdate ? `Last: ${lastUpdate.toLocaleTimeString("id-ID")}` : ""}
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