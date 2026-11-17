import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import domtoimage from "dom-to-image-more";
import { accumulateFtd, emptyFtdRecord, ftdStorageKey, getWibDate, parseFtdRecord, validCount, validSample, type FtdRecordState } from "@/lib/ftd-record";
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

function getSDColor(pct: number) {
  if (pct >= 90) return "#00AA00";
  const ratio = Math.max(0, pct) / 90;
  if (ratio < 0.5) {
    const r = 204;
    const g = Math.round(ratio * 2 * 204);
    return `rgb(${r},${g},0)`;
  }
  const r = Math.round((1 - (ratio - 0.5) * 2) * 204);
  const g = 170;
  return `rgb(${r},${g},0)`;
}
function saveDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function OngoingCourierTab({ hubId }: { hubId: string }) {
  const [couriers, setCouriers] = useState<CourierRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [tabMode, setTabMode] = useState<TabMode>("ongoing");
  const [subTab, setSubTab] = useState<SubTabMode>("c1");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [ftdRecord, setFtdRecord] = useState<FtdRecordState | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const [today, setToday] = useState(() => getWibDate());
  const [selectedDate, setSelectedDate] = useState(() => getWibDate());
  const activeHub = useRef(hubId);
  activeHub.current = hubId;
  const requestId = useRef(0);

  const loadFtdRecord = (date: string) => {
    try { return parseFtdRecord(localStorage.getItem(ftdStorageKey(hubId, date)), hubId, date); }
    catch { return null; }
  };
  const saveFtdRecord = (next: FtdRecordState) => {
    try { localStorage.setItem(ftdStorageKey(next.hubId, next.dateWib), JSON.stringify(next)); }
    catch { setError("FTD record could not be saved in this browser."); }
  };

  const fetchData = useCallback(async () => {
    if (!hubId) return;
    const day = getWibDate();
    const id = ++requestId.current;
    const isCurrent = () => activeHub.current === hubId && getWibDate() === day && requestId.current === id;
    setLoading(true);
    try {
      const res = await fetch(`/api/hms/couriers?hubId=${hubId}`);
      const d = await res.json();
      if (!isCurrent()) return;
      if (d.success && Array.isArray(d.couriers)) {
        const safeCouriers = d.couriers.filter((c: CourierRow) => validSample(c) && [c.freshC1, c.c1Delivered, c.c1Ftd, c.sd12Pct, c.totalCarried, c.deliveredPct, c.delivered, c.ongoing].every(validCount));
        setCouriers(safeCouriers);
        setTotals(d.totals || null);
        setLastUpdate(new Date());
        const incomplete = d.meta?.complete === false || d.meta?.cycle_errors?.length > 0 || safeCouriers.length !== d.couriers.length;
        setError(incomplete ? "Data incomplete: FTD record and baseline were not updated." : null);
        if (!incomplete) {
          const next = accumulateFtd(loadFtdRecord(day), hubId, d.couriers);
          setFtdRecord(next);
          saveFtdRecord(next);
        }
      } else {
        setError(d.message || d.error || d.detail || `HMS error (HTTP ${res.status})`);
      }
    } catch (e) {
      if (isCurrent()) {
        console.error("Courier fetch error:", e);
        setError("Tidak dapat menghubungi server HMS.");
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
    // Storage functions only depend on hubId; record/selection changes must not restart fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId]);

  useEffect(() => {
    const day = getWibDate();
    setToday(day);
    setSelectedDate(day);
    setFtdRecord(loadFtdRecord(day) ?? emptyFtdRecord(hubId, day));
    setCouriers([]);
    setTotals(null);
    setLastUpdate(null);
    setError(null);
    setLoading(false);
    fetchData();
    const t = setInterval(fetchData, 300000);
    const midnight = setInterval(() => {
      const nextDay = getWibDate();
      if (nextDay === dayRef.current) return;
      dayRef.current = nextDay;
      setToday(nextDay);
      setSelectedDate(nextDay);
      setFtdRecord(loadFtdRecord(nextDay) ?? emptyFtdRecord(hubId, nextDay));
      setCouriers([]);
      setTotals(null);
      setLastUpdate(null);
      setError(null);
      fetchData();
    }, 30000);
    dayRef.current = day;
    return () => { clearInterval(t); clearInterval(midnight); ++requestId.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, hubId]);
  const dayRef = useRef(today);

  const recordForView = selectedDate === today
    ? (ftdRecord?.hubId === hubId && ftdRecord.dateWib === today ? ftdRecord : null)
    : loadFtdRecord(selectedDate);
  const availableDates = (() => {
    const dates = new Set([today]);
    try {
      const prefix = `occ_ftd_record_v2_${hubId}_`;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const date = key.slice(prefix.length);
          if (/^\d{4}-\d{2}-\d{2}$/.test(date) && loadFtdRecord(date)) dates.add(date);
        }
      }
    } catch { /* Browser storage unavailable. */ }
    return [...dates].sort().reverse();
  })();

  // "On-Going C1" = couriers who carried fresh C1 packages, "Overall" = everyone.
  const scoped = couriers.filter((c) =>
    subTab === "c1" ? c.freshC1 > 0 : c.totalCarried > 0 || c.ongoing > 0
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

  const ftdTop = Object.values(recordForView?.entries ?? {})
    .sort((a, b) => b.ftdToday - a.ftdToday)
    .slice(0, 10);

  const resetFtdRecord = () => {
    const day = getWibDate();
    if (!hubId || selectedDate !== day || !window.confirm("Reset only today's browser-local FTD record? Other days and legacy records are kept.")) return;
    const next = emptyFtdRecord(hubId, day);
    setFtdRecord(next);
    saveFtdRecord(next);
  };

  const downloadPNG = async () => {
    console.log("[PNG Export] start");
    const exportRows = displayList;
    if (exportRows.length === 0) {
      alert("No courier data to export.");
      return;
    }

    const printDiv = document.createElement("div");
    printDiv.setAttribute("data-export-sandbox", "occ-ongoing-courier-print");
    printDiv.style.position = "fixed";
    printDiv.style.left = "0";
    printDiv.style.top = "0";
    printDiv.style.pointerEvents = "none";
    printDiv.style.opacity = "1";
    printDiv.style.zIndex = "2147483647";
    printDiv.style.background = "#ffffff";
    printDiv.style.padding = "12px";
    printDiv.style.fontFamily = "Arial, Helvetica, sans-serif";
    printDiv.style.color = "#000000";

    const title = document.createElement("div");
    title.textContent = "OCC Delivery Nerve Report";
    title.style.fontSize = "18px";
    title.style.fontWeight = "700";
    title.style.marginBottom = "8px";
    title.style.color = "#000";
    printDiv.appendChild(title);

    const table = document.createElement("table");
    table.style.borderCollapse = "collapse";
    table.style.width = "100%";
    table.style.minWidth = "980px";
    table.style.fontSize = "14px";
    table.style.lineHeight = "1.2";

    const headers = [
      "Nama Kurir",
      "Pembawaan Fresh C1",
      "SD <12PM %",
      "Total Pembawaan",
      "Total FTD",
      "Delivered",
      "% Delivered",
    ];

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      th.style.background = "#FFD700";
      th.style.color = "#000";
      th.style.fontWeight = "700";
      th.style.border = "1px solid #000";
      th.style.padding = "8px 10px";
      th.style.textAlign = h === "Nama Kurir" ? "left" : "right";
      th.style.whiteSpace = "nowrap";
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    exportRows.forEach((c, i) => {
      const tr = document.createElement("tr");
      tr.style.background = i % 2 === 0 ? "#ffffff" : "#f9f9f9";



      const cells: Array<{
        value: string;
        align?: "left" | "right";
        color?: string;
        weight?: string;
      }> = [
        { value: c.name, align: "left", color: "#000", weight: "600" },
        { value: c.freshC1.toLocaleString("id-ID"), align: "right", color: "#000", weight: "600" },
        {
          value: `${c.sd12Pct.toFixed(1)}%`,
          align: "right",
          color: getSDColor(c.sd12Pct),
          weight: "700",
        },
        { value: c.totalCarried.toLocaleString("id-ID"), align: "right", color: "#000", weight: "600" },
        {
          value: c.totalFtd.toLocaleString("id-ID"),
          align: "right",
          color: c.totalFtd > 5 ? "#CC0000" : "#000",
          weight: c.totalFtd > 5 ? "700" : "400",
        },
        { value: c.delivered.toLocaleString("id-ID"), align: "right", color: "#000", weight: "600" },
        {
          value: `${c.deliveredPct.toFixed(1)}%`,
          align: "right",
          color: c.deliveredPct >= 96 ? "#00AA00" : "#CC0000",
          weight: "700",
        },
      ];

      cells.forEach((cell) => {
        const td = document.createElement("td");
        td.textContent = cell.value;
        td.style.border = "1px solid #000";
        td.style.padding = "8px 10px";
        td.style.color = cell.color || "#000";
        td.style.fontWeight = cell.weight || "600";
        td.style.textAlign = cell.align || "left";
        td.style.whiteSpace = "nowrap";
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    printDiv.appendChild(table);
    document.body.appendChild(printDiv);

    try {
      await new Promise((r) => setTimeout(r, 50));

      const dataUrl = await Promise.race([
        domtoimage.toPng(printDiv, {
          bgcolor: "#ffffff",
          scale: 2,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("PNG export timeout")), 120000)
        ),
      ]);

      const now = new Date();
      const dateWib = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);

      console.log("[PNG Export] dataUrl length", dataUrl.length);
      saveDataUrl(dataUrl, "courier-report-print-" + dateWib + ".png");
    } catch (e) {
      console.error("PNG export error:", e);
      alert("PNG export failed. Please try again.");
    } finally {
      printDiv.remove();
    }
  };

  return (
    <div className="px-3 py-4 space-y-4 sm:px-6">
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


      <div className="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <p className="text-sm font-semibold text-white">FTD Record Tracker</p>
            <p className="text-[10px] text-slate-400">Daily cumulative (WIB), browser-local from first observation. Earlier lost counts cannot be restored; daily archives are kept.</p>
          </div>
          <div className="flex items-center gap-2">
            <select aria-label="FTD record date (WIB)" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="text-[10px] bg-slate-900 text-slate-300">{availableDates.map(date => <option key={date} value={date}>{date}</option>)}</select>
            <button
              onClick={resetFtdRecord}
              disabled={selectedDate !== today}
              className="text-[10px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
              title="Reset todays tracker"
            >
              Reset
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs text-slate-200">
            <thead className="bg-slate-800/60 text-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">#</th>
                <th className="px-3 py-2 text-left font-semibold">Nama Kurir</th>
                <th className="px-3 py-2 text-right font-semibold">FTD Saat Ini</th>
                <th className="px-3 py-2 text-right font-semibold">FTD Record Hari Ini</th>
              </tr>
            </thead>
            <tbody>
              {ftdTop.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    Tracker will populate after the next refresh.
                  </td>
                </tr>
              ) : (
                ftdTop.map((r, idx) => (
                  <tr key={r.name} className="border-t border-slate-800">
                    <td className="px-3 py-2 text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-semibold text-white whitespace-nowrap">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.currentFtd}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{r.ftdToday}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
        <div data-table-scroll className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[15px] leading-relaxed md:min-w-0 md:text-xs md:leading-normal text-slate-200">
            <thead className="bg-[#0f1e3d] text-white">
              <tr>
                <th className="whitespace-nowrap px-3 py-3.5 md:px-4 md:py-3 text-[12px] md:text-xs font-semibold text-left">Nama Kurir</th>
                <th className="whitespace-nowrap px-3 py-3.5 md:px-4 md:py-3 text-[12px] md:text-xs font-semibold text-right">Pembawaan Fresh C1</th>
                <th className="whitespace-nowrap px-3 py-3.5 md:px-4 md:py-3 text-[12px] md:text-xs font-semibold text-right">SD &lt;12PM %</th>
                <th className="whitespace-nowrap px-3 py-3.5 md:px-4 md:py-3 text-[12px] md:text-xs font-semibold text-right">Total Pembawaan</th>
                <th className="whitespace-nowrap px-3 py-3.5 md:px-4 md:py-3 text-[12px] md:text-xs font-semibold text-right">Total FTD</th>
                <th className="whitespace-nowrap px-3 py-3.5 md:px-4 md:py-3 text-[12px] md:text-xs font-semibold text-right">Delivered</th>
                <th className="whitespace-nowrap px-3 py-3.5 md:px-4 md:py-3 text-[12px] md:text-xs font-semibold text-right">% Delivered</th>
              </tr>
            </thead>
            <tbody>
              {displayList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    {loading ? "Loading..." : "Tidak ada data kurir untuk periode ini"}
                  </td>
                </tr>
              ) : (
                displayList.map((c) => (
                  <tr key={c.name} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="whitespace-nowrap px-3 py-3.5 md:px-4 md:py-2.5 font-semibold text-white">{c.name}</td>
                    <td className="px-3 py-3.5 md:px-4 md:py-2.5 text-right tabular-nums">{c.freshC1.toLocaleString("id-ID")}</td>
                    <td className="px-3 py-3.5 md:px-4 md:py-2.5 text-right">
                      <span
                        className={`font-bold ${
                          c.sd12Pct >= 80 ? "text-green-400" : c.sd12Pct >= 50 ? "text-amber-400" : "text-red-400"
                        }`}
                      >
                        {c.sd12Pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-3.5 md:px-4 md:py-2.5 text-right tabular-nums font-bold text-white">
                      {c.totalCarried.toLocaleString("id-ID")}
                    </td>
                    <td className="px-3 py-3.5 md:px-4 md:py-2.5 text-right tabular-nums">
                      <span className="inline-flex min-w-14 justify-end rounded bg-red-950/30 px-2 py-1 font-bold text-red-400 ring-1 ring-inset ring-red-900/50">
                        {c.totalFtd}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 md:px-4 md:py-2.5 text-right tabular-nums">
                      <span className="inline-flex min-w-14 justify-end rounded bg-emerald-950/30 px-2 py-1 font-bold text-emerald-400 ring-1 ring-inset ring-emerald-900/50">
                        {c.delivered.toLocaleString("id-ID")}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 md:px-4 md:py-2.5 text-right">
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
        Delivery Nerve - Ongoing driver performance | Auto-refresh 60s |{" "}
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












