"use client";

import { useState, useRef } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";

export default function CekAgingTab() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);

    try {
      const XLSX = await import("xlsx").catch(() => {
        throw new Error("xlsx library not available. Run: npm install xlsx");
      });
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
      if (json.length > 1) {
        const headers = json[0] as string[];
        const rows = json.slice(1, 21).map((row, i) => {
          const obj: Record<string, any> = {};
          headers.forEach((h, j) => { obj[h] = row[j] ?? ""; });
          return obj;
        });
        setPreview(rows);
      }
    } catch (err: any) {
      setError("Failed to parse XLSX: " + (err.message || "Unknown error"));
    }
  };

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="bg-slate-800/60 rounded-lg border border-slate-700 p-8 text-center">
        <FileSpreadsheet className="w-12 h-12 text-gray-500 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-white mb-2">Cek Aging - XLSX Upload</h2>
        <p className="text-sm text-gray-400 mb-6">
          Upload an Excel file (.xlsx) to analyze package aging data.<br />
          API integration is not yet available — upload your data manually.
        </p>

        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
          <Upload className="w-4 h-4" />
          Upload XLSX File
        </button>

        {fileName && (
          <p className="mt-4 text-sm text-green-400">
            ✓ {fileName} loaded ({preview.length > 0 ? `${preview.length} rows preview` : "no data rows"})
          </p>
        )}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>

      {preview.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-lg border border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-slate-200">
              <thead className="bg-[#0f1e3d] text-white">
                <tr>
                  {Object.keys(preview[0]).map((key) => (
                    <th key={key} className="px-3 py-2.5 font-semibold text-left whitespace-nowrap">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
                    {Object.values(row).map((val: any, j) => (
                      <td key={j} className="px-3 py-2 text-gray-300">{String(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-gray-500 bg-slate-950">Showing first 20 rows only</p>
        </div>
      )}
    </div>
  );
}