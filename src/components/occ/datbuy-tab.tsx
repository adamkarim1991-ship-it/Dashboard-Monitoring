"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, RefreshCw, Search, XCircle } from "lucide-react";

type DatbuyResult = {
  awb: string;
  status: "found" | "partial" | "not_found" | "error";
  sourceStatus: string;
  message?: string;
  package?: Record<string, unknown>;
  receiver?: Record<string, unknown>;
  order?: Record<string, unknown>;
};

type DatbuyResponse = {
  success: boolean;
  count: number;
  maxAwbs: number;
  results: DatbuyResult[];
  meta?: { note?: string; sourceErrors?: string[]; cached?: boolean };
  error?: string;
};

const MAX_AWBS = 50;
const REQUEST_TIMEOUT_MS = 75_000;

function parseAwbs(input: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.replaceAll(",", "\n").split("\n")) {
    const awb = part.trim();
    if (!awb) continue;
    const key = awb.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(awb);
  }
  return out;
}

function textValue(v: unknown) {
  if (v === undefined || v === null || String(v).trim() === "") return "-";
  return String(v);
}

function statusClass(status: DatbuyResult["status"]) {
  if (status === "found") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
  if (status === "partial") return "bg-amber-500/15 text-amber-300 border-amber-500/40";
  if (status === "not_found") return "bg-slate-500/15 text-slate-300 border-slate-500/40";
  return "bg-red-500/15 text-red-300 border-red-500/40";
}

function formatCod(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return textValue(value);
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function detailEntries(row: DatbuyResult): Array<[string, unknown]> {
  const details = (row.package?.physicalDetails ?? {}) as Record<string, unknown>;
  const entries: Array<[string, unknown]> = [
    ["Product", row.order?.productName],
    ["Weight", details.weight],
    ["Volume", details.volume],
    ["Dimension", details.dimension ?? details.size],
    ["Invoice", details.invoiceNumber],
    ["Service", details.serviceType],
    ["Order type", details.orderType],
    ["Shipping type", details.shippingType],
  ];
  return entries.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
}

function phoneForWhatsApp(value: unknown) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  return digits;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "pagi";
  if (hour < 15) return "siang";
  if (hour < 18) return "sore";
  return "malam";
}


function shareBlock(row: DatbuyResult) {
  return [row.awb, textValue(row.receiver?.name), textValue(row.receiver?.phone)].join("\n");
}

function shareText(rows: DatbuyResult[]) {
  return rows.map(shareBlock).join("\n\n");
}

function buildWhatsAppLink(row: DatbuyResult) {
  const phone = phoneForWhatsApp(row.receiver?.phone);
  if (!phone) return null;
  const message = [
    `Selamat ${greeting()} kak, saya dari GTL ingin mengkonfirmasi terkait paket dengan detail sebagai berikut`,
    row.awb,
    `*${textValue(row.receiver?.name)}`,
    `*${textValue(row.receiver?.address)}`,
    `*${textValue(row.order?.seller)}`,
    `*${formatCod(row.order?.codPrice)}`,
    "Untuk fisik paket tersebut apakah sudah diterima?",
  ].join("\n");
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
}

