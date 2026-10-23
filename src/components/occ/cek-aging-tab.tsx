"use client";

import { useMemo, useRef, useState } from "react";
import { Upload, FileSpreadsheet, X, AlertTriangle, Loader2 } from "lucide-react";

type Pivot = {
  fileName: string;
  totalRows: number;
  statuses: string[];
  agings: string[];
  cells: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
};

const STATUS_KEYS = ["status", "status package", "status paket", "current status", "last status", "status akhir"];
const AGING_KEYS = ["aging", "aging group", "aging days", "aging day", "umur", "aging (day)"];
const AWB_KEYS = ["airwaybill", "awb", "airwaybill no", "no airwaybill", "no. airwaybill", "waybill", "awb number"];

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

function numberFrom(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const m = String(value).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function normalizeAging(raw: any): string {
  if (raw === null || raw === undefined || raw === "") return "(blank)";
  const n = numberFrom(raw);
  if (n === null) return String(raw).trim();
  return `${n} day`;
}

function agingSortValue(a: string): number {
  const n = numberFrom(a);
  return n === null ? Number.MAX_SAFE_INTEGER : n;
}

export default function CekAgingTab({ hubId }: { hubId: string }) {
  const [pivot, setPivot] = useState<Pivot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError("Format tidak didukung. Gunakan file .xlsx, .xls, atau .csv.");
      return;
    }
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("Sheet pertama tidak ditemukan.");

      const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });
      if (!rows.length) throw new Error("File kosong - tidak ada baris data.");

      const headers = Object.keys(rows[0]);
      const statusCol = findColumn(headers, STATUS_KEYS);
      const agingCol = findColumn(headers, AGING_KEYS);
      const awbCol = findColumn(headers, AWB_KEYS);

      if (!statusCol) throw new Error(`Kolom Status tidak ditemukan. Kolom tersedia: ${headers.join(", ")}`);
      if (!agingCol) throw new Error(`Kolom Aging tidak ditemukan. Kolom tersedia: ${headers.join(", ")}`);

      const cells: Record<string, Record<string, number>> = {};
      const rowTotals: Record<string, number> = {};
      const colTotals: Record<string, number> = {};
      const statusSet = new Set<string>();
      const agingSet = new Set<string>();
      let grandTotal = 0;
      let counted = 0;

      for (const r of rows) {
        const status = String(r[statusCol] ?? "").trim() || "(blank)";
        const aging = normalizeAging(r[agingCol]);
        const awb = awbCol ? r[awbCol] : null;

        if (awbCol && (awb === null || awb === undefined || String(awb).trim() === "")) continue;

        counted++;
        statusSet.add(status);
        agingSet.add(aging);
        if (!cells[status]) cells[status] = {};
        cells[status][aging] = (cells[status][aging] || 0) + 1;
        rowTotals[status] = (rowTotals[status] || 0) + 1;
        colTotals[aging] = (colTotals[aging] || 0) + 1;
        grandTotal++;
      }

      if (!counted) throw new Error("Tidak ada baris yang bisa dihitung (kolom Airwaybill kosong semua).");

      const agings = Array.from(agingSet).sort((a, b) => {
        const d = agingSortValue(a) - agingSortValue(b);
        return d !== 0 ? d : a.localeCompare(b);
      });
      const statuses = Array.from(statusSet).sort((a, b) => (rowTotals[b] || 0) - (rowTotals[a] || 0));

      setPivot({
        fileName: file.name,
        totalRows: rows.length,
        statuses,
        agings,
        cells,
        rowTotals,
        colTotals,
        grandTotal,
      });
    } catch (e: any) {
      setPivot(null);
      setError(e?.message || "Gagal membaca file.");
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

  const maxCell = useMemo(() => {
    if (!pivot) return 0;
    let m = 0;
    for (const s of pivot.statuses) {
      for (const a of pivot.agings) m = Math.max(m, pivot.cells[s]?.[a] || 0);
    }
    return m;
  }, [pivot]);

  return (
    <div className="px-6 py-4 space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
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
          {parsing ? (
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          ) : (
            <Upload className="w-8 h-8 text-blue-400" />
          )}
          <p className="text-sm font-semibold text-white">
            {parsing ? "Membaca file..." : "Tarik & lepas file Aging di sini"}
          </p>
          <p className="text-xs text-gray-400">atau klik untuk pilih file - .xlsx / .xls / .csv</p>
          <p className="text-[10px] text-gray-500 mt-1">
            Kolom wajib: <span className="text-gray-300">Status</span>,{" "}
            <span className="text-gray-300">Aging</span> - opsional:{" "}
            <span className="text-gray-300">Airwaybill</span> (untuk hitung jumlah paket)
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {pivot && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <FileSpreadsheet className="w-4 h-4 text-blue-400" />
              <span className="font-semibold text-white">{pivot.fileName}</span>
              <span className="text-gray-500">-</span>
              <span>{pivot.totalRows.toLocaleString("id-ID")} baris dibaca</span>
              <span className="text-gray-500">-</span>
              <span className="font-semibold text-green-400">{pivot.grandTotal.toLocaleString("id-ID")} paket dihitung</span>
            </div>
            <button
              onClick={() => { setPivot(null); setError(null); }}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-slate-700 text-gray-300 hover:bg-slate-600 border border-slate-600"
            >
              <X className="w-3.5 h-3.5" /> Reset
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Paket" value={pivot.grandTotal.toLocaleString("id-ID")} accent="border-l-blue-500" />
            <StatCard label="Jumlah Status" value={String(pivot.statuses.length)} accent="border-l-purple-500" />
            <StatCard label="Jumlah Bucket Aging" value={String(pivot.agings.length)} accent="border-l-amber-500" />
            <StatCard label="Aging Tertinggi" value={pivot.agings.length ? pivot.agings[pivot.agings.length - 1] : "-"} accent="border-l-red-500" />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-700">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#1e3a8a] text-white">
                    <th className="sticky left-0 z-30 bg-[#1e3a8a] px-4 py-3 text-left font-bold whitespace-nowrap border-r border-blue-800">Status</th>
                    {pivot.agings.map((a) => (
                      <th key={a} className="px-3 py-3 text-right font-bold whitespace-nowrap">{a}</th>
                    ))}
                    <th className="px-4 py-3 text-right font-bold whitespace-nowrap bg-[#172554] border-l-2 border-blue-700">Grand Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pivot.statuses.map((s, i) => (
                    <tr key={s} className={i % 2 === 0 ? "bg-slate-900" : "bg-slate-800/60"}>
                      <td className={`sticky left-0 z-10 px-4 py-2 font-semibold text-white whitespace-nowrap border-r border-slate-700 ${i % 2 === 0 ? "bg-slate-900" : "bg-slate-800"}`}>{s}</td>
                      {pivot.agings.map((a) => {
                        const v = pivot.cells[s]?.[a] || 0;
                        const intensity = maxCell > 0 ? v / maxCell : 0;
                        return (
                          <td key={a} className="px-3 py-2 text-right tabular-nums">
                            {v === 0 ? (
                              <span className="text-slate-600">-</span>
                            ) : (
                              <span
                                className="inline-block min-w-8 rounded px-1.5 py-0.5 font-semibold text-slate-100"
                                style={{ backgroundColor: `rgba(59,130,246,${0.12 + intensity * 0.5})` }}
                              >
                                {v.toLocaleString("id-ID")}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-blue-300 bg-blue-950/20 border-l-2 border-slate-700">
                        {(pivot.rowTotals[s] || 0).toLocaleString("id-ID")}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-20">
                  <tr className="bg-[#172554] text-white border-t-2 border-blue-700">
                    <td className="sticky left-0 z-30 bg-[#172554] px-4 py-3 text-left font-bold whitespace-nowrap border-r border-blue-800">Grand Total</td>
                    {pivot.agings.map((a) => (
                      <td key={a} className="px-3 py-3 text-right tabular-nums font-bold">{(pivot.colTotals[a] || 0).toLocaleString("id-ID")}</td>
                    ))}
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-300 bg-blue-950/40 border-l-2 border-blue-700">
                      {pivot.grandTotal.toLocaleString("id-ID")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <p className="text-center text-[10px] text-gray-500">
            Pivot: Status x Aging - nilai = jumlah Airwaybill - 100% diproses di browser, file tidak diupload ke server
          </p>
        </>
      )}

      {!pivot && !error && (
        <p className="text-center text-[10px] text-gray-500">
          Data akan dihitung jadi pivot table: baris = Status, kolom = Aging days, nilai = jumlah Airwaybill
        </p>
      )}
    </div>
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
