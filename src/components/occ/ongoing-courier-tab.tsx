import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { RefreshCw, Download, AlertTriangle } from "lucide-react";

type CourierRow = {
  name: string;
  freshC1: number;
  c1Delivered: number;
  c1Ftd: number;
  sd12Pct: number;
  totalCarried: number;
  totalFtd: number;
  deliveredPct: number;
  delivered: number;
  ongoing: number;
};

type Totals = {
  couriers: number;
  total_carried: number;
  fresh_c1: number;
  fresh_c2: number;
  delivered: number;
  total_ftd: number;
  sd_before_12: number;
  delivered_pct: number;
};

type FilterMode = "all" | "below97" | "above97";
type TabMode = "ongoing" | "top10";
type SubTabMode = "c1" | "overall";

export default function OngoingCourierTab({ hubId }: { hubId: string }) {
  const [couriers, setCouriers] = useState<CourierRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [tabMode, setTabMode] = useState<TabMode>("ongoing");
  const [subTab, setSubTab] = useState<SubTabMode>("c1");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hms/couriers?hubId=${hubId}`);
      const d = await res.json();
      if (d.success && Array.isArray(d.couriers)) {
        setCouriers(d.couriers);
        setTotals(d.totals || null);
        setLastUpdate(new Date());
        setError(
          d.meta?.cycle_errors?.length
            ? `Sebagian cycle gagal: ${d.meta.cycle_errors.join("; ")}`
            : null
        );
      } else {
        setError(d.message || d.error || d.detail || `HMS error (HTTP ${res.status})`);
      }
    } catch (e) {
      console.error("Courier fetch error:", e);
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

  // "On-Going C1" = couriers who carried fresh C1 packages, "Overall" = everyone.
  const scoped = couriers.filter((c) =>
    subTab === "c1" ? c.freshC1 > 0 : c.totalCarried > 0
  );

  const filtered = scoped.filter((c) => {
    if (filter === "below97") return c.deliveredPct < 97;
    if (filter === "above97") return c.deliveredPct >= 97;
    return true;
  });

  const displayList = (
    tabMode === "ongoing" ? filtered.filter((c) => c.ongoing > 0) : filtered
  )
    .sort((a, b) => b.totalCarried - a.totalCarried)
    .slice(0, tabMode === "top10" ? 10 : undefined);

  const totalCarried = totals?.total_carried ?? 0;
  const totalFreshC1 = totals?.fresh_c1 ?? 0;
  const totalFreshC2 = totals?.fresh_c2 ?? 0;
  const hubSd12 = totals?.sd_before_12 ?? 0;
  const overallDeliveredPct = totals?.delivered_pct ?? 0;
  const totalDelivered = totals?.delivered ?? 0;
  const ongoingCouriers = scoped.filter((c) => c.ongoing > 0).length;

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
            <p className="font-semibold">Data kurir belum lengkap</p>
            <p className="mt-0.5 text-red-400/80">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Total Carried"
          value={totalCarried.toLocaleString("id-ID")}
          sub={`C1: ${totalFreshC1.toLocaleString("id-ID")} | C2: ${totalFreshC2.toLocaleString("id-ID")}`}
          accent="blue"
        />
        <SummaryCard
          label="SD < 12PM %"
          value={`${hubSd12.toFixed(1)}%`}
          sub="Hub aggregate (C1 packages)"
          accent="green"
        />
        <SummaryCard
          label="C1 / C2 Split"
          value={`${totalFreshC1.toLocaleString("id-ID")} / ${totalFreshC2.toLocaleString("id-ID")}`}
          sub={
            totalCarried > 0
              ? `C1: ${((totalFreshC1 / totalCarried) * 100).toFixed(0)}% - C2: ${((totalFreshC2 / totalCarried) * 100).toFixed(0)}%`
              : ""
          }
          accent="purple"
        />
        <SummaryCard
          label="Overall Delivered %"
          value={`${overallDeliveredPct.toFixed(1)}%`}
          sub={`${totalDelivered.toLocaleString("id-ID")} / ${totalCarried.toLocaleString("id-ID")}`}
          accent="green"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center">
          <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>All</FilterBtn>
          <FilterBtn active={filter === "below97"} onClick={() => setFilter("below97")}>Below 97%</FilterBtn>
          <FilterBtn active={filter === "above97"} onClick={() => setFilter("above97")}>Above 97%</FilterBtn>
          <span className="text-[10px] text-gray-500">
            {ongoingCouriers} kurir masih bawa paket | {totals?.total_ftd ?? 0} FTD
          </span>
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
          <button
            onClick={downloadPNG}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-slate-700 text-gray-300 hover:bg-slate-600 border border-slate-600"
          >
            <Download className="w-3.5 h-3.5" /> PNG
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
          >
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
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    {loading ? "Loading..." : "Tidak ada data kurir untuk periode ini"}
                  </td>
                </tr>
              ) : (
                displayList.map((c) => (
                  <tr key={c.name} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-2.5 font-semibold text-white">{c.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.freshC1.toLocaleString("id-ID")}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`font-bold ${
                          c.sd12Pct >= 80 ? "text-green-400" : c.sd12Pct >= 50 ? "text-amber-400" : "text-red-400"
                        }`}
                      >
                        {c.sd12Pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">
                      {c.totalCarried.toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className="inline-flex min-w-12 justify-end rounded bg-red-950/30 px-2 py-1 font-bold text-red-400 ring-1 ring-inset ring-red-900/50">
                        {c.totalFtd}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`font-bold ${
                          c.deliveredPct >= 97 ? "text-green-400" : c.deliveredPct >= 90 ? "text-amber-400" : "text-red-400"
                        }`}
                      >
                        {c.deliveredPct.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[10px] text-gray-500 py-2">
        HMS driver productivity (cycle 1-3) | Auto-refresh 60s |{" "}
        {lastUpdate ? `Last: ${lastUpdate.toLocaleTimeString("id-ID")}` : ""}
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  const colors: Record<string, string> = {
    blue: "border-l-blue-500",
    green: "border-l-green-500",
    purple: "border-l-purple-500",
  };
  return (
    <div className={`bg-slate-800/60 rounded border border-slate-700 border-l-4 ${colors[accent] || ""} px-4 py-3`}>
      <p className="text-[10px] font-bold text-gray-400 tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1.5">{value}</p>
      <p className="text-[10px] text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded border transition ${
        active ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-800 border-slate-600 text-gray-400 hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function SubTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 transition ${
        active ? "bg-blue-600 text-white" : "bg-slate-800 text-gray-400 hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