export default function DatbuyTab({ hubId: _hubId, scopeLabel = "OCC hub" }: { hubId?: string; scopeLabel?: string }) {
  const [input, setInput] = useState("");
  const [data, setData] = useState<DatbuyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const awbs = useMemo(() => parseAwbs(input), [input]);

  async function search() {
    setError(null);
    setData(null);
    if (awbs.length === 0) {
      setError("Masukkan minimal satu nomor resi.");
      return;
    }
    if (awbs.length > MAX_AWBS) {
      setError(`Maksimal ${MAX_AWBS} resi per pencarian.`);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    setLoading(true);
    try {
      const res = await fetch("/api/hms/datbuy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ awbs, hubId: _hubId }),
        cache: "no-store",
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as DatbuyResponse;
      if (!res.ok || json.error) throw new Error(json.error || `Lookup failed (${res.status})`);
      if (seq === requestSeq.current) {
        setData(json);
        setCopied(false);
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof DOMException && err.name === "AbortError") setError("Lookup timeout atau dibatalkan. Coba lagi dengan batch lebih kecil.");
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      window.clearTimeout(timeout);
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  function clear() {
    abortRef.current?.abort();
    requestSeq.current += 1;
    setInput("");
    setData(null);
    setError(null);
    setLoading(false);
    setCopied(false);
  }

  async function copyShareFormat() {
    if (!data?.results?.length) return;
    const text = shareText(data.results);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.focus();
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="p-6 space-y-4">
      <div>
        <p className="text-[10px] font-bold tracking-widest text-blue-300 uppercase">Datbuy</p>
        <h2 className="text-xl font-bold text-white">Buyer / receiver lookup</h2>
        <p className="text-xs text-gray-400 mt-1">
          Lookup manual berdasarkan AWB/resi via HMS/TMS + CSMS/OMS live untuk {scopeLabel}. Maksimal {MAX_AWBS} resi, pisahkan dengan koma atau baris baru.
          Server hanya memakai hub yang assigned ke akun login; East coverage bukan lookup tenant-wide. Field kosong tidak ditebak.
          Detail barang menampilkan profil paket yang benar-benar dikembalikan HMS/TMS (berat, volume, dimensi, invoice/service) dan nama produk hanya bila CSMS/OMS menyediakannya; SKU/item list tidak ditebak jika sumber resmi tidak mengembalikannya.
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
        <label className="text-xs font-semibold text-gray-300">AWB numbers</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="GTL123..., GTL456..."
          className="min-h-28 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-gray-100 outline-none focus:border-blue-500"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span className={awbs.length > MAX_AWBS ? "text-red-300" : ""}>{awbs.length} / {MAX_AWBS} unique AWB</span>
          <button
            onClick={search}
            disabled={loading || awbs.length === 0 || awbs.length > MAX_AWBS}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
          <button
            onClick={clear}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-gray-300 hover:bg-slate-800"
          >
            <XCircle className="h-4 w-4" /> Clear
          </button>
        </div>
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      </div>

      {data?.meta?.note && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          {data.meta.note}{data.meta.cached ? " - cached 60s" : ""}
        </div>
      )}

      {data?.results && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
            <div className="text-xs text-gray-300">
              <p className="font-semibold text-white">Share format</p>
              <p>Copy otomatis: AWB number, Nama Buyer, Nomor tlp Buyer. Multi AWB dipisah baris kosong.</p>
            </div>
            <button
              onClick={copyShareFormat}
              disabled={data.results.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy Share Format"}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900">
          <table className="min-w-[1700px] w-full text-left text-xs">
            <thead className="bg-slate-800 text-gray-300">
              <tr>
                {["AWB", "Source", "Package Status", "Receiver", "Phone", "Address", "Driver", "Hub", "Payment", "COD", "Package Price", "Seller", "Platform", "Item / Package Details", "Product Link", "Message"].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.results.map((row) => (
                <tr key={row.awb} className="text-gray-200 hover:bg-slate-800/60">
                  <td className="px-3 py-2 font-mono text-blue-200">{row.awb}</td>
                  <td className="px-3 py-2"><span className={`rounded-full border px-2 py-0.5 ${statusClass(row.status)}`}>{row.status}</span></td>
                  <td className="px-3 py-2">{textValue(row.package?.statusLabel || row.package?.status)}</td>
                  <td className="px-3 py-2">{textValue(row.receiver?.name)}</td>
                  <td className="px-3 py-2">{buildWhatsAppLink(row) ? <a className="text-green-300 underline decoration-dotted hover:text-green-200" href={buildWhatsAppLink(row) || undefined}>{textValue(row.receiver?.phone)}</a> : textValue(row.receiver?.phone)}</td>
                  <td className="px-3 py-2 max-w-[300px] whitespace-normal">{textValue(row.receiver?.address)}</td>
                  <td className="px-3 py-2">{textValue(row.package?.driver)}</td>
                  <td className="px-3 py-2">{textValue(row.package?.hub || row.package?.hubId)}</td>
                  <td className="px-3 py-2">{textValue(row.package?.paymentType)}</td>
                  <td className="px-3 py-2">{formatCod(row.order?.codPrice)}</td>
                  <td className="px-3 py-2">{formatCod(row.order?.packagePrice)}</td>
                  <td className="px-3 py-2">{textValue(row.order?.seller)}</td>
                  <td className="px-3 py-2">{textValue(row.order?.platform)}</td>
                  <td className="px-3 py-2 max-w-[280px] whitespace-normal">
                    {detailEntries(row).length > 0 ? (
                      <div className="space-y-1">
                        {detailEntries(row).map(([label, value]) => (
                          <div key={label}><span className="font-semibold text-gray-400">{label}:</span> <span>{textValue(value)}</span></div>
                        ))}
                      </div>
                    ) : "-"}
                  </td>
                  <td className="px-3 py-2 max-w-[240px] truncate">{row.order?.productLink ? <a className="text-blue-300 underline" href={String(row.order.productLink)} target="_blank" rel="noreferrer">Open</a> : "-"}</td>
                  <td className="px-3 py-2 max-w-[360px] whitespace-normal text-gray-400">{textValue(row.message || row.sourceStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </section>
  );
}
