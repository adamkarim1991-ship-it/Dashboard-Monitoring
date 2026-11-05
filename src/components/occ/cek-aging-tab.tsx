"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Upload, FileSpreadsheet, X, AlertTriangle, Loader2, Download, Search,
  ChevronDown, ChevronRight, PencilLine,
} from "lucide-react";

type HmsInfo = {
  found: boolean;
  statusLabel: string;
  rawStatus: string;
  logType: string;
  actualHub: string;
  serviceType: string;
  lastScanAt: number | null;
  detail: string;
};

type AgingRow = {
  id: number;
  aging: number | null;
  agingLabel: string;
  agingBucket: string;
  awb: string;
  remarks: string;
  hms: HmsInfo | null;
};

type PivotChild = { key: string; label: string; total: number; cells: Record<string, number> };
type PivotRow = { status: string; total: number; cells: Record<string, number>; children: PivotChild[] };
type Pivot = {
  rows: PivotRow[];
  agings: string[];
  colTotals: Record<string, number>;
  grandTotal: number;
  statusCount: number;
  remarksCount: number;
};

const STATUS_PENDING = "Fetching\u2026";
const STATUS_NOT_FOUND = "Not found in HMS";
const STATUS_FAILED = "HMS fetch failed";

const AGING_KEYS = ["aging", "aging group", "aging days", "aging day", "umur", "aging (day)", "grim aging"];
const AWB_KEYS = ["airwaybill", "awb", "airwaybill no", "no airwaybill", "no. airwaybill", "waybill", "awb number", "awb #", "airwaybill#"];
const REMARK_KEYS = ["remarks", "remark", "keterangan", "note", "notes", "catatan"];

const BLANK = "(blank)";
const EMPTY_STATUS = "-";
const BUCKETS = ["0-1d", "2-3d", "4-7d", "7d+"];
const BUCKET_ORDER = [...BUCKETS, BLANK];
const MAX_CONCURRENT_HMS = 8;

