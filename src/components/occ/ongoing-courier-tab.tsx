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

  const downloadPNG = () => {
    // Light-theme canvas render, drawn from the rows already on screen. DOM
    // screenshot libraries either choke on the Tailwind oklch() colours
    // (html2canvas) or hang on the SVG pass (html-to-image), and a hand drawn
    // canvas also guarantees every row and column lands in the file. Large type
    // and a 4x pixel ratio keep it readable on a phone without zooming.
    const rows = displayList;
    const SCALE = 4;
    const MAX_PIXELS = 100_000_000;
    const family = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

    const columns: {
      label: string;
      align: "left" | "right";
      baseWidth: number;
      value: (c: CourierRow) => string;
    }[] = [
      { label: "Nama Kurir", align: "left", baseWidth: 280, value: (c) => c.name },
      { label: "Pembawaan Fresh C1", align: "right", baseWidth: 160, value: (c) => c.freshC1.toLocaleString("id-ID") },
      { label: "SD <12PM %", align: "right", baseWidth: 130, value: (c) => `${c.sd12Pct.toFixed(1)}%` },
      { label: "Total Pembawaan", align: "right", baseWidth: 150, value: (c) => c.totalCarried.toLocaleString("id-ID") },
      { label: "Total FTD", align: "right", baseWidth: 120, value: (c) => c.totalFtd.toLocaleString("id-ID") },
      { label: "Delivered", align: "right", baseWidth: 120, value: (c) => c.delivered.toLocaleString("id-ID") },
      { label: "% Delivered", align: "right", baseWidth: 130, value: (c) => `${c.deliveredPct.toFixed(1)}%` },
    ];

    // Logical layout (multiplied by SCALE when drawn).
    const padX = 28;
    const titleBlock = 156;
    const headHeight = 68;
    const rowHeight = 56;
    const footerHeight = 66;
    const minTableWidth = 1600;

    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    measure.font = `700 20px ${family}`;
    const colWidths = columns.map((c) => Math.max(c.baseWidth, measure.measureText(c.label).width + 24));
    let tableWidth = colWidths.reduce((a, b) => a + b, 0);
    // Widen every column evenly instead of leaving a big empty gutter.
    while (tableWidth < minTableWidth) {
      const bump = Math.min(40, Math.ceil((minTableWidth - tableWidth) / colWidths.length));
      colWidths.forEach((w, i) => (colWidths[i] = w + bump));
      tableWidth = colWidths.reduce((a, b) => a + b, 0);
    }

    const logicalWidth = tableWidth + padX * 2;
    const logicalHeight = titleBlock + headHeight + rows.length * rowHeight + footerHeight;
    const scale = Math.min(SCALE, Math.sqrt(MAX_PIXELS / (logicalWidth * logicalHeight)));
    const S = Math.max(scale, 1);
    const px = (value: number) => Math.round(value * S);

    const canvas = document.createElement("canvas");
    canvas.width = px(logicalWidth);
    canvas.height = px(logicalHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fontTitle = `800 ${px(28)}px ${family}`;
    const fontSub = `500 ${px(20)}px ${family}`;
    const fontHead = `700 ${px(20)}px ${family}`;
    const fontName = `700 ${px(18)}px ${family}`;
    const fontBody = `600 ${px(18)}px ${family}`;
    const fontFooter = `500 ${px(16)}px ${family}`;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = "middle";

    const now = new Date();
    const dateLabel = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(now);
    const timeLabel = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
    }).format(now);

    ctx.textAlign = "left";
    ctx.fillStyle = "#111111";
    ctx.font = fontTitle;
    ctx.fillText("OCC COURIER REPORT", px(padX), px(titleBlock * 0.3));
    ctx.fillStyle = "#4b5563";
    ctx.font = fontSub;
    ctx.fillText(
      `GTL Jatinegara Hub  |  ${dateLabel} ${timeLabel} WIB  |  ${rows.length} kurir`,
      px(padX),
      px(titleBlock * 0.62)
    );
    ctx.textAlign = "right";
    ctx.fillStyle = "#111827";
    ctx.fillText(
      `Total ${totalCarried.toLocaleString("id-ID")} | Delivered ${totalDelivered.toLocaleString("id-ID")} | FTD ${(totals?.total_ftd ?? 0).toLocaleString("id-ID")} | ${overallDeliveredPct.toFixed(1)}%`,
      px(logicalWidth - padX),
      px(titleBlock * 0.62)
    );

    // Header band
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, px(titleBlock), canvas.width, px(headHeight));
    ctx.font = fontHead;
    ctx.fillStyle = "#ffffff";
    let headX = px(padX);
    columns.forEach((c, i) => {
      ctx.textAlign = c.align === "right" ? "right" : "left";
      const cx = c.align === "right" ? headX + px(colWidths[i]) - px(padX) : headX;
      ctx.fillText(c.label.toUpperCase(), cx, px(titleBlock + headHeight / 2));
      headX += px(colWidths[i]);
    });

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, w, h, r);
        return;
      }
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    const drawBadge = (
      text: string,
      rightEdge: number,
      centerY: number,
      background: string,
      foreground = "#ffffff"
    ) => {
      ctx.font = fontBody;
      const textWidth = ctx.measureText(text).width;
      const badgeW = textWidth + px(26);
      const badgeH = px(34);
      const badgeX = rightEdge - badgeW;
      ctx.fillStyle = background;
      roundRect(badgeX, centerY - badgeH / 2, badgeW, badgeH, px(7));
      ctx.fill();
      ctx.fillStyle = foreground;
      ctx.textAlign = "center";
      ctx.fillText(text, badgeX + badgeW / 2, centerY);
    };

    const bodyTop = titleBlock + headHeight;
    rows.forEach((row, rowIndex) => {
      const top = bodyTop + rowIndex * rowHeight;
      ctx.fillStyle = rowIndex % 2 === 0 ? "#f8f9fa" : "#ffffff";
      ctx.fillRect(0, px(top), canvas.width, px(rowHeight));
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = Math.max(1, px(1));
      ctx.beginPath();
      ctx.moveTo(0, px(top + rowHeight));
      ctx.lineTo(canvas.width, px(top + rowHeight));
      ctx.stroke();

      const centerY = px(top + rowHeight / 2);
      let cellX = padX;
      columns.forEach((c, i) => {
        const columnRight = cellX + colWidths[i] - padX;
        if (c.label === "Nama Kurir") {
          ctx.textAlign = "left";
          ctx.font = fontName;
          ctx.fillStyle = "#111111";
          ctx.fillText(c.value(row), px(cellX), centerY);
        } else if (c.label === "Total FTD") {
          if (row.totalFtd > 0) drawBadge(c.value(row), px(columnRight), centerY, "#dc2626");
          else {
            ctx.textAlign = "right";
            ctx.font = fontBody;
            ctx.fillStyle = "#9ca3af";
            ctx.fillText(c.value(row), px(columnRight), centerY);
          }
        } else if (c.label === "Delivered") {
          if (row.delivered > 0) drawBadge(c.value(row), px(columnRight), centerY, "#16a34a");
          else {
            ctx.textAlign = "right";
            ctx.font = fontBody;
            ctx.fillStyle = "#9ca3af";
            ctx.fillText(c.value(row), px(columnRight), centerY);
          }
        } else if (c.label === "% Delivered") {
          ctx.textAlign = "right";
          ctx.font = fontBody;
          ctx.fillStyle =
            row.deliveredPct >= 97 ? "#16a34a" : row.deliveredPct >= 90 ? "#b45309" : "#dc2626";
          ctx.fillText(c.value(row), px(columnRight), centerY);
        } else {
          ctx.textAlign = "right";
          ctx.font = fontBody;
          ctx.fillStyle = "#374151";
          ctx.fillText(c.value(row), px(columnRight), centerY);
        }
        cellX += colWidths[i];
      });
    });

    ctx.textAlign = "left";
    ctx.font = fontFooter;
    ctx.fillStyle = "#6b7280";
    ctx.fillText(
      "Sumber: HMS driver productivity (cycle 1-3) - filter Ongoing Courier",
      px(padX),
      px(logicalHeight - footerHeight / 2)
    );

    const dateWib = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    saveDataUrl(canvas.toDataURL("image/png"), `courier-report-${dateWib}.png`);
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
