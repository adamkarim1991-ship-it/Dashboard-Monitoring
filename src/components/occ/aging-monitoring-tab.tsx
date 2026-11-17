"use client";

type AgingMode = "forward" | "return";

const FORWARD_REQUIREMENTS = [
  "Control Tower Forward source query for GTL Jatinegara facility",
  "Aging from Picked >= 3 and < 360, non-test tracking numbers, and valid business line filters",
  "HMS-first status reconciliation, OMS fallback only for non-informative HMS statuses",
  "Pivot by reconciled newStatus with fixed buckets 3-8",
];

const RETURN_REQUIREMENTS = [
  "Control Tower report [CT] Return Raw Data for Jatinegara or a verified equivalent",
  "Dataset/report metadata validator for the Jatinegara source, not Duren Sawit metadata",
  "hub_name/facility filter for Jatinegara, backlog_flag_l1 = return, and p_date retained",
  "Pivot by raw return status, with newStatus only as enrichment",
];

export default function AgingMonitoringTab({ mode, hubId }: { mode: AgingMode; hubId: string }) {
  const isReturn = mode === "return";
  const title = isReturn ? "Aging Monitoring Return" : "Aging Monitoring";
  const requirements = isReturn ? RETURN_REQUIREMENTS : FORWARD_REQUIREMENTS;

  return (
    <section className="p-6 space-y-4">
      <div>
        <p className="text-[10px] font-bold tracking-widest text-amber-300 uppercase">{title}</p>
        <h2 className="text-xl font-bold text-white">{title} — Jatinegara source setup required</h2>
        <p className="mt-1 text-xs text-gray-400">
          Modul ini sudah dipisahkan dari Cek Aging dan disiapkan untuk hub {hubId}. Data belum ditampilkan karena kontrak sumber Control Tower Jatinegara belum terverifikasi. Ini sengaja fail-closed agar data Duren Sawit tidak dilabeli sebagai Jatinegara.
        </p>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        <div className="font-semibold">Source belum dikonfigurasi</div>
        <p className="mt-1 text-xs leading-5">
          Kirim / buka URL Control Tower Jatinegara untuk modul {title}. Setelah report/query/facility Jatinegara valid, backend bisa mengambil snapshot, menjalankan validator, dan menampilkan pivot + detail table.
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h3 className="text-sm font-semibold text-white">Kontrak yang akan dipasang</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-xs text-gray-300">
          {requirements.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs text-gray-400">
        <div className="font-semibold text-gray-200">Status implementasi</div>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div>UI tab: ready</div>
          <div>Jatinegara source query: pending verification</div>
          <div>Snapshot validator: pending source metadata</div>
          <div>Production data display: blocked until source is verified</div>
        </div>
      </div>
    </section>
  );
}