function normKey(k: string) {
  return String(k || "").toLowerCase().replace(/[\s_]+/g, " ").trim();
}
function findColumn(headers: string[], aliases: string[]): string | null {
  const normed = headers.map((h) => ({ raw: h, key: normKey(h) }));
  for (const a of aliases) {
    const exact = normed.find((h) => h.key === a);
    if (exact) return exact.raw;
  }
  for (const a of aliases) {
    const partial = normed.find((h) => h.key.includes(a));
    if (partial) return partial.raw;
  }
  return null;
}
function numberFrom(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const m = String(value).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function agingBucketOf(n: number | null): string {
  if (n === null) return BLANK;
  if (n <= 1) return "0-1d";
  if (n <= 3) return "2-3d";
  if (n <= 7) return "4-7d";
  return "7d+";
}
function formatScan(sec: number | null): string {
  if (!sec) return "-";
  const d = new Date(sec * 1000 + 7 * 60 * 60 * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd} ${months[d.getUTCMonth()]} ${hh}:${mm}`;
}
function emptyHms(detail: string): HmsInfo {
  return { found: false, statusLabel: detail, rawStatus: "", logType: "", actualHub: "", serviceType: "", lastScanAt: null, detail };
}

function buildPivot(rows: AgingRow[]): Pivot {
  const agingSet = new Set<string>();
  const statusMap = new Map<string, { total: number; cells: Record<string, number>; children: Map<string, PivotChild> }>();
  const colTotals: Record<string, number> = {};
  let grandTotal = 0;
  for (const r of rows) {
    const status = r.hms?.statusLabel || STATUS_PENDING;
    const bucket = r.agingBucket;
    agingSet.add(bucket);
    let st = statusMap.get(status);
    if (!st) { st = { total: 0, cells: {}, children: new Map() }; statusMap.set(status, st); }
    st.total++;
    st.cells[bucket] = (st.cells[bucket] || 0) + 1;
    colTotals[bucket] = (colTotals[bucket] || 0) + 1;
    grandTotal++;
    const remarkLabel = r.remarks.trim() ? r.remarks.trim() : BLANK;
    const key = remarkLabel.toLowerCase();
    let child = st.children.get(key);
    if (!child) { child = { key, label: remarkLabel, total: 0, cells: {} }; st.children.set(key, child); }
    child.total++;
    child.cells[bucket] = (child.cells[bucket] || 0) + 1;
  }
  const agings = BUCKET_ORDER.filter((b) => agingSet.has(b));
  const rowsOut: PivotRow[] = Array.from(statusMap.entries())
    .map(([status, v]) => {
      const allChildren = Array.from(v.children.values()).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
      const onlyBlank = allChildren.length === 1 && allChildren[0].label === BLANK;
      return { status, total: v.total, cells: v.cells, children: onlyBlank ? [] : allChildren };
    })
    .sort((a, b) => b.total - a.total || a.status.localeCompare(b.status));
  return {
    rows: rowsOut, agings, colTotals, grandTotal, statusCount: rowsOut.length,
    remarksCount: new Set(rows.filter((r) => r.remarks.trim()).map((r) => r.remarks.trim().toLowerCase())).size,
  };
}

export default function CekAgingTab({ hubId }: { hubId: string }) {
  const [rows, setRows] = useState<AgingRow[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [totalParsed, setTotalParsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [fetchingHms, setFetchingHms] = useState(false);
  const [fetchedCount, setFetchedCount] = useState(0);
  const [hmsError, setHmsError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [onlyBlank, setOnlyBlank] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runToken = useRef(0);

  const fetchOneAwb = useCallback(async (awb: string): Promise<HmsInfo> => {
    const res = await fetch(`/api/hms/awb/${encodeURIComponent(awb)}`, { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      let msg = "Token HMS tidak tersedia. Buka HMS di tab lain lalu coba lagi.";
      try { const body = await res.json(); if (body?.message) msg = body.message; } catch {}
      const e = new Error(msg);
      (e as Error & { auth?: boolean }).auth = true;
      throw e;
    }
    if (!res.ok) return emptyHms(STATUS_FAILED);
    const body = await res.json();
    if (!body.found) return emptyHms(STATUS_NOT_FOUND);
    return {
      found: true,
      statusLabel: body.statusLabel || EMPTY_STATUS,
      rawStatus: body.status || "",
      logType: body.logType || "",
      actualHub: body.actualHub || "-",
      serviceType: body.serviceType || "",
      lastScanAt: body.lastScanAt ?? null,
      detail: body.serviceType ? body.serviceType : "",
    };
  }, []);

  const runPool = useCallback(
    async <T,>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>, onDone: () => void) => {
      let cursor = 0;
      const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          await worker(items[i], i);
          onDone();
        }
      });
      await Promise.all(runners);
    },
    []
  );

  const handleFile = async (file: File) => {
    setError(null);
    setHmsError(null);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError("Format tidak didukung. Gunakan file .xlsx, .xls, atau .csv.");
      return;
    }
    const token = ++runToken.current;
    setParsing(true);
    setFetchingHms(false);
    setFetchedCount(0);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("Sheet pertama tidak ditemukan.");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!raw.length) throw new Error("File kosong - tidak ada baris data.");
      const headers = Object.keys(raw[0]);
      const agingCol = findColumn(headers, AGING_KEYS);
      const awbCol = findColumn(headers, AWB_KEYS);
      const remarkCol = findColumn(headers, REMARK_KEYS);
      if (!agingCol) throw new Error(`Kolom Aging tidak ditemukan. Kolom tersedia: ${headers.join(", ")}`);
      if (!awbCol) throw new Error(`Kolom Airwaybill tidak ditemukan. Kolom tersedia: ${headers.join(", ")}`);

      const parsed: AgingRow[] = [];
      let id = 0;
      for (const r of raw) {
        const awb = String(r[awbCol] ?? "").trim();
        if (!awb) continue;
        const agingNum = numberFrom(r[agingCol]);
        const agingRaw = r[agingCol];
        const agingLabel =
          agingNum !== null
            ? `${agingNum} day`
            : agingRaw === null || agingRaw === undefined || String(agingRaw).trim() === ""
              ? BLANK
              : String(agingRaw).trim();
        parsed.push({
          id: id++,
          aging: agingNum,
          agingLabel,
          agingBucket: agingBucketOf(agingNum),
          awb,
          remarks: remarkCol ? String(r[remarkCol] ?? "").trim() : "",
          hms: null,
        });
      }
      if (!parsed.length) throw new Error("Tidak ada baris dengan Airwaybill yang terisi.");

      setRows(parsed);
      setFileName(file.name);
      setTotalParsed(raw.length);
      setCollapsed({});
      setQuery("");
      setOnlyBlank(false);
      setParsing(false);

      setFetchingHms(true);
      setFetchedCount(0);
      let authError: string | null = null;
      await runPool(
        parsed,
        MAX_CONCURRENT_HMS,
        async (row) => {
          let info: HmsInfo;
          try {
            info = await fetchOneAwb(row.awb);
          } catch (e) {
            const err = e as Error & { auth?: boolean };
            if (err.auth && !authError) authError = err.message;
            info = emptyHms(STATUS_FAILED);
          }
          if (runToken.current !== token) return;
          setRows((prev) => (prev ? prev.map((r) => (r.id === row.id ? { ...r, hms: info } : r)) : prev));
        },
        () => {
          if (runToken.current === token) setFetchedCount((c) => c + 1);
        }
      );
      if (runToken.current === token) {
        setFetchingHms(false);
        if (authError) setHmsError(authError);
      }
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : "Gagal membaca file.");
      setFetchingHms(false);
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };
  const updateRemark = useCallback((id: number, remarks: string) => {
    setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, remarks } : r)) : prev));
  }, []);
  const reset = () => {
    runToken.current++;
    setRows(null); setFileName(""); setTotalParsed(0); setError(null); setHmsError(null);
    setFetchingHms(false); setFetchedCount(0); setCollapsed({}); setQuery(""); setOnlyBlank(false);
  };

  const pivot = useMemo(() => (rows ? buildPivot(rows) : null), [rows]);
  const remarkOptions = useMemo(() => {
    if (!rows) return [] as string[];
    const seen = new Map<string, string>();
    for (const r of rows) {
      const v = r.remarks.trim();
      if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [rows]);
  const filteredRows = useMemo(() => {
    if (!rows) return [] as AgingRow[];
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyBlank && r.remarks.trim()) return false;
      if (!q) return true;
      return (
        r.awb.toLowerCase().includes(q) ||
        (r.hms?.statusLabel || "").toLowerCase().includes(q) ||
        (r.hms?.actualHub || "").toLowerCase().includes(q) ||
        (r.hms?.logType || "").toLowerCase().includes(q) ||
        (r.hms?.rawStatus || "").toLowerCase().includes(q) ||
        r.remarks.toLowerCase().includes(q) ||
        r.agingLabel.toLowerCase().includes(q)
      );
    });
  }, [rows, query, onlyBlank]);
  const maxCell = useMemo(() => {
    if (!pivot) return 0;
    let m = 0;
    for (const r of pivot.rows) for (const a of pivot.agings) m = Math.max(m, r.cells[a] || 0);
    return m;
  }, [pivot]);
  const highestAging = useMemo(() => {
    if (!rows) return "-";
    const nums = rows.map((r) => r.aging).filter((n): n is number => n !== null);
    return nums.length ? `${Math.max(...nums)} day` : "-";
  }, [rows]);
  const notFoundCount = useMemo(
    () => (rows ? rows.filter((r) => r.hms && !r.hms.found).length : 0),
    [rows]
  );
  const toggleStatus = (status: string) => setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }));

  const exportPivot = async () => {
    if (!pivot) return;
    const XLSX = await import("xlsx");
    const aoa: (string | number)[][] = [];
    aoa.push(["Count of Airwaybill (live HMS status)"]);
    aoa.push(["HMS Status", "Remarks", ...pivot.agings, "Grand Total"]);
    for (const r of pivot.rows) {
      aoa.push([r.status, "", ...pivot.agings.map((a) => r.cells[a] || 0), r.total]);
      for (const c of r.children) {
        aoa.push([`  ${r.status}`, `  ${c.label}`, ...pivot.agings.map((a) => c.cells[a] || 0), c.total]);
      }
    }
    aoa.push(["Grand Total", "", ...pivot.agings.map((a) => pivot.colTotals[a] || 0), pivot.grandTotal]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 22 }, { wch: 28 }, ...pivot.agings.map(() => ({ wch: 10 })), { wch: 13 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pivot");
    XLSX.writeFile(wb, `Aging-Pivot-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const hmsTotal = rows?.length ?? 0;
  const hmsPct = hmsTotal ? Math.round((fetchedCount / hmsTotal) * 100) : 0;

  return (
    <div className="px-6 py-4 space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-6 transition ${rows ? "py-5" : "py-10"} text-center ${
          dragging ? "border-blue-500 bg-blue-950/30" : "border-slate-600 bg-slate-800/40 hover:border-blue-500 hover:bg-slate-800/70"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <div className="flex flex-col items-center gap-2">
          {parsing ? <Loader2 className="w-8 h-8 animate-spin text-blue-400" /> : <Upload className="w-8 h-8 text-blue-400" />}
          <p className="text-sm font-semibold text-white">
            {parsing ? "Membaca file..." : rows ? "Tarik file lain untuk mengganti data" : "Tarik & lepas file Aging di sini"}
          </p>
          <p className="text-xs text-gray-400">atau klik untuk pilih file - .xlsx / .xls / .csv</p>
          <p className="text-[10px] text-gray-500 mt-1">
            Kolom wajib: <span className="text-gray-300">Aging</span>, <span className="text-gray-300">Airwaybill</span> - opsional: <span className="text-gray-300">Remarks</span>. Status diambil <span className="text-gray-300">live dari HMS</span>, bukan dari file.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {fetchingHms && (
        <div className="rounded-lg border border-blue-800 bg-blue-950/30 px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-blue-200">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span>
                Fetching HMS status for {hmsTotal.toLocaleString("id-ID")} AWBs\u2026{" "}
                <span className="font-semibold text-white">{fetchedCount.toLocaleString("id-ID")}</span>
                <span className="text-blue-300">/{hmsTotal.toLocaleString("id-ID")}</span>
              </span>
            </div>
            <span className="font-semibold tabular-nums text-blue-200">{hmsPct}%</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-700/70">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${hmsPct}%` }} />
          </div>
        </div>
      )}

      {hmsError && !fetchingHms && (
        <div className="flex items-start gap-2 rounded border border-amber-800 bg-amber-950/30 px-4 py-3 text-xs text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{hmsError}</span>
        </div>
      )}

      {rows && pivot && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <FileSpreadsheet className="w-4 h-4 text-blue-400" />
              <span className="font-semibold text-white">{fileName}</span>
              <span className="text-gray-500">-</span>
              <span>{totalParsed.toLocaleString("id-ID")} baris dibaca</span>
              <span className="text-gray-500">-</span>
              <span className="font-semibold text-green-400">{pivot.grandTotal.toLocaleString("id-ID")} paket dihitung</span>
              {fetchingHms && <span className="text-blue-300">- status HMS diperbarui live\u2026</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={exportPivot} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 border border-blue-500">
                <Download className="w-3.5 h-3.5" /> Download Pivot
              </button>
              <button onClick={reset} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-slate-700 text-gray-300 hover:bg-slate-600 border border-slate-600">
                <X className="w-3.5 h-3.5" /> Reset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Paket" value={pivot.grandTotal.toLocaleString("id-ID")} accent="border-l-blue-500" />
            <StatCard label="Jumlah Status HMS" value={String(pivot.statusCount)} accent="border-l-purple-500" />
            <StatCard label="Not found di HMS" value={notFoundCount.toLocaleString("id-ID")} accent={notFoundCount ? "border-l-red-500" : "border-l-emerald-500"} />
            <StatCard label="Aging Tertinggi" value={highestAging} accent="border-l-amber-500" />
          </div>

          <section className="rounded-lg border border-slate-700 bg-slate-900/40">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
              <div className="flex items-center gap-2">
                <PencilLine className="w-4 h-4 text-blue-400" />
                <h2 className="text-xs font-bold tracking-wide text-white">DATA &amp; REMARKS</h2>
                <span className="text-[10px] text-gray-400">- HMS Status live per AWB, klik Remarks untuk mengetik</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Cari AWB / HMS status / hub / remarks"
                    className="w-56 rounded border border-slate-600 bg-slate-800 pl-7 pr-2 py-1.5 text-[11px] text-gray-200 placeholder:text-gray-500 outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={() => setOnlyBlank((v) => !v)}
                  className={`text-[11px] px-2.5 py-1.5 rounded border transition ${
                    onlyBlank ? "bg-amber-500/20 border-amber-500/60 text-amber-300" : "bg-slate-800 border-slate-600 text-gray-300 hover:bg-slate-700"
                  }`}
                >
                  Belum ada remark
                </button>
                <span className="text-[10px] text-gray-400">
                  {filteredRows.length.toLocaleString("id-ID")} / {rows.length.toLocaleString("id-ID")} baris
                </span>
              </div>
            </div>

            <div className="overflow-auto max-h-[460px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-20 bg-[#1e3a8a] text-white">
                  <tr>
                    <th className="w-20 px-3 py-2.5 text-left font-bold whitespace-nowrap">Aging</th>
                    <th className="px-3 py-2.5 text-left font-bold whitespace-nowrap">Airwaybill</th>
                    <th className="px-3 py-2.5 text-left font-bold whitespace-nowrap">HMS Status</th>
                    <th className="w-16 px-3 py-2.5 text-left font-bold whitespace-nowrap">Log</th>
                    <th className="px-3 py-2.5 text-left font-bold whitespace-nowrap">Actual Hub</th>
                    <th className="w-28 px-3 py-2.5 text-left font-bold whitespace-nowrap">Last Scan</th>
                    <th className="px-3 py-2.5 text-left font-bold whitespace-nowrap">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, i) => (
                    <RemarkRow key={r.id} row={r} zebra={i % 2 === 0} onRemarkChange={updateRemark} />
                  ))}
                  {!filteredRows.length && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-[11px] text-gray-500">Tidak ada baris yang cocok dengan filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <datalist id="remark-options">
                {remarkOptions.map((o) => (<option key={o} value={o} />))}
              </datalist>
            </div>
          </section>

          <section className="rounded-lg border border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold tracking-wide text-white">PIVOT - HMS STATUS x AGING</h2>
                <span className="text-[10px] text-gray-400">Count of Airwaybill | klik +/- untuk buka rincian remarks</span>
              </div>
              <span className="text-[10px] text-gray-400">{pivot.remarksCount.toLocaleString("id-ID")} remarks terpakai</span>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#1e3a8a] text-white">
                    <th className="sticky left-0 z-30 bg-[#1e3a8a] px-4 py-3 text-left font-bold whitespace-nowrap border-r border-blue-800">HMS Status</th>
                    <th className="px-4 py-3 text-left font-bold whitespace-nowrap border-r border-blue-800">Remarks</th>
                    {pivot.agings.map((a) => (<th key={a} className="px-4 py-3 text-right font-bold whitespace-nowrap">{a}</th>))}
                    <th className="px-4 py-3 text-right font-bold whitespace-nowrap bg-[#172554] border-l-2 border-blue-700">Grand Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pivot.rows.map((r, i) => (
                    <PivotRowGroup
                      key={r.status}
                      row={r}
                      agings={pivot.agings}
                      maxCell={maxCell}
                      hasChildren={r.children.length > 0}
                      isCollapsed={!!collapsed[r.status]}
                      zebraClass={i % 2 === 0 ? "bg-slate-900" : "bg-slate-800/60"}
                      onToggle={() => toggleStatus(r.status)}
                    />
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-20">
                  <tr className="bg-[#172554] text-white border-t-2 border-blue-700">
                    <td className="sticky left-0 z-30 bg-[#172554] px-4 py-3 text-left font-bold whitespace-nowrap border-r border-blue-800">Grand Total</td>
                    <td className="px-4 py-3 border-r border-blue-800" />
                    {pivot.agings.map((a) => (
                      <td key={a} className="px-4 py-3 text-right tabular-nums font-bold">{(pivot.colTotals[a] || 0).toLocaleString("id-ID")}</td>
                    ))}
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-300 bg-blue-950/40 border-l-2 border-blue-700">
                      {pivot.grandTotal.toLocaleString("id-ID")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <p className="text-center text-[10px] text-gray-500">
            Pivot: HMS Status (live) &gt; Remarks x Aging bucket - nilai = jumlah Airwaybill - status diambil langsung dari HMS per AWB
          </p>
        </>
      )}

      {!rows && !error && (
        <p className="text-center text-[10px] text-gray-500">
          Upload file Aging, status HMS aktual per AWB diambil otomatis, isi Remarks, lalu pivot HMS Status x Aging terbentuk otomatis
        </p>
      )}
    </div>
  );
}

const RemarkRow = memo(function RemarkRow({
  row, zebra, onRemarkChange,
}: {
  row: AgingRow;
  zebra: boolean;
  onRemarkChange: (id: number, remarks: string) => void;
}) {
  const empty = !row.remarks.trim();
  const hms = row.hms;
  const pending = !hms;
  const notFound = !!hms && !hms.found;
  return (
    <tr className={zebra ? "bg-slate-900" : "bg-slate-800/50"}>
      <td className="px-3 py-1.5 tabular-nums text-gray-300 whitespace-nowrap">{row.agingLabel}</td>
      <td className="px-3 py-1.5 font-mono text-[11px] text-gray-200 whitespace-nowrap">{row.awb}</td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        {pending ? (
          <span className="inline-flex items-center gap-1.5 text-blue-300">
            <Loader2 className="w-3 h-3 animate-spin" />
            {STATUS_PENDING}
          </span>
        ) : (
          <>
            <span className={`font-semibold ${notFound ? "text-red-300" : "text-gray-200"}`}>{hms.statusLabel}</span>
            {hms.detail && <span className="block text-[10px] text-gray-500">{hms.detail}</span>}
          </>
        )}
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        {pending ? (
          <span className="text-slate-600">-</span>
        ) : hms.logType ? (
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${hms.logType === "FM" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>
            {hms.logType}
          </span>
        ) : (
          <span className="text-slate-600">-</span>
        )}
      </td>
      <td className="px-3 py-1.5 text-[11px] text-gray-300 whitespace-nowrap">{hms?.actualHub || "-"}</td>
      <td className="px-3 py-1.5 tabular-nums text-[11px] text-gray-400 whitespace-nowrap">
        {hms ? formatScan(hms.lastScanAt) : "-"}
      </td>
      <td className="px-2 py-1">
        <input
          value={row.remarks}
          onChange={(e) => onRemarkChange(row.id, e.target.value)}
          list="remark-options"
          placeholder="Tambah remark..."
          className={`w-full rounded border bg-transparent px-2 py-1 text-[11px] text-gray-100 outline-none transition placeholder:text-gray-600 focus:bg-slate-950 focus:border-blue-500 ${
            empty ? "border-slate-700 border-dashed" : "border-slate-600"
          }`}
        />
      </td>
    </tr>
  );
});

function PivotRowGroup({
  row, agings, maxCell, hasChildren, isCollapsed, zebraClass, onToggle,
}: {
  row: PivotRow;
  agings: string[];
  maxCell: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  zebraClass: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={`${zebraClass} ${hasChildren ? "border-t border-slate-700/70" : ""}`}>
        <td className={`sticky left-0 z-10 px-4 py-2 font-bold text-white whitespace-nowrap border-r border-slate-700 ${zebraClass.includes("800") ? "bg-slate-800" : "bg-slate-900"}`}>
          <div className="flex items-center gap-1.5">
            {hasChildren ? (
              <button
                onClick={onToggle}
                className="flex h-4 w-4 items-center justify-center rounded-sm border border-slate-500 bg-slate-700 text-gray-200 hover:bg-slate-600"
                aria-label={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            ) : (
              <span className="inline-block w-4" />
            )}
            <span>{row.status}</span>
          </div>
        </td>
        <td className={`px-4 py-2 text-[10px] text-gray-500 whitespace-nowrap border-r border-slate-700 ${zebraClass.includes("800") ? "bg-slate-800" : "bg-slate-900"}`}>
          {hasChildren ? `${row.children.length} remark` : ""}
        </td>
        <PivotCells cells={row.cells} agings={agings} maxCell={maxCell} bold />
        <td className="px-4 py-2 text-right tabular-nums font-bold text-blue-300 bg-blue-950/20 border-l-2 border-slate-700">
          {row.total.toLocaleString("id-ID")}
        </td>
      </tr>
      {hasChildren && !isCollapsed &&
        row.children.map((c) => (
          <tr key={`${row.status}-${c.key}`} className="bg-slate-950/60">
            <td className="sticky left-0 z-10 bg-slate-950 px-3 py-1.5 whitespace-nowrap border-r border-slate-800" />
            <td className="bg-slate-950 px-3 py-1.5 text-[11px] text-gray-300 whitespace-nowrap border-r border-slate-800">
              <span className="text-slate-600 mr-1.5">&#8627;</span>
              <span className={c.label === BLANK ? "italic text-gray-500" : ""}>{c.label}</span>
            </td>
            <PivotCells cells={c.cells} agings={agings} maxCell={maxCell} />
            <td className="px-4 py-1.5 text-right tabular-nums text-gray-300 border-l-2 border-slate-800">
              {c.total.toLocaleString("id-ID")}
            </td>
          </tr>
        ))}
    </>
  );
}

function PivotCells({
  cells, agings, maxCell, bold,
}: {
  cells: Record<string, number>;
  agings: string[];
  maxCell: number;
  bold?: boolean;
}) {
  return (
    <>
      {agings.map((a) => {
        const v = cells[a] || 0;
        const intensity = maxCell > 0 ? v / maxCell : 0;
        return (
          <td key={a} className={`px-4 py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
            {v === 0 ? (
              <span className="text-slate-600">-</span>
            ) : (
              <span
                className="inline-block min-w-8 rounded px-1.5 py-0.5 text-slate-100"
                style={{ backgroundColor: `rgba(59,130,246,${0.12 + intensity * 0.5})` }}
              >
                {v.toLocaleString("id-ID")}
              </span>
            )}
          </td>
        );
      })}
    </>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`bg-slate-800/60 rounded border border-slate-700 border-l-4 ${accent} px-4 py-3`}>
      <p className="text-[10px] font-bold text-gray-400 tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1.5">{value}</p>
    </div>
  );
}
